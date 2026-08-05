// application/automation/lock.test.ts — exclusive cron lock: O_EXCL acquire,
// stale removal, and ownership-token release (never clobbers a newer holder).
// Run: bun test application/automation/lock.test.ts
import { expect, test } from "bun:test";
import { acquireLock, type LockFs } from "./lock.ts";

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
