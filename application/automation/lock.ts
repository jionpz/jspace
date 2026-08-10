// application/automation/lock.ts — exclusive cron single-instance lock.
// Acquired with O_EXCL create (no TOCTOU between check + create); the holder
// writes an ownership token and release() only removes the file if it still
// carries OUR token — a stale or replaced lock is never clobbered. fs/clock are
// injected so acquisition and staleness are testable without real files.
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

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

export interface CronLock {
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
export function acquireLock(path: string, token: string, staleMs: number, fs: LockFs = realFs): CronLock | null {
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
): CronLock | null {
  return acquireLock(path, token, staleMs, { ...fs, now });
}
