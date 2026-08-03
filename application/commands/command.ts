// application/commands/command.ts — declarative CommandSpec framework.
//
// Single source for name/aliases/options/positionals/help/handler. The engine
// derives help text, argument collection, validation and dispatch from each
// spec — no separate CHOICES constants / *_HELP strings / parse switches.
// Mirrors the argparse surface it replaces (same error wording, exit code 2).
//
// Pure module: no console, no process.cwd, no filesystem side effects. CmdContext
// construction (which resolves paths) lives in the cli entry, not here.

// ---- spec types ------------------------------------------------------------

export interface PositionalSpec {
  name: string;
  /** default: false — mark required positionals explicitly */
  required?: boolean;
  /** consume all remaining positionals */
  rest?: boolean;
  /** return an error message, or null when valid */
  validate?: (value: string) => string | null;
  help: string;
}

export interface OptionSpec {
  name: string; // "--dir"
  short?: string; // "-h"
  takesValue: boolean;
  required?: boolean;
  repeatable?: boolean; // store-append (--tag)
  group?: string; // mutual-exclusion group id
  /** return an error message, or null when valid */
  validate?: (value: string) => string | null;
  metavar?: string;
  help: string;
}

export interface OptionGroup {
  id: string;
  members: string[]; // option names, e.g. ["--path", "--url"]
  required: boolean; // at least one member must be present
  message: string; // e.g. "one of the arguments --path --url is required"
}

/** Common options injected by the engine (not repeated per spec). */
export interface CommandFeatures {
  dir?: boolean; // inject --dir (workbench commands)
  json?: boolean; // inject --json (read/status)
  dryRun?: boolean; // inject --dry-run (mutating)
}

export interface CommandSpec<T = Record<string, unknown>> {
  name: string;
  aliases?: string[];
  summary: string; // one line for parent help
  description?: string; // shown after usage (optional)
  features?: CommandFeatures;
  options?: OptionSpec[];
  positionals?: PositionalSpec[];
  groups?: OptionGroup[];
  children?: CommandSpec<any>[];
  /** name of the required subcommand arg for a namespace node (default "command") */
  commandArgName?: string;
  /** full help text override; the engine does not generate for this spec */
  customHelp?: string;
  handler?: (ctx: CmdContext, args: T) => CmdResult | Promise<CmdResult>;
}

export interface CmdContext {
  json: boolean;
  dryRun: boolean;
  dir: string | undefined; // --dir
  root: string; // resolved workbench root (dir ?? cwd)
  cwd: string;
}

export interface CmdResult {
  exitCode?: number; // default 0; doctor/cron-check use 1 for unhealthy
  lines: string[]; // stdout lines (human or --json data)
  errors?: string[]; // stderr "jspace: error: ..." lines (no prefix needed)
  warnings?: string[]; // stderr "jspace: warning: ..." lines (no prefix needed)
  data?: unknown; // structured payload for --json
}

export type ParseOutcome =
  | { kind: "run"; spec: CommandSpec; args: Record<string, unknown>; dir: string | undefined }
  | { kind: "help"; text: string }
  | { kind: "version" };

// ---- error contract (exit 2; mirrors the legacy cli/args.ts ArgError) ------

export class ArgError extends Error {
  usage: string;
  prog: string;
  constructor(usage: string, prog: string, message: string) {
    super(message);
    this.usage = usage;
    this.prog = prog;
  }
}

function err(usage: string, prog: string, msg: string): never {
  throw new ArgError(usage, prog, msg);
}

// ---- option/help constants -------------------------------------------------

const HELP_OPTION: OptionSpec = {
  name: "--help",
  short: "-h",
  takesValue: false,
  help: "show this help message and exit",
};

const VERSION_OPTION: OptionSpec = {
  name: "--version",
  takesValue: false,
  help: "show program's version number and exit",
};

const FEATURE_OPTIONS: Record<keyof Required<CommandFeatures>, OptionSpec> = {
  dir: {
    name: "--dir",
    takesValue: true,
    metavar: "DIR",
    help: "workbench root directory (default: current directory)",
  },
  json: { name: "--json", takesValue: false, help: "output JSON" },
  dryRun: { name: "--dry-run", takesValue: false, help: "print the plan without executing" },
};

function featureOptions(features: CommandFeatures | undefined): OptionSpec[] {
  const out: OptionSpec[] = [];
  for (const key of ["dir", "json", "dryRun"] as const) {
    if (features?.[key]) out.push(FEATURE_OPTIONS[key]);
  }
  return out;
}

function allOptions(spec: CommandSpec): OptionSpec[] {
  return [...featureOptions(spec.features), ...(spec.options ?? [])];
}

function findOption(spec: CommandSpec, name: string): OptionSpec {
  const found = allOptions(spec).find((o) => o.name === name);
  if (!found) throw new Error(`option not found in spec: ${name}`);
  return found;
}

function optionToken(o: OptionSpec): string {
  const base = o.short ? `${o.short}, ${o.name}` : o.name;
  if (!o.takesValue) return base;
  return `${base} ${o.metavar ?? o.name.replace(/^--/, "").replace(/-/g, "_").toUpperCase()}`;
}

function groupMembersInUsage(spec: CommandSpec, g: OptionGroup): string {
  return g.members.map((m) => optionToken(findOption(spec, m))).join(" | ");
}

// ---- help generation -------------------------------------------------------

function buildUsage(spec: CommandSpec, prog: string, isRoot: boolean): string {
  const parts: string[] = [`[${HELP_OPTION.short}]`];
  if (isRoot) parts.push(`[${optionToken(VERSION_OPTION)}]`);
  const opts = allOptions(spec);
  const groups = spec.groups ?? [];
  // a group renders at the first member's position, and its members are not
  // listed separately (argparse renders "(--path PATH | --url URL)")
  const inGroup = new Set(groups.flatMap((g) => g.members));
  const anchors = new Map<string, number>();
  for (const g of groups) {
    const idx = opts.findIndex((o) => o.name === g.members[0]);
    anchors.set(g.id, idx === -1 ? opts.length : idx);
  }
  const emitted = new Set<string>();
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (inGroup.has(o.name)) continue;
    for (const g of groups) {
      if (anchors.get(g.id) === i && !emitted.has(g.id)) {
        parts.push(`(${groupMembersInUsage(spec, g)})`);
        emitted.add(g.id);
      }
    }
    parts.push(o.required ? optionToken(o) : `[${optionToken(o)}]`);
  }
  for (const g of groups) {
    if (!emitted.has(g.id)) {
      parts.push(`(${groupMembersInUsage(spec, g)})`);
      emitted.add(g.id);
    }
  }
  for (const p of spec.positionals ?? []) {
    parts.push(p.rest ? `[${p.name} ...]` : p.required ? p.name : `[${p.name}]`);
  }
  if ((spec.children?.length ?? 0) > 0) {
    parts.push(`{${(spec.children ?? []).map((c) => c.name).join(",")}}`);
    parts.push("...");
  }
  return `usage: ${prog} ${parts.join(" ")}`.trimEnd();
}

function usageBlock(helpText: string): string {
  const lines = helpText.split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (l === "") break;
    out.push(l);
  }
  return out.join("\n");
}

/** Align option/positional descriptions to argparse's help column (~24). */
function formatRows(rows: [string, string][]): string[] {
  if (rows.length === 0) return [];
  const width = Math.min(Math.max(...rows.map(([l]) => l.length)), 24);
  const out: string[] = [];
  for (const [label, desc] of rows) {
    if (label.length + 2 > width) {
      out.push(`  ${label}`);
      out.push(`${" ".repeat(width + 2)}${desc}`);
    } else {
      out.push(`  ${label.padEnd(width + 2)}${desc}`);
    }
  }
  return out;
}

export function buildHelp(spec: CommandSpec, prog: string, isRoot: boolean): string {
  if (spec.customHelp) return spec.customHelp;

  const lines: string[] = [buildUsage(spec, prog, isRoot)];
  if (spec.description) lines.push("", spec.description);

  const children = spec.children ?? [];
  if (children.length > 0) {
    lines.push("", "positional arguments:");
    lines.push(`  {${children.map((c) => c.name).join(",")}}`);
    const nameW = Math.max(...children.map((c) => c.name.length));
    for (const c of children) lines.push(`    ${c.name.padEnd(nameW + 2)}${c.summary}`);
  } else if ((spec.positionals?.length ?? 0) > 0) {
    lines.push("", "positional arguments:");
    const pos = spec.positionals as PositionalSpec[];
    const nameW = Math.max(...pos.map((p) => p.name.length));
    for (const p of pos) lines.push(`  ${p.name.padEnd(nameW + 2)}${p.help}`);
  }

  const opts = allOptions(spec);
  if (opts.length > 0) {
    lines.push("", "options:");
    const rows: [string, string][] = [[`${HELP_OPTION.short}, ${HELP_OPTION.name}`, HELP_OPTION.help]];
    if (isRoot) rows.push([optionToken(VERSION_OPTION), VERSION_OPTION.help]);
    for (const o of opts) rows.push([optionToken(o), o.help]);
    lines.push(...formatRows(rows));
  }
  return lines.join("\n");
}

// ---- argument collection ---------------------------------------------------

interface Collected {
  flags: Map<string, string[] | true>;
  positionals: string[];
  help: boolean;
}

function isHelpFlag(tok: string): boolean {
  return tok === "-h" || tok === "--help";
}

function splitOpt(tok: string): [string, string | null] {
  if (tok.startsWith("--") && tok.includes("=")) {
    const i = tok.indexOf("=");
    return [tok.slice(0, i), tok.slice(i + 1)];
  }
  return [tok, null];
}

function lastVal(list: string[] | true | undefined): string | undefined {
  if (Array.isArray(list) && list.length > 0) return list[list.length - 1];
  return undefined;
}

function collect(
  argv: string[],
  usage: string,
  prog: string,
  opts: OptionSpec[],
  unrecUsage: string,
  unrecProg: string,
): Collected {
  const flags = new Map<string, string[] | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === "--") {
      for (let j = i + 1; j < argv.length; j++) positionals.push(argv[j]);
      break;
    }
    if (raw.startsWith("-")) {
      const [name, inlineVal] = splitOpt(raw);
      if (isHelpFlag(name)) return { flags, positionals, help: true };
      const opt = opts.find((o) => o.name === name);
      if (!opt) throw new ArgError(unrecUsage, unrecProg, `unrecognized arguments: ${raw}`);
      if (opt.takesValue) {
        let val: string;
        if (inlineVal !== null) {
          val = inlineVal;
        } else {
          if (i + 1 >= argv.length) err(usage, prog, `argument ${name}: expected one argument`);
          const nxt = argv[i + 1];
          if (nxt.startsWith("-") && nxt !== "-") {
            err(usage, prog, `argument ${name}: expected one argument`);
          }
          val = argv[++i];
        }
        const list = flags.get(name);
        if (Array.isArray(list)) list.push(val);
        else flags.set(name, [val]);
      } else {
        if (inlineVal !== null) throw new ArgError(unrecUsage, unrecProg, `unrecognized arguments: ${raw}`);
        flags.set(name, true);
      }
    } else {
      positionals.push(raw);
    }
  }
  return { flags, positionals, help: false };
}

// ---- validation + args construction ---------------------------------------

function buildArgs(
  spec: CommandSpec,
  collected: Collected,
  usage: string,
  prog: string,
  unrecUsage: string,
  unrecProg: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const opts = allOptions(spec);
  const groups = spec.groups ?? [];
  const inGroup = new Set(groups.flatMap((g) => g.members));

  const keyOf = (name: string): string => name.replace(/^--/, "").replace(/-/g, "_");

  // option values
  for (const o of opts) {
    const key = keyOf(o.name);
    const raw = collected.flags.get(o.name);
    if (raw === true) args[key] = true;
    else if (Array.isArray(raw)) args[key] = o.repeatable ? raw : lastVal(raw);
    else args[key] = o.takesValue ? undefined : false;
  }

  // required positionals (declared order) then required options (declared order)
  const missing: string[] = [];
  const pos = spec.positionals ?? [];
  for (let i = 0; i < pos.length; i++) {
    const p = pos[i];
    const present = p.rest ? collected.positionals.length > i : collected.positionals[i] !== undefined;
    if (p.required && !present) missing.push(p.name);
  }
  for (const o of opts) {
    if (o.required && !inGroup.has(o.name) && collected.flags.get(o.name) === undefined) {
      missing.push(o.name);
    }
  }
  if (missing.length) {
    err(usage, prog, `the following arguments are required: ${missing.join(", ")}`);
  }

  // positional arity / assignment
  const restIdx = pos.findIndex((p) => p.rest);
  if (pos.length === 0) {
    if (collected.positionals.length > 0) {
      throw new ArgError(unrecUsage, unrecProg, `unrecognized arguments: ${collected.positionals.join(" ")}`);
    }
  } else if (restIdx === -1) {
    if (collected.positionals.length > pos.length) {
      throw new ArgError(unrecUsage, unrecProg, `unrecognized arguments: ${collected.positionals.slice(pos.length).join(" ")}`);
    }
    for (let i = 0; i < pos.length; i++) args[pos[i].name] = collected.positionals[i];
  } else {
    for (let i = 0; i < restIdx; i++) args[pos[i].name] = collected.positionals[i];
    args[pos[restIdx].name] = collected.positionals.slice(restIdx);
  }

  // mutual-exclusion groups + required groups
  for (const g of groups) {
    const present = g.members.filter((m) => collected.flags.get(m) !== undefined);
    if (present.length > 1) {
      err(usage, prog, `argument ${present[present.length - 1]}: not allowed with argument ${present[present.length - 2]}`);
    }
    if (g.required && present.length === 0) err(usage, prog, g.message);
  }

  // per-option validation (single values; repeatables validated element-wise)
  for (const o of opts) {
    if (!o.validate) continue;
    const raw = collected.flags.get(o.name);
    if (o.repeatable && Array.isArray(raw)) {
      for (const v of raw) {
        const e = o.validate(v);
        if (e) err(usage, prog, e);
      }
    } else if (Array.isArray(raw)) {
      const e = o.validate(lastVal(raw) as string);
      if (e) err(usage, prog, e);
    }
  }
  for (const p of pos) {
    if (!p.validate) continue;
    const vals = p.rest ? (args[p.name] as string[]) : [args[p.name] as string];
    for (const v of vals ?? []) {
      if (typeof v === "string") {
        const e = p.validate(v);
        if (e) err(usage, prog, e);
      }
    }
  }

  return args;
}

// ---- parse / dispatch ------------------------------------------------------

function resolveCommand(
  root: CommandSpec,
  argv: string[],
  progBase: string,
): { spec: CommandSpec; rest: string[]; prog: string } {
  let current = root;
  let prog = progBase;
  let rest = argv;
  for (;;) {
    const head = rest[0];
    const child = (current.children ?? []).find(
      (c) => c.name === head || (c.aliases ?? []).includes(head),
    );
    if (!child) break;
    prog = `${prog} ${head}`;
    current = child;
    rest = rest.slice(1);
    if ((child.children?.length ?? 0) === 0) break;
  }
  return { spec: current, rest, prog };
}

export function parse(
  argv: string[],
  root: CommandSpec,
  env: { prog?: string } = {},
): ParseOutcome {
  const progBase = env.prog ?? "jspace";
  const rootHelp = buildHelp(root, progBase, true);
  const rootUsage = usageBlock(rootHelp);

  if (argv.length === 0) {
    err(rootUsage, progBase, "the following arguments are required: command");
  }
  if (argv[0] === "--version") return { kind: "version" };
  if (isHelpFlag(argv[0])) return { kind: "help", text: rootHelp };
  if (argv[0].startsWith("-")) {
    err(rootUsage, progBase, "the following arguments are required: command");
  }

  const topChildren = root.children ?? [];
  const topMatch = topChildren.some((c) => c.name === argv[0] || (c.aliases ?? []).includes(argv[0]));
  if (!topMatch) {
    err(rootUsage, progBase, `argument command: invalid choice: '${argv[0]}' (choose from '${topChildren.map((c) => c.name).join("', '")}')`);
  }

  const { spec, rest, prog } = resolveCommand(root, argv, progBase);
  const helpText = buildHelp(spec, prog, false);
  const usage = usageBlock(helpText);

  const opts = allOptions(spec);
  const collected = collect(rest, usage, prog, opts, rootUsage, progBase);
  if (collected.help) return { kind: "help", text: helpText };
  if (spec.handler === undefined) {
    err(usage, prog, `the following arguments are required: ${spec.commandArgName ?? "command"}`);
  }

  const args = buildArgs(spec, collected, usage, prog, rootUsage, progBase);
  return {
    kind: "run",
    spec,
    args,
    dir: typeof args.dir === "string" ? args.dir : undefined,
  };
}

// ---- rendering -------------------------------------------------------------

/** Pure: returns the lines to print; warnings are surfaced separately. */
export function render(ctx: CmdContext, result: CmdResult): string[] {
  if (ctx.json && result.data !== undefined) {
    return [JSON.stringify(result.data, null, 2)];
  }
  return [...result.lines];
}
