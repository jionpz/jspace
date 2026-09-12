// application/lock.test.ts — exclusive file lock: O_EXCL acquire,
// stale removal, and ownership-token release (never clobbers a newer holder).
// Run: bun test application/lock.test.ts
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "../core/shared/errors.ts";
import { GBRAIN_TIMEOUT_MS } from "../adapters/gbrain/gbrain.ts";
import {
  acquireLock,
  FILEHUB_MUTATION_LOCK_STALE_MS,
  filehubMutationLockPath,
  MUTATION_LOCK_STALE_MS,
  mutationLockPath,
  withFilehubMutationLock,
  withFilehubMutationLockAsync,
  withWorkbenchMutationLock,
  type LockFs,
} from "./lock.ts";

interface FakeFs extends LockFs {
  files: Record<string, string>;
  mtime: Record<string, number>;
  now0: number;
}

function fakeFs(initial: Record<string, string> = {}): FakeFs {
  const files: Record<string, string> = { ...initial };
  const mtime: Record<string, number> = {};
  const now0 = 1_000_000;
  let nextFd = 1;
  const fdToPath = new Map<number, string>();
  return {
    files,
    mtime,
    now0,
    openSync(p, _flags) {
      if (p in files) throw new Error("EEXIST");
      files[p] = "";
      const fd = nextFd++;
      fdToPath.set(fd, p);
      return fd;
    },
    writeSync(fd, content) {
      files[fdToPath.get(fd)!] = content;
    },
    closeSync(fd) {
      fdToPath.delete(fd);
    },
    readFileSync(p) {
      return files[p];
    },
    statSync(p) {
      return { mtimeMs: mtime[p] ?? now0 };
    },
    unlinkSync(p) {
      delete files[p];
    },
    existsSync(p) {
      return p in files;
    },
    now: () => now0,
  };
}

test("fresh lock held by another process -> null (skip), not removed", () => {
  const fs = fakeFs({ lock: "99999" });
  const lock = acquireLock("lock", "me", 1000, fs);
  expect(lock).toBeNull();
  expect(fs.files["lock"]).toBe("99999"); // untouched
});

test("stale lock is removed and re-acquired with our token", () => {
  const fs = fakeFs({ lock: "old-holder" });
  fs.mtime["lock"] = fs.now0 - 5000; // older than staleMs=1000
  const lock = acquireLock("lock", "me", 1000, fs);
  expect(lock?.held).toBe(true);
  expect(fs.files["lock"]).toBe("me");
});

test("acquire -> held; release removes only our token", () => {
  const fs = fakeFs();
  const lock = acquireLock("lock", "me", 1000, fs)!;
  expect(lock.held).toBe(true);
  lock.release();
  expect("lock" in fs.files).toBe(false);
});

test("release does not clobber a newer holder's lock (token mismatch)", () => {
  const fs = fakeFs();
  const lock = acquireLock("lock", "me", 1000, fs)!;
  // a later process replaced the lock after we finished our work
  fs.files["lock"] = "newer-holder";
  lock.release();
  expect(fs.files["lock"]).toBe("newer-holder"); // never deleted
});

test("release on a vanished lock is a no-op (no throw)", () => {
  const fs = fakeFs();
  const lock = acquireLock("lock", "me", 1000, fs)!;
  delete fs.files["lock"];
  expect(() => lock.release()).not.toThrow();
});

test("post-create write failure removes the poison lock and propagates (not EEXIST)", () => {
  // openSync("wx") succeeded (lock file is OURS) but the token write fails with
  // a real non-contention error (ENOSPC). This must NOT be treated as "another
  // holder" — the 0-byte poison lock is removed and the error is rethrown, so
  // every process is not blocked for staleMs (issue #8 #7).
  const fs = fakeFs();
  fs.writeSync = () => {
    const e = new Error("ENOSPC: no space left on device");
    (e as { code?: string }).code = "ENOSPC";
    throw e;
  };
  expect(() => acquireLock("lock", "me", 1000, fs)).toThrow(/ENOSPC/);
  expect(fs.files).toEqual({}); // poison lock cleaned up
  expect(fs.existsSync("lock")).toBe(false);
});


test("non-contention open error (EACCES) propagates, never becomes lock contention", () => {
  const fs = fakeFs();
  fs.openSync = () => {
    const e = new Error("EACCES: permission denied");
    (e as { code?: string }).code = "EACCES";
    throw e;
  };
  expect(() => acquireLock("lock", "me", 1000, fs)).toThrow(/EACCES/);
});

test("mutationLockPath uses .jspace/state/locks", () => {
  expect(mutationLockPath("/wb")).toBe(join("/wb", ".jspace", "state", "locks", "mutation.lock"));
});

test("workbench mutation lock fails fast when another holder is fresh", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-lock-"));
  try {
    const lockPath = mutationLockPath(root);
    const fs = fakeFs({ [lockPath]: "other-process" });
    fs.mtime[lockPath] = fs.now0;
    let ran = false;
    let thrown: unknown;
    try {
      withWorkbenchMutationLock(root, () => { ran = true; }, { fs, token: "me" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as Error).message).toContain("another jspace process is modifying this workbench");
    expect((thrown as Error).message).toContain(lockPath);
    expect(ran).toBe(false);
    expect(fs.files[lockPath]).toBe("other-process"); // fresh foreign lock untouched
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workbench mutation lock reclaims a stale lock and releases it after the callback", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-lock-"));
  try {
    const lockPath = mutationLockPath(root);
    const fs = fakeFs({ [lockPath]: "crashed-holder" });
    fs.mtime[lockPath] = fs.now0 - MUTATION_LOCK_STALE_MS - 1;
    let tokenWhileHeld = "";
    const result = withWorkbenchMutationLock(root, () => {
      tokenWhileHeld = fs.files[lockPath];
      return "ok";
    }, { fs, token: "me" });
    expect(result).toBe("ok");
    expect(tokenWhileHeld).toBe("me");
    expect(fs.existsSync(lockPath)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workbench mutation lock release never deletes a newer holder", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-lock-"));
  try {
    const lockPath = mutationLockPath(root);
    const fs = fakeFs();
    withWorkbenchMutationLock(root, () => {
      fs.files[lockPath] = "newer-holder"; // lock replaced after our critical section
    }, { fs, token: "me" });
    expect(fs.files[lockPath]).toBe("newer-holder");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("same-root reentry fails explicitly; different roots may be held together", () => {
  const rootA = mkdtempSync(join(tmpdir(), "jspace-lock-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "jspace-lock-b-"));
  try {
    let differentRootRan = false;
    withWorkbenchMutationLock(rootA, () => {
      expect(() => withWorkbenchMutationLock(rootA, () => undefined)).toThrow(/nested workbench mutation lock/);
      withWorkbenchMutationLock(rootB, () => { differentRootRan = true; });
    });
    expect(differentRootRan).toBe(true);
    expect(existsSync(mutationLockPath(rootA))).toBe(false);
    expect(existsSync(mutationLockPath(rootB))).toBe(false);
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});

test("lost-update control: unlocked interleave drops one writer", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-lock-"));
  const stateFile = join(root, "state.json");
  try {
    writeFileSync(stateFile, JSON.stringify({ items: [] }));
    const first = JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] };
    const second = JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] };
    first.items.push("first");
    second.items.push("second");
    writeFileSync(stateFile, JSON.stringify(first));
    writeFileSync(stateFile, JSON.stringify(second));
    expect((JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] }).items).toEqual(["second"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("locked read-modify-write sections serialize: both updates survive", () => {
  const root = mkdtempSync(join(tmpdir(), "jspace-lock-"));
  const stateFile = join(root, "state.json");
  try {
    writeFileSync(stateFile, JSON.stringify({ items: [] }));
    withWorkbenchMutationLock(root, () => {
      const state = JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] };
      state.items.push("first");
      writeFileSync(stateFile, JSON.stringify(state));
    });
    withWorkbenchMutationLock(root, () => {
      const state = JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] };
      state.items.push("second");
      writeFileSync(stateFile, JSON.stringify(state));
    });
    expect((JSON.parse(readFileSync(stateFile, "utf-8")) as { items: string[] }).items).toEqual(["first", "second"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- filehub mutation lock (pending envelopes) ----

test("filehubMutationLockPath lives next to the envelopes, not in a workbench", () => {
  expect(filehubMutationLockPath("/fh")).toBe(join("/fh", ".jspace-logs", "mutation.lock"));
});

test("filehub stale budget outlives one gbrain call, or a slow applier loses its lock", () => {
  // applyPending awaits gbrain inside the lock. If the stale budget were <= the
  // gbrain timeout, a slow-but-alive applier would be reclaimed mid-await and
  // two appliers could put the same envelope. Keep the two constants coupled.
  expect(FILEHUB_MUTATION_LOCK_STALE_MS).toBeGreaterThan(GBRAIN_TIMEOUT_MS);
});

test("filehub mutation lock fails fast when another holder is fresh", () => {
  const fhRoot = mkdtempSync(join(tmpdir(), "jspace-fhlock-"));
  try {
    const lockPath = filehubMutationLockPath(fhRoot);
    const fs = fakeFs({ [lockPath]: "other-process" });
    fs.mtime[lockPath] = fs.now0;
    let ran = false;
    let thrown: unknown;
    try {
      withFilehubMutationLock(fhRoot, () => { ran = true; }, { fs, token: "me" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as Error).message).toContain("another jspace process is modifying this filehub");
    expect((thrown as Error).message).toContain(lockPath);
    expect(ran).toBe(false);
    expect(fs.files[lockPath]).toBe("other-process");
  } finally {
    rmSync(fhRoot, { recursive: true, force: true });
  }
});

test("filehub stale threshold is the filehub budget, not the workbench one", () => {
  const fhRoot = mkdtempSync(join(tmpdir(), "jspace-fhlock-"));
  try {
    const lockPath = filehubMutationLockPath(fhRoot);
    const fs = fakeFs({ [lockPath]: "crashed-holder" });
    // older than the workbench budget but younger than the filehub budget:
    // a live applier awaiting gbrain must NOT be reclaimed.
    fs.mtime[lockPath] = fs.now0 - MUTATION_LOCK_STALE_MS - 1;
    expect(() => withFilehubMutationLock(fhRoot, () => undefined, { fs, token: "me" })).toThrow(CliError);
  } finally {
    rmSync(fhRoot, { recursive: true, force: true });
  }
});

test("filehub mutation lock rejects same-fhRoot reentry", () => {
  const fhRoot = mkdtempSync(join(tmpdir(), "jspace-fhlock-"));
  try {
    withFilehubMutationLock(fhRoot, () => {
      expect(() => withFilehubMutationLock(fhRoot, () => undefined)).toThrow(/nested filehub mutation lock/);
    });
    expect(existsSync(filehubMutationLockPath(fhRoot))).toBe(false);
  } finally {
    rmSync(fhRoot, { recursive: true, force: true });
  }
});

test("async filehub lock releases in finally when the callback rejects", async () => {
  const fhRoot = mkdtempSync(join(tmpdir(), "jspace-fhlock-"));
  try {
    await expect(
      withFilehubMutationLockAsync(fhRoot, async () => {
        throw new Error("put failed");
      }),
    ).rejects.toThrow("put failed");
    expect(existsSync(filehubMutationLockPath(fhRoot))).toBe(false);

    // and it serializes: a nested async acquire while held is a programmer error
    await withFilehubMutationLockAsync(fhRoot, async () => {
      await Promise.resolve();
      await expect(
        withFilehubMutationLockAsync(fhRoot, async () => undefined),
      ).rejects.toThrow(/nested filehub mutation lock/);
    });
  } finally {
    rmSync(fhRoot, { recursive: true, force: true });
  }
});
