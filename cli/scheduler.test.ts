// cli/scheduler.test.ts — the PATH baked into a managed scheduler entry.
// issue #50: it must be derived from where the binaries actually ARE, never
// copied from the invoking shell — an unbounded interactive PATH breached the
// crontab 1000-char cap, so `cron install` failed on a command that has nothing
// to do with PATH, and the same install produced a different entry per shell.
// Run: bun test cli/scheduler.test.ts
import { expect, test } from "bun:test";
import { schedulerEnv, schedulerPath } from "./scheduler.ts";
import { crontabLine } from "../adapters/scheduler/linux.ts";
import type { CronDefinition } from "../core/contracts/cron.ts";

const SYSTEM_DIRS = ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

const CRON: CronDefinition = { id: "inbox-tidy", schedule: "0 21 * * *", harness: "claude", prompt: "x", enabled: true };

/** `which` stubs: name -> resolved path (a bare name = the miss fallback). */
function resolver(map: Record<string, string>): (name: string) => string {
  return (name) => map[name] ?? name;
}

test.skipIf(process.platform === "win32")("schedulerPath: harness + gbrain dirs first (deduped), system dirs last", () => {
  const path = schedulerPath(
    resolver({
      claude: "/Users/u/.local/bin/claude",
      codex: "/Users/u/.nvm/versions/node/v24.14.1/bin/codex",
      // grok/opencode/pi unresolved -> dropped
      opencode: "/opt/homebrew/bin/opencode",
      gbrain: "/Users/u/.bun/bin/gbrain",
    }),
    ["claude", "codex", "grok", "opencode", "pi", "gbrain", "gbrain"],
  );
  expect(path.split(":")).toEqual([
    "/Users/u/.local/bin",
    "/Users/u/.nvm/versions/node/v24.14.1/bin",
    "/opt/homebrew/bin",
    "/Users/u/.bun/bin",
    ...SYSTEM_DIRS,
  ]);
});

test.skipIf(process.platform === "win32")("schedulerPath: nothing resolves -> system dirs only, never the caller's PATH", () => {
  expect(schedulerPath(resolver({})).split(":")).toEqual(SYSTEM_DIRS);
});

test("issue #50: a long invoking-shell PATH can never push a crontab line over the cap", () => {
  const inflated = Array.from({ length: 60 }, (_, i) => `/opt/tool-${String(i).padStart(3, "0")}/bin`).join(":");
  expect(inflated.length).toBeGreaterThan(1000); // the shape that used to fail install

  const saved = process.env.PATH;
  process.env.PATH = inflated;
  try {
    // Nothing resolves: the entry must carry the bounded default, not the shell PATH.
    const env = schedulerEnv({ resolveBin: (name) => name });
    const line = crontabLine(CRON, "tag12345", "/tmp/wb", "/usr/local/bin/jspace", env.path, "/home/u");
    expect(line.length).toBeLessThan(1000);
    expect(line).not.toContain("/opt/tool-");
  } finally {
    if (saved === undefined) delete process.env.PATH;
    else process.env.PATH = saved;
  }
});

test.skipIf(process.platform === "win32")("issue #50: the entry stays under the cap even with deep harness dirs", () => {
  const deep = "/Users/u/.nvm/versions/node/v24.14.1/bin";
  const env = schedulerEnv({
    resolveBin: resolver({ claude: `${deep}/claude`, gbrain: "/Users/u/.bun/bin/gbrain" }),
  });
  const line = crontabLine(CRON, "tag12345", "/Users/u/jspace-work", "/Users/u/.local/bin/jspace", env.path, "/Users/u");
  expect(line.length).toBeLessThan(1000);
  expect(line).toContain(deep); // the run still needs the harness dir
});
