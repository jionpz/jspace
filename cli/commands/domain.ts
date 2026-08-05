// cli/commands/domain.ts — `jspace domain` command family.
import type { CommandSpec } from "../../application/commands/command.ts";
import { domainAdd, domainList, domainRemove } from "../../application/registry/domain.ts";
import { b, s } from "./helpers.ts";

const domainListSpec: CommandSpec = {
  name: "list",
  summary: "list domains",
  features: { json: true, dir: true },
  handler: (ctx, args) => domainList(ctx.root, b(args.json)),
};

const domainAddSpec: CommandSpec = {
  name: "add",
  summary: "add a domain",
  positionals: [{ name: "id", required: true, help: "domain id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--path", takesValue: true, help: "relative path inside the workbench (default: workspace/<id>)" },
    { name: "--tag", takesValue: true, repeatable: true, help: "domain tag (repeatable)" },
    { name: "--purpose", takesValue: true, help: "domain purpose" },
  ],
  handler: (ctx, args) =>
    domainAdd(
      ctx.root,
      s(args.id),
      args.path === undefined ? undefined : s(args.path),
      args.tags as string[] | undefined,
      args.purpose === undefined ? undefined : s(args.purpose),
      b(args.dryRun),
    ),
};

const domainRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a domain",
  positionals: [{ name: "id", required: true, help: "domain id" }],
  features: { dir: true, dryRun: true },
  options: [{ name: "--purge", takesValue: false, help: "also delete the domain directory" }],
  handler: (ctx, args) => domainRemove(ctx.root, s(args.id), b(args.purge), b(args.dryRun)),
};

export const domainSpec: CommandSpec = {
  name: "domain",
  summary: "manage workbench domains",
  commandArgName: "domain_command",
  children: [domainListSpec, domainAddSpec, domainRemoveSpec],
};
