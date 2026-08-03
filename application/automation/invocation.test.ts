// application/automation/invocation.test.ts — CronRunInvocation argv round-trip.
// Closes audit F1: the argv scheduler backends serialize (via invocationArgv)
// must parse back through the real parser. Run: bun test application/automation/invocation.test.ts
import { expect, test } from "bun:test";
import { parse, type CommandSpec } from "../commands/command.ts";
import { COMMANDS } from "../../cli/commands/registry.ts";
import { invocationArgv } from "./invocation.ts";

const ROOT: CommandSpec = { name: "", summary: "", children: COMMANDS };

test("invocationArgv round-trips through the real parser (force + timeout)", () => {
  const argv = invocationArgv({ workbench: "/wb", cronId: "nightly", timeoutSec: 600, force: true });
  expect(argv).toEqual(["cron", "run", "--id", "nightly", "--dir", "/wb", "--force", "--timeout", "600"]);
  const out = parse(argv, ROOT);
  expect(out.kind).toBe("run");
  const r = (out as { args: Record<string, unknown> }).args;
  expect(r.id).toBe("nightly");
  expect(r.dir).toBe("/wb");
  expect(r.force).toBe(true);
  expect(r.timeout).toBe("600");
});

test("three platform backend representative invocations all parse", () => {
  // launchd (macOS), crontab (Linux), schtasks (Windows) all compile via
  // invocationArgv; these instances mirror what each backend would install.
  const cases: { inv: Parameters<typeof invocationArgv>[0] }[] = [
    { inv: { workbench: "/Users/a/jworkspace", cronId: "inbox-tidy" } },
    { inv: { workbench: "/home/a/wb", cronId: "weekly-report", timeoutSec: 900 } },
    { inv: { workbench: "C:\\Users\\a\\wb", cronId: "memory-consolidate", force: true } },
  ];
  for (const { inv } of cases) {
    const out = parse(invocationArgv(inv), ROOT);
    expect(out.kind).toBe("run");
    const r = (out as { args: Record<string, unknown> }).args;
    expect(r.id).toBe(inv.cronId);
    expect(r.dir).toBe(inv.workbench);
    expect(r.force).toBe(inv.force === true);
    expect(r.timeout ?? "1800").toBe(inv.timeoutSec !== undefined ? String(inv.timeoutSec) : "1800");
  }
});

test("positional id and --id are equivalent", () => {
  const pos = parse(["cron", "run", "nightly", "--dir", "/wb"], ROOT);
  const flag = parse(["cron", "run", "--id", "nightly", "--dir", "/wb"], ROOT);
  expect((pos as { args: Record<string, unknown> }).args.id).toBe("nightly");
  expect((flag as { args: Record<string, unknown> }).args.id).toBe("nightly");
});

test("both --id and positional id is ambiguous", () => {
  expect(() => parse(["cron", "run", "--id", "a", "b"], ROOT)).toThrow(/ambiguous/);
});

test("no id (neither --id nor positional) fails at the handler", async () => {
  const out = parse(["cron", "run"], ROOT);
  expect(out.kind).toBe("run");
  const r = out as { spec: CommandSpec; args: Record<string, unknown> };
  expect(r.args.id).toBeUndefined();
  await expect(
    r.spec.handler!({ json: false, dryRun: false, dir: undefined, root: "/wb", cwd: "/" }, r.args),
  ).rejects.toThrow(/required: id/);
});
