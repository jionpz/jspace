// cli/commands/project.ts — `jspace project` / `filehub` / `inbox` command
// families (registry-adjacent asset-layer commands, small enough to share one file).
import type { CommandSpec } from "../../application/commands/command.ts";
import { filehubInit, filehubUpgrade } from "../../application/registry/filehub.ts";
import { filehubRefresh } from "../../application/filehub/refresh.ts";
import { inboxBlock, inboxRetry, inboxStatus } from "../../application/registry/inbox.ts";
import { readJournals } from "../../application/ingest/journal.ts";
import { projectAdd, projectList, projectListStatus, projectSetStatus } from "../../application/registry/project.ts";
import { expandTilde, filehubReadme, devRoot } from "../embed.ts";
import { resolvePath } from "../paths.ts";
import { b, s } from "./helpers.ts";
import { realGbrain } from "../../adapters/gbrain/gbrain.ts";
import { PROJECT_COLLECT_TIMEOUT_MS } from "../../application/context/project-states.ts";
import { filehubCheckSpec } from "./filehub.ts";

const projectListSpec: CommandSpec = {
  name: "list",
  summary: "list projects (--status: overview from gbrain state cards + hub)",
  features: { json: true, dir: true },
  options: [
    {
      name: "--status",
      takesValue: false,
      help: "overview: gbrain project/*/state cards (三段摘要 + 相关项目) + hub-registered projects without a card",
    },
  ],
  handler: async (ctx, args) => {
    if (b(args.status)) {
      // gbrain-backed overview with the short per-call timeout (same budget as
      // the injection leg — a stalled gbrain degrades to the hub-only list).
      return projectListStatus(ctx.root, b(args.json), realGbrain(undefined, PROJECT_COLLECT_TIMEOUT_MS));
    }
    return projectList(ctx.root, b(args.json));
  },
};

const projectAddSpec: CommandSpec = {
  name: "add",
  summary: "add a project (register an owning id for ingest --project)",
  positionals: [{ name: "id", required: true, help: "project id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--domain", takesValue: true, help: "owning domain id (default: files)" },
    { name: "--asset-rel-path", dest: "assetRelPath", takesValue: true, help: "asset root rel path under filehub (default: projects/<id>)" },
  ],
  handler: (ctx, args) =>
    projectAdd(
      ctx.root,
      s(args.id),
      args.domain === undefined ? undefined : s(args.domain),
      args.assetRelPath === undefined ? undefined : s(args.assetRelPath),
      b(args.dryRun),
    ),
};

const projectSetStatusSpec: CommandSpec = {
  name: "set-status",
  summary: "close or reopen a project in place (asset paths and pages stay valid)",
  features: { json: true, dir: true, dryRun: true },
  positionals: [{ name: "id", required: true, help: "project id" }],
  options: [
    {
      name: "--status",
      takesValue: true,
      required: true,
      metavar: "STATUS",
      help: "active or archived",
    },
  ],
  handler: (ctx, args) =>
    projectSetStatus(ctx.root, s(args.id), s(args.status), b(args.dryRun), b(args.json)),
};

export const projectSpec: CommandSpec = {
  name: "project",
  summary: "manage workbench projects",
  commandArgName: "project_command",
  children: [projectListSpec, projectAddSpec, projectSetStatusSpec],
};

const filehubInitSpec: CommandSpec = {
  name: "init",
  summary: "create a file management center skeleton (asset layer)",
  positionals: [{ name: "root", required: true, help: "filehub root directory (absolute or relative path)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--register", takesValue: false, help: "also register the filehub in the current workbench (.jspace/hub.json) as type=filehub" },
    { name: "--domain", takesValue: true, help: "owning domain id (default: files; created if missing)" },
  ],
  handler: (ctx, args) =>
    filehubInit(s(args.root), b(args.register), args.domain === undefined ? undefined : s(args.domain), {
      resolvePath,
      expandTilde,
      filehubReadme,
      devRoot,
      wbRoot: ctx.root,
    }, b(args.dryRun)),
};

const filehubUpgradeSpec: CommandSpec = {
  name: "upgrade",
  summary: "upgrade the README contract block (never moves assets)",
  description:
    "Explicit, non-destructive contract upgrade: replaces/inserts ONLY the " +
    "JSPACE:FILEHUB managed block in the filehub README. Assets, index.md and " +
    "gbrain pointers are untouched.",
  positionals: [
    { name: "path", help: "filehub root (default: the registered filehub primary path)" },
  ],
  features: { dir: true, dryRun: true },
  handler: (ctx, args) =>
    filehubUpgrade(args.path === undefined ? undefined : s(args.path), {
      resolvePath,
      expandTilde,
      filehubReadme,
      wbRoot: ctx.root,
    }, b(args.dryRun)),
};

const filehubRefreshSpec: CommandSpec = {
  name: "refresh",
  summary: "rebuild the derived navigation blocks (registry view only)",
  description:
    "Recomputes the managed navigation blocks in the filehub README and " +
    "projects/README.md from hub.json and owner entries. Never touches assets, " +
    "index tables, hub.json or gbrain; text outside each managed block is kept.",
  features: { dir: true, dryRun: true, json: true },
  handler: (ctx, args) => filehubRefresh({ wbRoot: ctx.root }, b(args.dryRun), b(args.json)),
};

export const filehubSpec: CommandSpec = {
  name: "filehub",
  summary: "manage the file management center (asset layer)",
  commandArgName: "filehub_command",
  children: [filehubInitSpec, filehubUpgradeSpec, filehubCheckSpec, filehubRefreshSpec],
};

const inboxStatusSpec: CommandSpec = {
  name: "status",
  summary: "list inbox files with blocker freshness and retained-source status (read-only)",
  features: { json: true, dir: true },
  handler: (ctx, args) => inboxStatus(ctx.root, b(args.json), readJournals(ctx.root).records),
};

const inboxBlockSpec: CommandSpec = {
  name: "block",
  summary: "record why an inbox entry cannot be decided (no ingest or file write)",
  positionals: [{ name: "entry", required: true, help: "exact top-level inbox entry name" }],
  features: { dir: true, dryRun: true, json: true },
  options: [
    {
      name: "--reason",
      takesValue: true,
      required: true,
      metavar: "CODE",
      help: "owner_ambiguous or source_unverified",
    },
    {
      name: "--missing",
      takesValue: true,
      required: true,
      help: "short description of the evidence gap",
    },
    {
      name: "--candidates",
      takesValue: true,
      help: "comma-separated project:<id>/area:<id> candidates (owner_ambiguous only)",
    },
  ],
  handler: (ctx, args) =>
    inboxBlock(
      ctx.root,
      s(args.entry),
      s(args.reason),
      s(args.missing),
      args.candidates === undefined
        ? undefined
        : s(args.candidates)
            .split(",")
            .map((candidate) => candidate.trim())
            .filter((candidate) => candidate.length > 0),
      b(args.dryRun),
      b(args.json),
      readJournals(ctx.root).records,
    ),
};

const inboxRetrySpec: CommandSpec = {
  name: "retry",
  summary: "clear one cached blocker decision so the next pass decides again",
  positionals: [{ name: "entry", required: true, help: "exact top-level inbox entry name" }],
  features: { dir: true, dryRun: true, json: true },
  handler: (ctx, args) =>
    inboxRetry(ctx.root, s(args.entry), b(args.dryRun), b(args.json), readJournals(ctx.root).records),
};

export const inboxSpec: CommandSpec = {
  name: "inbox",
  summary: "inspect and annotate files waiting in the inbox",
  commandArgName: "inbox_command",
  children: [inboxStatusSpec, inboxBlockSpec, inboxRetrySpec],
};
