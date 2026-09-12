// application/lock.ts — shared O_EXCL file lock primitives and workbench mutation lock.
// Acquired with O_EXCL create (no TOCTOU between check + create); the holder
// writes an ownership token and release() only removes the file if it still
// carries OUR token — a stale or replaced lock is never clobbered. fs/clock are
// injected so acquisition and staleness are testable without real files.
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../core/shared/errors.ts";

export interface LockFs {
  openSync: (p: string, flags: string) => number;
  writeSync: (fd: number, content: string) => void;
  closeSync: (fd: number) => void;
  readFileSync: (p: string) => string;
  statSync: (p: string) => { mtimeMs: number };
  unlinkSync: (p: string) => void;
  existsSync: (p: string) => boolean;
  now: () => number;
}

export interface ExclusiveLock {
  readonly held: boolean;
  /** Remove the lock only when it still carries this holder's token. */
  release: () => void;
}

const realFs: LockFs = {
  openSync,
  writeSync,
  closeSync,
  readFileSync: (p) => readFileSync(p, "utf-8"),
  statSync,
  unlinkSync,
  existsSync,
  now: Date.now,
};

/** Is this error "another process already holds the lock" (O_EXCL create
 *  failed)? Real fs throws ErrnoException with code EEXIST; test fakes sometimes
 *  throw message-only — match both. Anything else (ENOSPC/EIO on write, EACCES
 *  on open) is NOT contention and must never be treated as a held lock. */
function isEexist(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "EEXIST" || (typeof err?.message === "string" && err.message.includes("EEXIST"));
}

/** Acquire an exclusive lock; null when another holder's fresh lock is present.
 *  A stale lock (older than staleMs) is removed and the create retried once.
 *  A post-create write failure (ENOSPC/EIO) removes our own 0-byte poison lock
 *  and propagates — it is not contention (issue #8 #7). */
export function acquireLock(path: string, token: string, staleMs: number, fs: LockFs = realFs): ExclusiveLock | null {
  for (let attempt = 0; attempt < 2; attempt++) {
    let created = false;
    let fd: number | undefined;
    try {
      fd = fs.openSync(path, "wx");
      created = true;
      fs.writeSync(fd, token);
      return {
        held: true,
        release: () => {
          try {
            if (fs.existsSync(path) && fs.readFileSync(path) === token) fs.unlinkSync(path);
          } catch {
            // best-effort: an unreadable/vanished lock must not crash the run
          }
        },
      };
    } catch (e) {
      if (!isEexist(e)) {
        // open failed for a reason other than contention, or the file was OURS
        // but the token write failed — a 0-byte poison lock must not linger and
        // block every process for staleMs. Clean it up, then propagate.
        if (created) {
          try { fs.unlinkSync(path); } catch { /* already gone */ }
        }
        throw e;
      }
      // EEXIST — someone holds a lock; only break ours if it is stale.
      try {
        const age = fs.now() - fs.statSync(path).mtimeMs;
        if (age < staleMs) return null; // fresh lock — another run in progress
        fs.unlinkSync(path); // stale — drop and retry the exclusive create
      } catch {
        return null; // lock vanished mid-check or unreadable
      }
    } finally {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* best-effort */ }
      }
    }
  }
  return null;
}

/** acquireLock with an injected clock. The default fs reads Date.now, which
 *  makes staleness wall-clock dependent; execute.ts wires its injected
 *  ExecuteDeps.now here so integration tests can exercise the stale timeout
 *  (timeoutSec → staleMs conversion) without sleeping. */
export function acquireLockWithClock(
  path: string,
  token: string,
  staleMs: number,
  now: () => number,
  fs: LockFs = realFs,
): ExclusiveLock | null {
  return acquireLock(path, token, staleMs, { ...fs, now });
}

// ---- mutation locks (shared state-root primitive) ----

/** Registry / cron / journal mutations are local fs read-modify-write sections
 *  (normally milliseconds). 30s leaves more than three orders of magnitude of
 *  headroom while keeping crash recovery bounded; this is deliberately much
 *  shorter than the minute-level cron execution lock. */
export const MUTATION_LOCK_STALE_MS = 30_000;

/** Pending-envelope apply holds the lock across one gbrain call, whose own
 *  timeout is GBRAIN_TIMEOUT_MS (30s). The stale budget must stay strictly
 *  above that, or a slow-but-alive applier would be mistaken for crash residue
 *  and have its lock stolen mid-await. 4x is the margin; the coupling is
 *  asserted in application/lock.test.ts. */
export const FILEHUB_MUTATION_LOCK_STALE_MS = 120_000;

export interface MutationLockDeps {
  fs?: LockFs;
  now?: () => number;
  /** test seam; production tokens are process-unique */
  token?: string;
}

/** One workbench-level lock protects hub.json + local.json + cron.json. One
 *  lock (instead of per-file locks) keeps lock ordering impossible to get wrong;
 *  registry mutations are low-frequency, so serializing across files is cheap. */
export function mutationLockPath(root: string): string {
  return join(root, ".jspace", "state", "locks", "mutation.lock");
}

/** Pending envelopes live in `<filehub>/.jspace-logs/`. The lock sits next to
 *  them, NOT in the workbench: several workbenches can bind the same filehub,
 *  so a workbench-scoped lock would not serialize envelope writers at all. */
export function filehubMutationLockPath(fhRoot: string): string {
  return join(fhRoot, ".jspace-logs", "mutation.lock");
}

interface MutationLockSpec {
  lockPath: string;
  /** identity used in the nested-acquire programmer error */
  key: string;
  noun: string;
  staleMs: number;
}

const heldMutationLocks = new Set<string>();

/** Acquire, or fail loudly. Nested acquire of the SAME lock path in one process
 *  is a programmer error, not contention: waiting would deadlock until stale. */
function acquireMutationLock(spec: MutationLockSpec, deps: MutationLockDeps): ExclusiveLock {
  mkdirSync(dirname(spec.lockPath), { recursive: true });

  if (heldMutationLocks.has(spec.lockPath)) {
    throw new Error(`internal: nested ${spec.noun} mutation lock for ${spec.key}`);
  }

  const fs = deps.fs ?? realFs;
  const token = deps.token ?? `${process.pid}:${randomUUID()}`;
  const lock = acquireLockWithClock(spec.lockPath, token, spec.staleMs, deps.now ?? fs.now, fs);
  if (lock === null) {
    fail(
      `another jspace process is modifying this ${spec.noun} (lock: ${spec.lockPath}); ` +
        `retry after it finishes — stale locks are reclaimed after ${spec.staleMs / 1000}s`,
    );
  }

  heldMutationLocks.add(spec.lockPath);
  return lock;
}

function releaseMutationLock(spec: MutationLockSpec, lock: ExclusiveLock): void {
  lock.release();
  heldMutationLocks.delete(spec.lockPath);
}

function withMutationLock<T>(spec: MutationLockSpec, fn: () => T, deps: MutationLockDeps): T {
  const lock = acquireMutationLock(spec, deps);
  try {
    return fn();
  } finally {
    releaseMutationLock(spec, lock);
  }
}

async function withMutationLockAsync<T>(spec: MutationLockSpec, fn: () => Promise<T>, deps: MutationLockDeps): Promise<T> {
  const lock = acquireMutationLock(spec, deps);
  try {
    return await fn();
  } finally {
    releaseMutationLock(spec, lock);
  }
}

/** Run a synchronous workbench read-validate-write mutation under the lock.
 *  The callback MUST include the full read → validate → mutate → write span;
 *  wrapping only the final write still allows stale-snapshot validation to race.
 *  Keep the span bounded — see the critical-section budget rule in
 *  .trellis/spec/backend/quality-guidelines.md. */
export function withWorkbenchMutationLock<T>(
  root: string,
  fn: () => T,
  deps: MutationLockDeps = {},
): T {
  return withMutationLock(
    { lockPath: mutationLockPath(root), key: root, noun: "workbench", staleMs: MUTATION_LOCK_STALE_MS },
    fn,
    deps,
  );
}

/** Filehub-scoped variant for `<filehub>/.jspace-logs/` state (pending
 *  envelopes). Sync, for short state transitions. */
export function withFilehubMutationLock<T>(
  fhRoot: string,
  fn: () => T,
  deps: MutationLockDeps = {},
): T {
  return withMutationLock(
    { lockPath: filehubMutationLockPath(fhRoot), key: fhRoot, noun: "filehub", staleMs: FILEHUB_MUTATION_LOCK_STALE_MS },
    fn,
    deps,
  );
}

/** Async variant: the pending applier awaits an external gbrain call inside the
 *  lock. Hold the lock for ONE envelope, never an unbounded batch — the stale
 *  budget is sized for a single call (see FILEHUB_MUTATION_LOCK_STALE_MS). */
export function withFilehubMutationLockAsync<T>(
  fhRoot: string,
  fn: () => Promise<T>,
  deps: MutationLockDeps = {},
): Promise<T> {
  return withMutationLockAsync(
    { lockPath: filehubMutationLockPath(fhRoot), key: fhRoot, noun: "filehub", staleMs: FILEHUB_MUTATION_LOCK_STALE_MS },
    fn,
    deps,
  );
}
