// cli/commands/registry.ts — top-level CommandSpec tree.
//
// Single source for the whole command surface. The engine derives help,
// choices, argument validation and dispatch from these specs; handlers are
// still delegated to the legacy cmd* implementations during the migration
// (Child B M2). Use-case migration (application/) replaces the delegates later;
// cron use cases land in Child C.
import type { CommandSpec } from "../../application/commands/command.ts";
import { cmdInit } from "../init.ts";
import {
  cmdDoctor,
  cmdDomainAdd,
  cmdDomainList,
  cmdDomainRemove,
  cmdFilehubInit,
  cmdInboxStatus,
  cmdResourceAdd,
  cmdResourceList,
  cmdResourceRemove,
} from "../cmds.ts";
import {
  cmdCronAdd,
  cmdCronFailures,
  cmdCronInstall,
  cmdCronList,
  cmdCronRemove,
  cmdCronRun,
  cmdCronStatus,
  cmdCronUninstall,
} from "../cron.ts";
import { cmdUpdate } from "../update.ts";

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const b = (v: unknown): boolean => v === true;

const initSpec: CommandSpec = {
  name: "init",
  summary: "initialize a new JSpace workbench in a target directory",
  positionals: [{ name: "target", help: "target directory (default: current directory)" }],
  options: [{ name: "--force", takesValue: false, help: "allow initialization into a non-empty directory" }],
  handler: (_ctx, args) => {
    cmdInit(args.target === undefined ? undefined : s(args.target), b(args.force));
    return { lines: [] };
  },
};

const doctorSpec: CommandSpec = {
  name: "doctor",
  summary: "validate an existing JSpace workbench registry",
  features: { dir: true },
  handler: (_ctx, args) => {
    cmdDoctor(s(args.dir) || ".");
    return { lines: [] };
  },
};

const domainListSpec: CommandSpec = {
  name: "list",
  summary: "list domains",
  features: { json: true },
  handler: (_ctx, args) => {
    cmdDomainList(b(args.json));
    return { lines: [] };
  },
};

const domainAddSpec: CommandSpec = {
  name: "add",
  summary: "add a domain",
  positionals: [{ name: "id", required: true, help: "domain id (lowercase letters, digits, and hyphens)" }],
  options: [
    { name: "--path", takesValue: true, help: "relative path inside the workbench (default: workspace/<id>)" },
    { name: "--tag", takesValue: true, repeatable: true, help: "domain tag (repeatable)" },
    { name: "--purpose", takesValue: true, help: "domain purpose" },
  ],
  handler: (_ctx, args) => {
    cmdDomainAdd(s(args.id), args.path === undefined ? undefined : s(args.path), (args.tags as string[] | undefined), args.purpose === undefined ? undefined : s(args.purpose));
    return { lines: [] };
  },
};

const domainRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a domain",
  positionals: [{ name: "id", required: true, help: "domain id" }],
  options: [{ name: "--purge", takesValue: false, help: "also delete the domain directory" }],
  handler: (_ctx, args) => {
    cmdDomainRemove(s(args.id), b(args.purge));
    return { lines: [] };
  },
};

const domainSpec: CommandSpec = {
  name: "domain",
  summary: "manage workbench domains",
  commandArgName: "domain_command",
  children: [domainListSpec, domainAddSpec, domainRemoveSpec],
};

const resourceListSpec: CommandSpec = {
  name: "list",
  summary: "list resources",
  features: { json: true },
  handler: (_ctx, args) => {
    cmdResourceList(b(args.json));
    return { lines: [] };
  },
};

const resourceAddSpec: CommandSpec = {
  name: "add",
  summary: "add a resource",
  positionals: [{ name: "id", required: true, help: "resource id (lowercase letters, digits, and hyphens)" }],
  options: [
    { name: "--domain", takesValue: true, required: true, help: "owning domain id" },
    { name: "--type", takesValue: true, help: "resource type (default: project)" },
    { name: "--path", takesValue: true, group: "ep", help: "absolute path entrypoint" },
    { name: "--url", takesValue: true, group: "ep", help: "url entrypoint" },
    { name: "--tag", takesValue: true, repeatable: true, help: "resource tag (repeatable)" },
    { name: "--notes", takesValue: true, help: "resource notes" },
  ],
  groups: [
    {
      id: "ep",
      members: ["--path", "--url"],
      required: true,
      message: "one of the arguments --path --url is required",
    },
  ],
  handler: (_ctx, args) => {
    cmdResourceAdd(
      s(args.id),
      s(args.domain),
      args.type === undefined ? undefined : s(args.type),
      args.path === undefined ? undefined : s(args.path),
      args.url === undefined ? undefined : s(args.url),
      args.tags as string[] | undefined,
      args.notes === undefined ? undefined : s(args.notes),
    );
    return { lines: [] };
  },
};

const resourceRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a resource",
  positionals: [{ name: "id", required: true, help: "resource id" }],
  handler: (_ctx, args) => {
    cmdResourceRemove(s(args.id));
    return { lines: [] };
  },
};

const resourceSpec: CommandSpec = {
  name: "resource",
  summary: "manage workbench resources",
  commandArgName: "resource_command",
  children: [resourceListSpec, resourceAddSpec, resourceRemoveSpec],
};

const filehubInitSpec: CommandSpec = {
  name: "init",
  summary: "create a file management center skeleton (asset layer)",
  positionals: [{ name: "root", required: true, help: "filehub root directory (absolute or relative path)" }],
  options: [
    { name: "--register", takesValue: false, help: "also register the filehub in the current workbench (.jspace/hub.json) as type=filehub" },
    { name: "--domain", takesValue: true, help: "owning domain id (default: files; created if missing)" },
  ],
  handler: (_ctx, args) => {
    cmdFilehubInit(s(args.root), b(args.register), args.domain === undefined ? undefined : s(args.domain));
    return { lines: [] };
  },
};

const filehubSpec: CommandSpec = {
  name: "filehub",
  summary: "manage the file management center (asset layer)",
  commandArgName: "filehub_command",
  children: [filehubInitSpec],
};

const inboxStatusSpec: CommandSpec = {
  name: "status",
  summary: "list files waiting in the inbox (read-only)",
  features: { json: true },
  handler: (_ctx, args) => {
    cmdInboxStatus(b(args.json));
    return { lines: [] };
  },
};

const inboxSpec: CommandSpec = {
  name: "inbox",
  summary: "inspect files waiting in the inbox",
  commandArgName: "inbox_command",
  children: [inboxStatusSpec],
};

const cronAddSpec: CommandSpec = {
  name: "add",
  summary: "add a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id (lowercase letters, digits, and hyphens)" }],
  options: [
    { name: "--schedule", takesValue: true, required: true, help: 'restricted 5-field cron expression (e.g. "0 21 * * *"; single values or *; no lists/ranges/steps)' },
    { name: "--harness", takesValue: true, required: true, help: "harness to run: claude | codex | pi" },
    { name: "--prompt", takesValue: true, required: true, help: "instruction for the headless harness" },
    { name: "--disabled", takesValue: false, help: "add the cron disabled" },
  ],
  handler: (_ctx, args) => {
    cmdCronAdd(s(args.id), s(args.schedule), s(args.harness), s(args.prompt), b(args.disabled));
    return { lines: [] };
  },
};

const cronListSpec: CommandSpec = {
  name: "list",
  summary: "list cron definitions",
  features: { json: true },
  handler: (_ctx, args) => {
    cmdCronList(b(args.json));
    return { lines: [] };
  },
};

const cronRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  handler: (_ctx, args) => {
    cmdCronRemove(s(args.id));
    return { lines: [] };
  },
};

const cronInstallSpec: CommandSpec = {
  name: "install",
  summary: "install enabled crons into macOS launchd",
  handler: () => {
    cmdCronInstall();
    return { lines: [] };
  },
};

const cronUninstallSpec: CommandSpec = {
  name: "uninstall",
  summary: "remove installed launchd agents",
  handler: () => {
    cmdCronUninstall();
    return { lines: [] };
  },
};

const cronRunSpec: CommandSpec = {
  name: "run",
  summary: "run a cron headlessly now",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  options: [
    { name: "--dry-run", takesValue: false, help: "print the command that would run, without executing" },
    {
      name: "--timeout",
      takesValue: true,
      metavar: "SECONDS",
      validate: (v) => (Number(v) > 0 ? null : "argument --timeout: invalid number"),
      help: "per-run timeout (default: 1800)",
    },
    { name: "--dir", takesValue: true, metavar: "DIR", help: "workbench root (default: current directory; schedulers pass this explicitly)" },
  ],
  handler: async (_ctx, args) => {
    await cmdCronRun(s(args.id), b(args.dryRun), Number(s(args.timeout) || "1800"), args.dir === undefined ? undefined : s(args.dir));
    return { lines: [] };
  },
};

const cronStatusSpec: CommandSpec = {
  name: "status",
  summary: "show last run result",
  positionals: [{ name: "id", help: "cron id (default: all)" }],
  handler: (_ctx, args) => {
    cmdCronStatus(args.id === undefined ? undefined : s(args.id));
    return { lines: [] };
  },
};

const cronFailuresSpec: CommandSpec = {
  name: "failures",
  aliases: ["check"],
  summary: "show recent failures + pending staged writes (alias: check)",
  description:
    "One-place session-start surface: recent failures + pending staged gbrain writes (APPLY.md) + per-cron status. Exit 1 when anything needs attention.",
  features: { json: true },
  handler: (_ctx, args) => {
    cmdCronFailures(b(args.json));
    return { lines: [] };
  },
};

const cronSpec: CommandSpec = {
  name: "cron",
  summary: "manage scheduled tasks (declarative + launchd)",
  commandArgName: "cron_command",
  children: [
    cronAddSpec,
    cronListSpec,
    cronRemoveSpec,
    cronInstallSpec,
    cronUninstallSpec,
    cronRunSpec,
    cronStatusSpec,
    cronFailuresSpec,
  ],
};

const updateSpec: CommandSpec = {
  name: "update",
  summary: "self-update the jspace CLI from GitHub Releases",
  description:
    "Self-update the jspace CLI from GitHub Releases (explicit command only; no background checks). Downloads the matching platform binary, verifies its SHA-256 against the release checksums, and replaces the current binary.",
  options: [
    { name: "--check", takesValue: false, help: "report current vs latest, do not update" },
    { name: "--version", takesValue: true, metavar: "VERSION", help: "install a specific version (e.g. v1.0.1; rollback) (env: JSPACE_VERSION) (env: JSPACE_BASE_URL overrides the download base)" },
  ],
  handler: async (_ctx, args) => {
    await cmdUpdate(b(args.check), args.version === undefined ? undefined : s(args.version));
    return { lines: [] };
  },
};

export const COMMANDS: CommandSpec[] = [
  initSpec,
  doctorSpec,
  domainSpec,
  resourceSpec,
  filehubSpec,
  inboxSpec,
  cronSpec,
  updateSpec,
];
