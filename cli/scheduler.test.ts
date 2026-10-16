// cli/scheduler.test.ts — the PATH baked into a managed scheduler entry.
// issue #50: it must be derived from where the binaries actually ARE, never
// copied from the invoking shell — an unbounded interactive PATH breached the
// crontab 1000-char cap, so `cron install` failed on a command that has nothing
// to do with PATH, and the same install produced a different entry per shell.
// issue #50's other face (2026-10-14): the derived set must be the TRANSITIVE
// CLOSURE — a resolved shim whose `#!/usr/bin/env <interpreter>` needs another
// name lookup, and jspace itself (harness hooks call it by bare name) resolve
// off this same PATH, so "what jspace spawns" is not enough.
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

/** Shebang stubs: file path -> first line. Anything absent = no shebang line,
 *  so a test only names the shims it wants in the closure. */
function shebangs(map: Record<string, string>): (path: string) => string {
  return (path) => map[path] ?? "";
}

const NO_SHEBANG = shebangs({});

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
    NO_SHEBANG,
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
  expect(schedulerPath(resolver({}), undefined, NO_SHEBANG).split(":")).toEqual(SYSTEM_DIRS);
});

test.skipIf(process.platform === "win32")("closure: the DEFAULT name set asks for jspace, gbrain and the harnesses", () => {
  // The harness's own hooks/plugins resolve bare `jspace` off the SAME entry
  // PATH (templates wire `jspace context session-start|turn|session-end`).
  // Leaving jspace out of the default set is exactly the observed failure:
  // three headless logs carried `/bin/sh: jspace: command not found`
  // (2026-10-13/14/15). Asserting on the names actually queried is what makes
  // this red-capable — the old set was ["gbrain", ...cronHarnessNames()].
  const asked: string[] = [];
  schedulerPath((name) => { asked.push(name); return name; }, undefined, NO_SHEBANG);
  expect(asked).toContain("jspace");
  expect(asked).toContain("gbrain");
  expect(asked).toContain("claude");
});

test.skipIf(process.platform === "win32")("closure: a resolved jspace contributes its own directory", () => {
  const path = schedulerPath(resolver({ jspace: "/Users/u/.local/bin/jspace" }), ["jspace"], NO_SHEBANG);
  expect(path.split(":")[0]).toBe("/Users/u/.local/bin");
});

test.skipIf(process.platform === "win32")("closure: a shim's `#!/usr/bin/env <interpreter>` directory joins the entry", () => {
  // gbrain resolves to ~/.bun/bin/gbrain (a shim) whose shebang is
  // `#!/usr/bin/env bun`; bun lives in Homebrew, which is in neither the direct
  // resolution nor DEFAULT_PATH — so `which gbrain` hits but the run dies with
  // `env: bun: No such file or directory`.
  const path = schedulerPath(
    resolver({ gbrain: "/Users/u/.bun/bin/gbrain", bun: "/opt/homebrew/bin/bun" }),
    ["gbrain"],
    shebangs({ "/Users/u/.bun/bin/gbrain": "#!/usr/bin/env bun" }),
  );
  expect(path.split(":")).toEqual(["/Users/u/.bun/bin", "/opt/homebrew/bin", ...SYSTEM_DIRS]);
});

test.skipIf(process.platform === "win32")("closure: an absolute-path shebang needs no lookup, and its own shebang is followed", () => {
  // `#!<abs>` fixes the interpreter; PATH plays no part in reaching it. That
  // interpreter may itself be a shim, so the walk continues — here through an
  // absolute hop and then an `env` name lookup, which is the mixed chain a real
  // install produces. `bun` is deliberately absent from the resolver: it is
  // reached by path, not by name.
  const asked: string[] = [];
  const path = schedulerPath(
    (name) => { asked.push(name); return ({ gbrain: "/Users/u/.bun/bin/gbrain", node: "/usr/local/bin/node" })[name] ?? name; },
    ["gbrain"],
    shebangs({
      "/Users/u/.bun/bin/gbrain": "#!/Users/u/.bun/bin/bun",
      "/Users/u/.bun/bin/bun": "#!/usr/bin/env node",
    }),
  );
  expect(asked).toEqual(["gbrain", "node"]); // gbrain by name; bun by path, node by name
  // node's dir is /usr/local/bin, which the system-dir suffix already carries —
  // the union dedupes it rather than repeating it.
  expect(path.split(":")).toEqual(["/Users/u/.bun/bin", ...SYSTEM_DIRS]);
});

test.skipIf(process.platform === "win32")("closure: a relative/shebang-less target is not treated as a PATH hit", () => {
  // A shebang like `#!bun` (no slash) is not a valid interpreter path; it is a
  // name, so it goes through the same lookup-and-drop rule as everything else.
  const path = schedulerPath(
    resolver({ gbrain: "/Users/u/.bun/bin/gbrain" }),
    ["gbrain"],
    shebangs({ "/Users/u/.bun/bin/gbrain": "#!bun-not-on-path" }),
  );
  expect(path.split(":")).toEqual(["/Users/u/.bun/bin", ...SYSTEM_DIRS]);
});

test.skipIf(process.platform === "win32")("closure: a cyclic shebang chain terminates (visited set)", () => {
  const path = schedulerPath(
    resolver({ a: "/x/a", b: "/y/b" }),
    ["a"],
    shebangs({ "/x/a": "#!/usr/bin/env b", "/y/b": "#!/usr/bin/env a" }),
  );
  expect(path.split(":")).toEqual(["/x", "/y", ...SYSTEM_DIRS]);
});

test.skipIf(process.platform === "win32")("closure: a name lookup hit with no shebang adds only its own dir", () => {
  const path = schedulerPath(resolver({ claude: "/Users/u/.local/bin/claude" }), ["claude"], NO_SHEBANG);
  expect(path.split(":")).toEqual(["/Users/u/.local/bin", ...SYSTEM_DIRS]);
});

test.skipIf(process.platform === "win32")("closure: an unresolvable interpreter name drops out instead of adding a dir", () => {
  const path = schedulerPath(
    resolver({ gbrain: "/Users/u/.bun/bin/gbrain" }), // bun unresolved -> bare name
    ["gbrain"],
    shebangs({ "/Users/u/.bun/bin/gbrain": "#!/usr/bin/env bun-not-installed" }),
  );
  expect(path.split(":")).toEqual(["/Users/u/.bun/bin", ...SYSTEM_DIRS]);
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
