// cli/commands/resource.ts — `jspace resource` command family.
import type { CommandSpec } from "../../application/commands/command.ts";
import { resourceAdd, resourceList, resourceRemove } from "../../application/registry/resource.ts";
import { b, s } from "./helpers.ts";

const resourceListSpec: CommandSpec = {
  name: "list",
  summary: "list resources",
  features: { json: true, dir: true },
  handler: (ctx, args) => resourceList(ctx.root, b(args.json)),
};

const resourceAddSpec: CommandSpec = {
  name: "add",
  summary: "add a resource",
  positionals: [{ name: "id", required: true, help: "resource id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
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
  handler: (ctx, args) =>
    resourceAdd(
      ctx.root,
      s(args.id),
      s(args.domain),
      args.type === undefined ? undefined : s(args.type),
      args.path === undefined ? undefined : s(args.path),
      args.url === undefined ? undefined : s(args.url),
      args.tags as string[] | undefined,
      args.notes === undefined ? undefined : s(args.notes),
      b(args.dryRun),
    ),
};

const resourceRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a resource",
  positionals: [{ name: "id", required: true, help: "resource id" }],
  features: { dir: true, dryRun: true },
  handler: (ctx, args) => resourceRemove(ctx.root, s(args.id), b(args.dryRun)),
};

export const resourceSpec: CommandSpec = {
  name: "resource",
  summary: "manage workbench resources",
  commandArgName: "resource_command",
  children: [resourceListSpec, resourceAddSpec, resourceRemoveSpec],
};
