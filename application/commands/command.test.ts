// application/commands/command.test.ts — CommandSpec engine tests.
// Proves AC-B1: a fixture command needs only a CommandSpec registration — help,
// choices, argument validation and dispatch all derive from it automatically.
// Run: bun test application/commands/command.test.ts
import { expect, test } from "bun:test";
import {
  ArgError,
  buildHelp,
  parse,
  render,
  type CmdContext,
  type CommandSpec,
} from "./command.ts";

const helloSpec: CommandSpec = {
  name: "hello",
  summary: "greet a name",
  features: { json: true },
  positionals: [{ name: "name", help: "name to greet (default: world)" }],
  options: [{ name: "--shout", takesValue: false, help: "shout the greeting" }],
  handler: (ctx, args) => {
    const greeting = `hello, ${(args.name as string | undefined) ?? "world"}${args.shout ? "!" : ""}`;
    return { lines: [greeting], data: { greeting } };
  },
};

const resourceAddSpec: CommandSpec = {
  name: "add",
  summary: "add a resource",
  positionals: [{ name: "id", required: true, help: "resource id" }],
  options: [
    { name: "--domain", takesValue: true, required: true, help: "owning domain id" },
    { name: "--path", takesValue: true, group: "ep", help: "absolute path entrypoint" },
    { name: "--url", takesValue: true, group: "ep", help: "url entrypoint" },
  ],
  groups: [
    {
      id: "ep",
      members: ["--path", "--url"],
      required: true,
      message: "one of the arguments --path --url is required",
    },
  ],
  handler: () => ({ lines: ["ok"] }),
};

const resourceSpec: CommandSpec = {
  name: "resource",
  summary: "manage resources",
  commandArgName: "resource_command",
  children: [resourceAddSpec],
};

const cronRunSpec: CommandSpec = {
  name: "run",
  summary: "run a cron headlessly now",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  options: [
    {
      name: "--timeout",
      takesValue: true,
      metavar: "SECONDS",
      validate: (v) => (Number(v) > 0 ? null : "argument --timeout: invalid number"),
      help: "per-run timeout (default: 1800)",
    },
  ],
  handler: () => ({ lines: [] }),
};

const cronSpec: CommandSpec = {
  name: "cron",
  summary: "manage scheduled tasks",
  commandArgName: "cron_command",
  children: [cronRunSpec],
};

const root: CommandSpec = { name: "", summary: "", children: [helloSpec, resourceSpec, cronSpec] };

function run(argv: string[]): ReturnType<typeof parse> {
  return parse(argv, root);
}

function errText(fn: () => void): ArgError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ArgError) return e;
    throw e;
  }
  throw new Error("expected ArgError");
}

test("top help and choices derive from the registry", () => {
  const out = run(["-h"]);
  expect(out.kind).toBe("help");
  const text = (out as { text: string }).text;
  expect(text).toContain("usage: jspace [-h] [--version] {hello,resource,cron} ...");
  expect(text).toContain("hello");
  expect(text).toContain("resource");
  expect(text).toContain("cron");
});

test("unknown top command -> invalid choice with generated choices list", () => {
  const e = errText(() => run(["nope"]));
  expect(e.message).toBe("argument command: invalid choice: 'nope' (choose from 'hello', 'resource', 'cron')");
});

test("empty argv and leading option -> required command", () => {
  expect(errText(() => run([])).message).toBe("the following arguments are required: command");
  expect(errText(() => run(["--foo"])).message).toBe("the following arguments are required: command");
});

test("dispatch runs the registered handler with parsed args", async () => {
  const out = run(["hello", "jion"]);
  expect(out.kind).toBe("run");
  const r = out as { spec: CommandSpec; args: Record<string, unknown>; dir: string | undefined };
  expect(r.args.name).toBe("jion");
  expect(r.args.shout).toBe(false);
  expect(r.dir).toBeUndefined();
  const result = await r.spec.handler!({ json: false, dryRun: false, dir: undefined, root: "/tmp", cwd: "/tmp" }, r.args);
  expect(result.lines[0]).toBe("hello, jion");
});

test("feature flags flow into args and a --json context", async () => {
  const out = run(["hello", "--json", "--shout", "pi"]);
  expect(out.kind).toBe("run");
  const r = out as { spec: CommandSpec; args: Record<string, unknown> };
  expect(r.args.json).toBe(true);
  expect(r.args.shout).toBe(true);
  const result = await r.spec.handler!({ json: true, dryRun: false, dir: undefined, root: "/tmp", cwd: "/tmp" }, r.args);
  expect(result.data).toEqual({ greeting: "hello, pi!" });
});

test("render: human lines vs --json structured data", () => {
  const ctx: CmdContext = { json: false, dryRun: false, dir: undefined, root: "/tmp", cwd: "/tmp" };
  expect(render(ctx, { lines: ["a", "b"] })).toEqual(["a", "b"]);
  expect(render({ ...ctx, json: true }, { lines: ["ignored"], data: { x: 1 } })).toEqual(['{\n  "x": 1\n}']);
});

test("namespace with no subcommand -> required commandArgName", () => {
  expect(errText(() => run(["resource"])).message).toBe("the following arguments are required: resource_command");
});

test("required positional + required option ordering in the missing list", () => {
  const e = errText(() => run(["resource", "add"]));
  expect(e.message).toBe("the following arguments are required: id, --domain");
});

test("mutual-exclusion group: none -> required message; both -> not-allowed", () => {
  const none = errText(() => run(["resource", "add", "demo", "--domain", "files"]));
  expect(none.message).toBe("one of the arguments --path --url is required");
  const both = errText(() => run(["resource", "add", "demo", "--domain", "files", "--path", "/a", "--url", "https://x"]));
  expect(both.message).toBe("argument --url: not allowed with argument --path");
});

test("mutual-exclusion group is rendered once in usage (not duplicated as options)", () => {
  const help = buildHelp(resourceAddSpec, "jspace resource add", false);
  expect(help).toContain("(--path PATH | --url URL)");
  const usageLine = help.split("\n")[0];
  const pathCount = usageLine.split("--path").length - 1;
  expect(pathCount).toBe(1); // only inside the group, not as a standalone option
});

test("option validate rejects invalid value with the exact message", () => {
  const e = errText(() => run(["cron", "run", "--timeout", "abc", "nightly"]));
  expect(e.message).toBe("argument --timeout: invalid number");
});

test("extra positional is rejected as unrecognized", () => {
  const e = errText(() => run(["cron", "run", "a", "b"]));
  expect(e.message).toBe("unrecognized arguments: b");
});

test("unrecognized option inside a subcommand reports top usage/prog", () => {
  const e = errText(() => run(["hello", "--bogus"]));
  expect(e.prog).toBe("jspace");
  expect(e.message).toBe("unrecognized arguments: --bogus");
});

test("aliases resolve like the primary name", async () => {
  const aliasRoot: CommandSpec = {
    name: "",
    summary: "",
    children: [{ ...helloSpec, aliases: ["hi"] }],
  };
  const out = parse(["hi", "x"], aliasRoot);
  expect(out.kind).toBe("run");
});

test("--dry-run feature resolves to args.dryRun (dest mapping)", async () => {
  const applySpec: CommandSpec = {
    name: "apply",
    summary: "apply a change",
    features: { dryRun: true, dir: true },
    handler: (_ctx, args) => ({ lines: [args.dryRun ? "dry" : "live"], data: { dryRun: args.dryRun } }),
  };
  const root2: CommandSpec = { name: "", summary: "", children: [applySpec] };
  const out = parse(["apply", "--dry-run", "--dir", "/wb"], root2);
  expect(out.kind).toBe("run");
  const r = out as { args: Record<string, unknown>; dir: string | undefined };
  expect(r.args.dryRun).toBe(true);
  expect(r.dir).toBe("/wb");
});
