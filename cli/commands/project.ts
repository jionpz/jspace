// cli/commands/project.ts — `jspace project` / `filehub` / `inbox` command
// families (registry-adjacent asset-layer commands, small enough to share one file).
import type { CommandSpec } from "../../application/commands/command.ts";
import { filehubInit } from "../../application/registry/filehub.ts";
import { inboxStatus } from "../../application/registry/inbox.ts";
import { projectAdd, projectList } from "../../application/registry/project.ts";
import { expandTilde, filehubReadme, devRoot } from "../embed.ts";
import { resolvePath } from "../paths.ts";
import { b, s } from "./helpers.ts";

const projectListSpec: CommandSpec = {
  name: "list",
  summary: "list projects",
  features: { json: true, dir: true },
  handler: (ctx, args) => projectList(ctx.root, b(args.json)),
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

export const projectSpec: CommandSpec = {
  name: "project",
  summary: "manage workbench projects",
  commandArgName: "project_command",
  children: [projectListSpec, projectAddSpec],
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

export const filehubSpec: CommandSpec = {
  name: "filehub",
  summary: "manage the file management center (asset layer)",
  commandArgName: "filehub_command",
  children: [filehubInitSpec],
};

const inboxStatusSpec: CommandSpec = {
  name: "status",
  summary: "list files waiting in the inbox (read-only)",
  features: { json: true, dir: true },
  handler: (ctx, args) => inboxStatus(ctx.root, b(args.json)),
};

export const inboxSpec: CommandSpec = {
  name: "inbox",
  summary: "inspect files waiting in the inbox",
  commandArgName: "inbox_command",
  children: [inboxStatusSpec],
};
