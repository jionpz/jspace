// cli/commands/harness-sets.test.ts — the CLI must *derive* its harness support
// sets from capabilities.yaml instead of carrying parallel hardcoded lists.
// Covers: `harness wire` option help/validation, and the production cron path
// (cronAdd → loadCrons → decodeCrons) accepting exactly the cron set.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArgError, parse, type CommandSpec } from "../../application/commands/command.ts";
import { cronHarnessNames, wireHarnessNames } from "../../adapters/harness/registry.ts";
import { COMMANDS } from "./registry.ts";
import { harnessSpec } from "./harness.ts";
import { cronAdd } from "../../application/automation/use-cases.ts";

const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };

function wireOption(): { help?: string; validate?: (v: string) => string | null } {
  const wire = harnessSpec.children!.find((c) => c.name === "wire")!;
  return wire.options![0];
}

describe("harness wire option derives from capabilities", () => {
  test("help lists exactly the derived wire set, in order", () => {
    expect(wireOption().help).toContain(wireHarnessNames().join("|"));
  });

  test("every derived harness passes argument parsing", () => {
    for (const h of wireHarnessNames()) {
      expect(() => parse(["harness", "wire", "--harness", h], ROOT)).not.toThrow();
    }
  });

  test("codex (cron-only) and unknown values are rejected at parse time (exit 2)", () => {
    for (const bad of ["codex", "nope"]) {
      let caught: ArgError | undefined;
      try {
        parse(["harness", "wire", "--harness", bad], ROOT);
      } catch (e) {
        caught = e instanceof ArgError ? e : undefined;
      }
      expect(caught).toBeDefined();
    }
  });
});

describe("cron harness set derives from capabilities", () => {
  test("help + accepted set match cronHarnessNames()", () => {
    const add = COMMANDS.find((c) => c.name === "cron")!.children!.find((c) => c.name === "add")!;
    const opt = add.options!.find((o) => o.name === "--harness")!;
    expect(opt.help).toContain(cronHarnessNames().join(" | "));
  });

  test("production cron path accepts every cron harness, rejects cursor", () => {
    const dir = mkdtempSync(join(tmpdir(), "jspace-cron-sets-"));
    try {
      const deps = { isInstalled: () => false };
      for (const h of cronHarnessNames()) {
        const r = cronAdd(dir, `job-${h}`, "0 21 * * *", h, "do it", false, deps, "linux");
        expect(r.exitCode).toBeUndefined();
      }
      // cursor is IDE-only (no headless CLI) → not a cron harness.
      expect(cronHarnessNames()).not.toContain("cursor");
      expect(() => cronAdd(dir, "job-cursor", "0 21 * * *", "cursor", "do it", false, deps, "linux")).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
