// application/automation/execute.test.ts — headless cron execution paths via
// injected deps + a fake harness binary (no real spawn of claude/codex).
// Covers: dry-run, same-day skip, lock occupied, suspect (exit 0 no output),
// timeout. The "harness" is a real tiny script we spawn, so stdout/exit
// behavior is genuine; harnessBin routes the argv to it.
// Run: bun test application/automation/execute.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cronRun, type ExecuteDeps } from "./execute.ts";
import { localDate } from "../time.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { SkillsManifestV1 } from "../../core/contracts/skills.ts";

const SKILLS: SkillsManifestV1 = { schema_version: 1, workbench: [], global: [] };
const BUNDLE: DistributionManifestV1 = { schema_version: 1, bundle_version: "test", files: [] };

let root: string;
let fakeHarness: string;
let silentHarness: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-exec-"));
  mkdirSync(join(root, ".jspace", "logs", "cron"), { recursive: true });
  writeFileSync(join(root, ".jspace", "cron.json"), JSON.stringify({
    schema_version: 1,
    crons: [
      { id: "weekly", schedule: "0 9 * * 1", harness: "claude", prompt: "report", enabled: true },
      { id: "inbox-tidy", schedule: "0 21 * * *", harness: "claude", target: { kind: "skill", skill: "asset-ingest", entrypoint: "batch", input: "tidy inbox" }, enabled: true },
    ],
  }));
  mkdirSync(join(root, ".jspace", "skills", "asset-ingest"), { recursive: true }); // satisfies inbox guard
  fakeHarness = join(root, "fake-harness");
  writeFileSync(fakeHarness, "#!/bin/sh\necho fake-harness-ran\nexit 0\n");
  chmodSync(fakeHarness, 0o755);
  silentHarness = join(root, "silent-harness");
  writeFileSync(silentHarness, "#!/bin/sh\nexit 0\n");
  chmodSync(silentHarness, 0o755);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const deps = (over: Partial<ExecuteDeps> = {}): ExecuteDeps => ({
  platform: "linux",
  filehubRoot: () => null,
  logDir: (r, c) => join(r, ".jspace", "logs", "cron", c),
  now: () => Date.now(),
  skillsManifest: SKILLS,
  bundleManifest: BUNDLE,
  readFile: () => null,
  diffBundle: () => [],
  readMaterializedJournal: () => null,
  harnessBin: fakeHarness,
  ...over,
});

function run(opts: { cronId: string; timeoutSec?: number; force?: boolean; dryRun?: boolean }, d = deps()) {
  return cronRun(root, { cronId: opts.cronId, timeoutSec: opts.timeoutSec ?? 10, force: opts.force ?? false, dryRun: opts.dryRun ?? false }, d);
}

test("dry-run returns the would-run argv without executing", async () => {
  const res = await run({ cronId: "weekly", dryRun: true });
  expect(res.lines[0]).toContain("dry-run: would run");
  expect(res.lines[1]).toContain("$ ");
  expect(res.lines[1]).toContain(fakeHarness); // argv routed to the fake harness
});

test("same-day success skip: second run is skipped without executing", async () => {
  const d = deps();
  await run({ cronId: "weekly" }, d); // first run writes status: ok
  const res = await run({ cronId: "weekly" }, d);
  expect(res.lines[0]).toContain("already succeeded today");
});

test("crash window: prose log says ok but RunRecord missing -> NOT skipped", async () => {
  // Simulate a crash between the prose-log write and the RunRecord write: a
  // .md says "status: ok" for today, but no structured record exists. Same-day
  // skip must NOT fire (machine truth = RunRecord, prose log is human payload).
  const logDir = join(root, ".jspace", "logs", "cron", "weekly");
  mkdirSync(logDir, { recursive: true });
  const today = localDate();
  writeFileSync(
    join(logDir, `${today}T120000-abcdef12.md`),
    `# cron weekly\nstatus: ok\n`,
    "utf-8",
  );
  const res = await run({ cronId: "weekly" });
  expect(res.lines[0]).not.toContain("already succeeded today");
  expect(res.lines[0]).toContain("(exit 0)"); // executed for real (skip path has no exit marker)
});

test("lock occupied -> skip (no execution)", async () => {
  const lock = join(root, ".jspace", "logs", "cron", "weekly.lock");
  writeFileSync(lock, "99999");
  // age = now - mtime < timeout*2000 -> treat as running
  const res = await run({ cronId: "weekly", timeoutSec: 10 }, deps({ now: () => Date.now() + 5_000 }));
  expect(res.lines[0]).toContain("already running");
});

test("lock staleness: threshold is timeoutSec*2000ms, not timeoutSec*2ms", async () => {
  // Integration-level unit-conversion guard: acquireLock's staleMs is ms, so
  // timeoutSec=1800 must yield a 3_600_000ms (1h) stale threshold. A 3.6s-old
  // lock must be FRESH (skip); a >1h lock must be stale (taken over). Under the
  // old bug (timeoutSec*2 = 3.6s threshold) the first case would wrongly steal.
  const lockPath = join(root, ".jspace", "logs", "cron", "weekly.lock");
  writeFileSync(lockPath, "99999");
  const mtime = statSync(lockPath).mtimeMs;
  const fresh = await run({ cronId: "weekly", timeoutSec: 1800 }, deps({ now: () => mtime + 3_600 }));
  expect(fresh.lines[0]).toContain("already running");
  const stale = await run({ cronId: "weekly", timeoutSec: 1800 }, deps({ now: () => mtime + 3_600_001 }));
  expect(stale.lines[0]).not.toContain("already running");
  expect(stale.lines[0]).toContain("(exit 0)"); // executed for real after taking over
});

test("suspect: exit 0 with no output", async () => {
  const d = deps({ harnessBin: silentHarness });
  const res = await run({ cronId: "weekly" }, d);
  expect(res.lines[0]).toContain("suspect");
});

test("timeout: harness that sleeps longer than timeout -> failed", async () => {
  const slow = join(root, "slow-harness");
  writeFileSync(slow, "#!/bin/sh\nsleep 30\nexit 0\n");
  chmodSync(slow, 0o755);
  const res = await run({ cronId: "weekly", timeoutSec: 1 }, deps({ harnessBin: slow }));
  expect(res.lines[0]).toContain("failed");
});

test("lock is released after success AND failure (no stale lock left)", async () => {
  const lock = join(root, ".jspace", "logs", "cron", "weekly.lock");
  await run({ cronId: "weekly" }, deps({ harnessBin: fakeHarness }));
  expect(existsSync(lock)).toBe(false); // success path releases
  const slow = join(root, "slow-harness");
  writeFileSync(slow, "#!/bin/sh\nsleep 30\nexit 0\n");
  chmodSync(slow, 0o755);
  await run({ cronId: "weekly", timeoutSec: 1 }, deps({ harnessBin: slow }));
  expect(existsSync(lock)).toBe(false); // failure/timeout path releases via finally
});
