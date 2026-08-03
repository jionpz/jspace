// cli/args.ts — hand-rolled parser mirroring the Python argparse surface.
// Produces the same --help text, `jspace: error:` / `jspace <cmd>: error:`
// messages and exit code 2.
import { cmdInit } from "./init.ts";
import { cmdDoctor, cmdDomainList, cmdDomainAdd, cmdDomainRemove, cmdResourceList, cmdResourceAdd, cmdResourceRemove, cmdFilehubInit, cmdInboxStatus } from "./cmds.ts";
import { cmdCronAdd, cmdCronList, cmdCronRemove, cmdCronInstall, cmdCronUninstall, cmdCronRun, cmdCronStatus } from "./cron.ts";

export const VERSION = "1.0.0";

export class ArgError extends Error {
  usage: string;
  prog: string;
  constructor(usage: string, prog: string, message: string) {
    super(message);
    this.usage = usage;
    this.prog = prog;
  }
}

const TOP_CHOICES = ["init", "doctor", "domain", "resource", "filehub", "inbox", "cron"];
const DOMAIN_CHOICES = ["list", "add", "remove"];
const RESOURCE_CHOICES = ["list", "add", "remove"];
const FILEHUB_CHOICES = ["init"];
const INBOX_CHOICES = ["status"];
const CRON_CHOICES = ["add", "list", "remove", "install", "uninstall", "run", "status"];

const TOP = "jspace";
const P_INIT = "jspace init";
const P_DOCTOR = "jspace doctor";
const P_DOMAIN = "jspace domain";
const P_DOMAIN_LIST = "jspace domain list";
const P_DOMAIN_ADD = "jspace domain add";
const P_DOMAIN_REMOVE = "jspace domain remove";
const P_RESOURCE = "jspace resource";
const P_RESOURCE_LIST = "jspace resource list";
const P_RESOURCE_ADD = "jspace resource add";
const P_RESOURCE_REMOVE = "jspace resource remove";
const P_FILEHUB = "jspace filehub";
const P_FILEHUB_INIT = "jspace filehub init";
const P_INBOX = "jspace inbox";
const P_INBOX_STATUS = "jspace inbox status";
const P_CRON = "jspace cron";
const P_CRON_ADD = "jspace cron add";
const P_CRON_LIST = "jspace cron list";
const P_CRON_REMOVE = "jspace cron remove";
const P_CRON_INSTALL = "jspace cron install";
const P_CRON_UNINSTALL = "jspace cron uninstall";
const P_CRON_RUN = "jspace cron run";
const P_CRON_STATUS = "jspace cron status";

const TOP_HELP = `usage: jspace [-h] [--version] {init,doctor,domain,resource,filehub,inbox,cron} ...

JSpace - create and validate local workbenches.

positional arguments:
  {init,doctor,domain,resource,filehub,inbox,cron}
    init                initialize a new JSpace workbench in a target
                        directory
    doctor              validate an existing JSpace workbench registry
    domain              manage workbench domains
    resource            manage workbench resources
    filehub             manage the file management center (asset layer)
    inbox               inspect files waiting in the inbox
    cron                manage scheduled tasks (declarative + launchd)

options:
  -h, --help            show this help message and exit
  --version             show program's version number and exit`;

const INIT_HELP = `usage: jspace init [-h] [--force] [target]

positional arguments:
  target      target directory (default: current directory)

options:
  -h, --help  show this help message and exit
  --force     allow initialization into a non-empty directory`;

const DOCTOR_HELP = `usage: jspace doctor [-h] [--dir DIR]

options:
  -h, --help  show this help message and exit
  --dir DIR   workbench root directory (default: current directory)`;

const DOMAIN_HELP = `usage: jspace domain [-h] {list,add,remove} ...

positional arguments:
  {list,add,remove}
    list             list domains
    add              add a domain
    remove           remove a domain

options:
  -h, --help         show this help message and exit`;

const DOMAIN_LIST_HELP = `usage: jspace domain list [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json      output JSON`;

const DOMAIN_ADD_HELP = `usage: jspace domain add [-h] [--path PATH] [--tag TAG] [--purpose PURPOSE] id

positional arguments:
  id                 domain id (lowercase letters, digits, and hyphens)

options:
  -h, --help         show this help message and exit
  --path PATH        relative path inside the workbench (default:
                     workspace/<id>)
  --tag TAG          domain tag (repeatable)
  --purpose PURPOSE  domain purpose`;

const DOMAIN_REMOVE_HELP = `usage: jspace domain remove [-h] [--purge] id

positional arguments:
  id          domain id

options:
  -h, --help  show this help message and exit
  --purge     also delete the domain directory`;

const RESOURCE_HELP = `usage: jspace resource [-h] {list,add,remove} ...

positional arguments:
  {list,add,remove}
    list             list resources
    add              add a resource
    remove           remove a resource

options:
  -h, --help         show this help message and exit`;

const RESOURCE_LIST_HELP = `usage: jspace resource list [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json      output JSON`;

const RESOURCE_ADD_HELP = `usage: jspace resource add [-h] --domain DOMAIN [--type TYPE] (--path PATH |
                           --url URL) [--tag TAG] [--notes NOTES]
                           id

positional arguments:
  id               resource id (lowercase letters, digits, and hyphens)

options:
  -h, --help       show this help message and exit
  --domain DOMAIN  owning domain id
  --type TYPE      resource type (default: project)
  --path PATH      absolute path entrypoint
  --url URL        url entrypoint
  --tag TAG        resource tag (repeatable)
  --notes NOTES    resource notes`;

const RESOURCE_REMOVE_HELP = `usage: jspace resource remove [-h] id

positional arguments:
  id          resource id

options:
  -h, --help  show this help message and exit`;

const FILEHUB_HELP = `usage: jspace filehub [-h] {init} ...

positional arguments:
  {init}
    init             create a file management center skeleton (asset layer)

options:
  -h, --help  show this help message and exit`;

const FILEHUB_INIT_HELP = `usage: jspace filehub init [-h] [--register] [--domain DOMAIN] root

positional arguments:
  root             filehub root directory (absolute or relative path)

options:
  -h, --help       show this help message and exit
  --register       also register the filehub in the current workbench
                   (.jspace/hub.json) as type=filehub
  --domain DOMAIN  owning domain id (default: files; created if missing)`;

const INBOX_HELP = `usage: jspace inbox [-h] {status} ...

positional arguments:
  {status}
    status           list files waiting in the inbox (read-only)

options:
  -h, --help  show this help message and exit`;

const INBOX_STATUS_HELP = `usage: jspace inbox status [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json      output JSON`;

const CRON_HELP = `usage: jspace cron [-h] {add,list,remove,install,uninstall,run,status} ...

positional arguments:
  {add,list,remove,install,uninstall,run,status}
    add                add a cron definition
    list               list cron definitions
    remove             remove a cron definition
    install            install enabled crons into macOS launchd
    uninstall          remove installed launchd agents
    run                run a cron headlessly now
    status             show last run result

options:
  -h, --help  show this help message and exit`;

const CRON_ADD_HELP = `usage: jspace cron add [-h] --schedule SCHEDULE --harness HARNESS
                     --prompt PROMPT [--disabled] id

positional arguments:
  id                 cron id (lowercase letters, digits, and hyphens)

options:
  -h, --help         show this help message and exit
  --schedule SCHEDULE  restricted 5-field cron expression (e.g. "0 21 * * *";
                     single values or *; no lists/ranges/steps)
  --harness HARNESS  harness to run: claude | codex | pi
  --prompt PROMPT    instruction for the headless harness
  --disabled         add the cron disabled`;

const CRON_LIST_HELP = `usage: jspace cron list [-h] [--json]

options:
  -h, --help  show this help message and exit
  --json      output JSON`;

const CRON_REMOVE_HELP = `usage: jspace cron remove [-h] id

positional arguments:
  id          cron id

options:
  -h, --help  show this help message and exit`;

const CRON_INSTALL_HELP = `usage: jspace cron install [-h]

options:
  -h, --help  show this help message and exit`;

const CRON_UNINSTALL_HELP = `usage: jspace cron uninstall [-h]

options:
  -h, --help  show this help message and exit`;

const CRON_RUN_HELP = `usage: jspace cron run [-h] [--dry-run] [--timeout SECONDS] [--dir DIR] id

positional arguments:
  id               cron id

options:
  -h, --help       show this help message and exit
  --dry-run        print the command that would run, without executing
  --timeout SECONDS  per-run timeout (default: 1800)
  --dir DIR        workbench root (default: current directory; schedulers
                   pass this explicitly)`;

const CRON_STATUS_HELP = `usage: jspace cron status [-h] [id]

positional arguments:
  id          cron id (default: all)

options:
  -h, --help  show this help message and exit`;

export interface Invocation {
  action: "help" | "version" | "run";
  text?: string;
  run?: (values: Record<string, unknown>) => void;
  values?: Record<string, unknown>;
}

/** Parse error reported by the NESTED parser (its own usage + prog prefix). */
function err(usage: string, prog: string, msg: string): never {
  throw new ArgError(usage, prog, msg);
}
/** "unrecognized arguments" bubbles to the top parser (top usage + jspace:). */
function unrecognized(msg: string): never {
  throw new ArgError(usageBlock(TOP_HELP), TOP, msg);
}
function help(text: string): Invocation {
  return { action: "help", text };
}

/** Split "--opt=value" -> ["--opt","value"]; plain -> [token]. */
function splitOpt(tok: string): [string, string | null] {
  if (tok.startsWith("--") && tok.includes("=")) {
    const i = tok.indexOf("=");
    return [tok.slice(0, i), tok.slice(i + 1)];
  }
  return [tok, null];
}

function isHelpFlag(tok: string): boolean {
  return tok === "-h" || tok === "--help";
}

/** Last value for single-value options (argparse store action: last wins). */
function lastVal(flags: Map<string, (string | true)[]>, name: string): string | undefined {
  const list = flags.get(name);
  if (!list || list.length === 0) return undefined;
  const v = list[list.length - 1];
  return typeof v === "string" ? v : undefined;
}

// ---- option-value collector: consumes argv into {flags, positionals, help} ----
interface Collected {
  flags: Map<string, (string | true)[]>;
  positionals: string[];
  help: boolean;
}
function collect(
  argv: string[],
  usage: string,
  prog: string,
  opts: { name: string; takesValue: boolean }[],
): Collected {
  const flags = new Map<string, (string | true)[]>();
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
      if (!opt) unrecognized(`unrecognized arguments: ${raw}`);
      const list = flags.get(name) ?? [];
      if (opt.takesValue) {
        let val: string;
        if (inlineVal !== null) {
          val = inlineVal;
        } else {
          if (i + 1 >= argv.length) err(usage, prog, `argument ${name}: expected one argument`);
          const nxt = argv[i + 1];
          // argparse: a token starting with '-' (except a bare '-') is never
          // consumed as a value — reject it as "expected one argument".
          if (nxt.startsWith("-") && nxt !== "-") {
            err(usage, prog, `argument ${name}: expected one argument`);
          }
          val = argv[++i];
        }
        list.push(val);
      } else {
        if (inlineVal !== null) unrecognized(`unrecognized arguments: ${raw}`);
        list.push(true);
      }
      flags.set(name, list);
    } else {
      positionals.push(raw);
    }
  }
  return { flags, positionals, help: false };
}

function extraPositional(usage: string, extras: string[]): never {
  return unrecognized(`unrecognized arguments: ${extras.join(" ")}`);
}

export function parseArgs(argv: string[]): Invocation {
  if (argv.length === 0) {
    err(usageBlock(TOP_HELP), TOP, "the following arguments are required: command");
  }
  if (argv[0] === "--version") return { action: "version" };
  if (isHelpFlag(argv[0])) return help(TOP_HELP);
  if (argv[0].startsWith("-")) {
    // argparse treats an unknown leading option as "command missing".
    err(usageBlock(TOP_HELP), TOP, "the following arguments are required: command");
  }

  const cmd = argv[0];
  if (!TOP_CHOICES.includes(cmd)) {
    err(
      usageBlock(TOP_HELP),
      TOP,
      `argument command: invalid choice: '${cmd}' (choose from '${TOP_CHOICES.join("', '")}')`,
    );
  }
  const rest = argv.slice(1);
  switch (cmd) {
    case "init": return parseInit(rest);
    case "doctor": return parseDoctor(rest);
    case "domain": return parseDomain(rest);
    case "resource": return parseResource(rest);
    case "filehub": return parseFilehub(rest);
    case "inbox": return parseInbox(rest);
    case "cron": return parseCron(rest);
  }
  throw new Error("unreachable");
}

/** Usage block: consecutive leading lines of the help text (argparse prints the
 *  full wrapped usage in errors). */
function usageBlock(helpText: string): string {
  const lines = helpText.split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (l === "") break;
    out.push(l);
  }
  return out.join("\n");
}

function parseInit(argv: string[]): Invocation {
  const usage = usageBlock(INIT_HELP);
  const c = collect(argv, usage, P_INIT, [{ name: "--force", takesValue: false }]);
  if (c.help) return help(INIT_HELP);
  if (c.positionals.length > 1) extraPositional(usage, c.positionals.slice(1));
  return {
    action: "run",
    run: (v) => cmdInit(v.target as string | undefined, !!v.force),
    values: { target: c.positionals[0], force: !!c.flags.get("--force")?.length },
  };
}

function parseDoctor(argv: string[]): Invocation {
  const usage = usageBlock(DOCTOR_HELP);
  const c = collect(argv, usage, P_DOCTOR, [{ name: "--dir", takesValue: true }]);
  if (c.help) return help(DOCTOR_HELP);
  if (c.positionals.length > 0) extraPositional(usage, c.positionals);
  return {
    action: "run",
    run: (v) => cmdDoctor(v.dir as string),
    values: { dir: lastVal(c.flags, "--dir") ?? "." },
  };
}

function parseDomain(argv: string[]): Invocation {
  const usage = usageBlock(DOMAIN_HELP);
  if (argv.length === 0) err(usage, P_DOMAIN, "the following arguments are required: domain_command");
  if (isHelpFlag(argv[0])) return help(DOMAIN_HELP);
  const sub = argv[0];
  if (!DOMAIN_CHOICES.includes(sub)) {
    err(usage, P_DOMAIN, `argument domain_command: invalid choice: '${sub}' (choose from '${DOMAIN_CHOICES.join("', '")}')`);
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "list": {
      const u = usageBlock(DOMAIN_LIST_HELP);
      const c = collect(rest, u, P_DOMAIN_LIST, [{ name: "--json", takesValue: false }]);
      if (c.help) return help(DOMAIN_LIST_HELP);
      if (c.positionals.length > 0) extraPositional(u, c.positionals);
      return { action: "run", run: (v) => cmdDomainList(!!v.json), values: { json: !!c.flags.get("--json")?.length } };
    }
    case "add": {
      const u = usageBlock(DOMAIN_ADD_HELP);
      const c = collect(rest, u, P_DOMAIN_ADD, [
        { name: "--path", takesValue: true },
        { name: "--tag", takesValue: true },
        { name: "--purpose", takesValue: true },
      ]);
      if (c.help) return help(DOMAIN_ADD_HELP);
      if (c.positionals.length === 0) err(u, P_DOMAIN_ADD, "the following arguments are required: id");
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return {
        action: "run",
        run: (v) => cmdDomainAdd(v.id as string, v.path as string | undefined, v.tags as string[], v.purpose as string | undefined),
        values: {
          id: c.positionals[0],
          path: lastVal(c.flags, "--path"),
          tags: c.flags.get("--tag") as string[] | undefined,
          purpose: lastVal(c.flags, "--purpose"),
        },
      };
    }
    case "remove": {
      const u = usageBlock(DOMAIN_REMOVE_HELP);
      const c = collect(rest, u, P_DOMAIN_REMOVE, [{ name: "--purge", takesValue: false }]);
      if (c.help) return help(DOMAIN_REMOVE_HELP);
      if (c.positionals.length === 0) err(u, P_DOMAIN_REMOVE, "the following arguments are required: id");
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return {
        action: "run",
        run: (v) => cmdDomainRemove(v.id as string, !!v.purge),
        values: { id: c.positionals[0], purge: !!c.flags.get("--purge")?.length },
      };
    }
  }
  throw new Error("unreachable");
}

function parseResource(argv: string[]): Invocation {
  const usage = usageBlock(RESOURCE_HELP);
  if (argv.length === 0) err(usage, P_RESOURCE, "the following arguments are required: resource_command");
  if (isHelpFlag(argv[0])) return help(RESOURCE_HELP);
  const sub = argv[0];
  if (!RESOURCE_CHOICES.includes(sub)) {
    err(usage, P_RESOURCE, `argument resource_command: invalid choice: '${sub}' (choose from '${RESOURCE_CHOICES.join("', '")}')`);
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "list": {
      const u = usageBlock(RESOURCE_LIST_HELP);
      const c = collect(rest, u, P_RESOURCE_LIST, [{ name: "--json", takesValue: false }]);
      if (c.help) return help(RESOURCE_LIST_HELP);
      if (c.positionals.length > 0) extraPositional(u, c.positionals);
      return { action: "run", run: (v) => cmdResourceList(!!v.json), values: { json: !!c.flags.get("--json")?.length } };
    }
    case "add": {
      const u = usageBlock(RESOURCE_ADD_HELP);
      const c = collect(rest, u, P_RESOURCE_ADD, [
        { name: "--domain", takesValue: true },
        { name: "--type", takesValue: true },
        { name: "--path", takesValue: true },
        { name: "--url", takesValue: true },
        { name: "--tag", takesValue: true },
        { name: "--notes", takesValue: true },
      ]);
      if (c.help) return help(RESOURCE_ADD_HELP);
      const domainV = lastVal(c.flags, "--domain");
      // missing required, in argparse order: positional id, then option --domain
      const missing: string[] = [];
      if (c.positionals.length === 0) missing.push("id");
      if (!domainV) missing.push("--domain");
      if (missing.length) err(u, P_RESOURCE_ADD, `the following arguments are required: ${missing.join(", ")}`);
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));

      const pathV = lastVal(c.flags, "--path");
      const urlV = lastVal(c.flags, "--url");
      if (pathV !== undefined && urlV !== undefined) {
        // argparse reports the mutually-exclusive offender as the one seen later in argv
        const pathIdx = rest.findIndex((t) => t === "--path" || t === "--path=");
        const urlIdx = rest.findIndex((t) => t === "--url" || t === "--url=");
        if (urlIdx > pathIdx) {
          err(u, P_RESOURCE_ADD, "argument --url: not allowed with argument --path");
        } else {
          err(u, P_RESOURCE_ADD, "argument --path: not allowed with argument --url");
        }
      }
      if (pathV === undefined && urlV === undefined) {
        err(u, P_RESOURCE_ADD, "one of the arguments --path --url is required");
      }
      return {
        action: "run",
        run: (v) =>
          cmdResourceAdd(
            v.id as string,
            v.domain as string,
            v.type as string | undefined,
            v.path as string | undefined,
            v.url as string | undefined,
            v.tags as string[] | undefined,
            v.notes as string | undefined,
          ),
        values: {
          id: c.positionals[0],
          domain: domainV,
          type: lastVal(c.flags, "--type"),
          path: pathV,
          url: urlV,
          tags: c.flags.get("--tag") as string[] | undefined,
          notes: lastVal(c.flags, "--notes"),
        },
      };
    }
    case "remove": {
      const u = usageBlock(RESOURCE_REMOVE_HELP);
      const c = collect(rest, u, P_RESOURCE_REMOVE, []);
      if (c.help) return help(RESOURCE_REMOVE_HELP);
      if (c.positionals.length === 0) err(u, P_RESOURCE_REMOVE, "the following arguments are required: id");
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return { action: "run", run: (v) => cmdResourceRemove(v.id as string), values: { id: c.positionals[0] } };
    }
  }
  throw new Error("unreachable");
}

function parseFilehub(argv: string[]): Invocation {
  const usage = usageBlock(FILEHUB_HELP);
  if (argv.length === 0) err(usage, P_FILEHUB, "the following arguments are required: filehub_command");
  if (isHelpFlag(argv[0])) return help(FILEHUB_HELP);
  const sub = argv[0];
  if (!FILEHUB_CHOICES.includes(sub)) {
    err(usage, P_FILEHUB, `argument filehub_command: invalid choice: '${sub}' (choose from '${FILEHUB_CHOICES.join("', '")}')`);
  }
  const rest = argv.slice(1);
  const u = usageBlock(FILEHUB_INIT_HELP);
  const c = collect(rest, u, P_FILEHUB_INIT, [
    { name: "--register", takesValue: false },
    { name: "--domain", takesValue: true },
  ]);
  if (c.help) return help(FILEHUB_INIT_HELP);
  if (c.positionals.length === 0) err(u, P_FILEHUB_INIT, "the following arguments are required: root");
  if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
  return {
    action: "run",
    run: (v) => cmdFilehubInit(v.root as string, !!v.register, v.domain as string | undefined),
    values: {
      root: c.positionals[0],
      register: !!c.flags.get("--register")?.length,
      domain: lastVal(c.flags, "--domain"),
    },
  };
}

function parseInbox(argv: string[]): Invocation {
  const usage = usageBlock(INBOX_HELP);
  if (argv.length === 0) err(usage, P_INBOX, "the following arguments are required: inbox_command");
  if (isHelpFlag(argv[0])) return help(INBOX_HELP);
  const sub = argv[0];
  if (!INBOX_CHOICES.includes(sub)) {
    err(usage, P_INBOX, `argument inbox_command: invalid choice: '${sub}' (choose from '${INBOX_CHOICES.join("', '")}')`);
  }
  const rest = argv.slice(1);
  const u = usageBlock(INBOX_STATUS_HELP);
  const c = collect(rest, u, P_INBOX_STATUS, [{ name: "--json", takesValue: false }]);
  if (c.help) return help(INBOX_STATUS_HELP);
  if (c.positionals.length > 0) extraPositional(u, c.positionals);
  return { action: "run", run: (v) => cmdInboxStatus(!!v.json), values: { json: !!c.flags.get("--json")?.length } };
}

function parseCron(argv: string[]): Invocation {
  const usage = usageBlock(CRON_HELP);
  if (argv.length === 0) err(usage, P_CRON, "the following arguments are required: cron_command");
  if (isHelpFlag(argv[0])) return help(CRON_HELP);
  const sub = argv[0];
  if (!CRON_CHOICES.includes(sub)) {
    err(usage, P_CRON, `argument cron_command: invalid choice: '${sub}' (choose from '${CRON_CHOICES.join("', '")}')`);
  }
  const rest = argv.slice(1);
  switch (sub) {
    case "add": {
      const u = usageBlock(CRON_ADD_HELP);
      const c = collect(rest, u, P_CRON_ADD, [
        { name: "--schedule", takesValue: true },
        { name: "--harness", takesValue: true },
        { name: "--prompt", takesValue: true },
        { name: "--disabled", takesValue: false },
      ]);
      if (c.help) return help(CRON_ADD_HELP);
      const missing: string[] = [];
      if (c.positionals.length === 0) missing.push("id");
      if (!lastVal(c.flags, "--schedule")) missing.push("--schedule");
      if (!lastVal(c.flags, "--harness")) missing.push("--harness");
      if (!lastVal(c.flags, "--prompt")) missing.push("--prompt");
      if (missing.length) err(u, P_CRON_ADD, `the following arguments are required: ${missing.join(", ")}`);
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return {
        action: "run",
        run: (v) => cmdCronAdd(v.id as string, v.schedule as string, v.harness as string, v.prompt as string, !!v.disabled),
        values: {
          id: c.positionals[0],
          schedule: lastVal(c.flags, "--schedule"),
          harness: lastVal(c.flags, "--harness"),
          prompt: lastVal(c.flags, "--prompt"),
          disabled: !!c.flags.get("--disabled")?.length,
        },
      };
    }
    case "list": {
      const u = usageBlock(CRON_LIST_HELP);
      const c = collect(rest, u, P_CRON_LIST, [{ name: "--json", takesValue: false }]);
      if (c.help) return help(CRON_LIST_HELP);
      if (c.positionals.length > 0) extraPositional(u, c.positionals);
      return { action: "run", run: (v) => cmdCronList(!!v.json), values: { json: !!c.flags.get("--json")?.length } };
    }
    case "remove": {
      const u = usageBlock(CRON_REMOVE_HELP);
      const c = collect(rest, u, P_CRON_REMOVE, []);
      if (c.help) return help(CRON_REMOVE_HELP);
      if (c.positionals.length === 0) err(u, P_CRON_REMOVE, "the following arguments are required: id");
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return { action: "run", run: (v) => cmdCronRemove(v.id as string), values: { id: c.positionals[0] } };
    }
    case "install": {
      const u = usageBlock(CRON_INSTALL_HELP);
      const c = collect(rest, u, P_CRON_INSTALL, []);
      if (c.help) return help(CRON_INSTALL_HELP);
      if (c.positionals.length > 0) extraPositional(u, c.positionals);
      return { action: "run", run: () => cmdCronInstall(), values: {} };
    }
    case "uninstall": {
      const u = usageBlock(CRON_UNINSTALL_HELP);
      const c = collect(rest, u, P_CRON_UNINSTALL, []);
      if (c.help) return help(CRON_UNINSTALL_HELP);
      if (c.positionals.length > 0) extraPositional(u, c.positionals);
      return { action: "run", run: () => cmdCronUninstall(), values: {} };
    }
    case "run": {
      const u = usageBlock(CRON_RUN_HELP);
      const c = collect(rest, u, P_CRON_RUN, [
        { name: "--dry-run", takesValue: false },
        { name: "--timeout", takesValue: true },
        { name: "--dir", takesValue: true },
      ]);
      if (c.help) return help(CRON_RUN_HELP);
      if (c.positionals.length === 0) err(u, P_CRON_RUN, "the following arguments are required: id");
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      const timeout = Number(lastVal(c.flags, "--timeout") ?? "1800");
      if (!Number.isFinite(timeout) || timeout <= 0) err(u, P_CRON_RUN, "argument --timeout: invalid number");
      return { action: "run", run: (v) => cmdCronRun(v.id as string, !!v.dryRun, timeout, v.dir as string | undefined), values: { id: c.positionals[0], dryRun: !!c.flags.get("--dry-run")?.length, dir: lastVal(c.flags, "--dir") } };
    }
    case "status": {
      const u = usageBlock(CRON_STATUS_HELP);
      const c = collect(rest, u, P_CRON_STATUS, []);
      if (c.help) return help(CRON_STATUS_HELP);
      if (c.positionals.length > 1) extraPositional(u, c.positionals.slice(1));
      return { action: "run", run: (v) => cmdCronStatus(v.id as string | undefined), values: { id: c.positionals[0] } };
    }
  }
  throw new Error("unreachable");
}
