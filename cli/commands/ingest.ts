// cli/commands/ingest.ts — `jspace ingest` command family.
import type { CommandSpec } from "../../application/commands/command.ts";
import {
  ingestAdvance,
  ingestBegin,
  ingestFail,
  ingestList,
  ingestRollback,
  ingestStatus,
} from "../../application/ingest/use-cases.ts";
import type { IngestStep } from "../../core/contracts/ingest.ts";
import { b, s } from "./helpers.ts";

const ingestBeginSpec: CommandSpec = {
  name: "begin",
  summary: "stage a file into the filehub and start an ingest journal",
  features: { dir: true },
  positionals: [{ name: "file", required: true, help: "inbox file to ingest" }],
  options: [
    { name: "--target", takesValue: true, required: true, metavar: "PATH", help: "staged target path (absolute or filehub-relative)" },
    { name: "--slug", takesValue: true, required: true, metavar: "SLUG", help: "gbrain slug assets/<project>/<semantic>" },
    { name: "--project", takesValue: true, required: true, metavar: "ID", help: "project id or name (registered id preferred)" },
    { name: "--index", takesValue: true, metavar: "LINE", help: "planned project index.md line" },
  ],
  handler: (ctx, args) =>
    ingestBegin(ctx.root, {
      file: s(args.file),
      target: s(args.target),
      slug: s(args.slug),
      project: s(args.project),
      indexLine: args.index === undefined ? undefined : s(args.index),
    }),
};

const ingestAdvanceSpec: CommandSpec = {
  name: "advance",
  summary: "mark the next mechanical step done (gbrain/index/committed)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  options: [
    { name: "--gbrain", takesValue: false, help: "gbrain page written" },
    { name: "--index", takesValue: false, help: "project index updated" },
    { name: "--complete", takesValue: false, help: "remove source + mark committed (idempotent cleanup recovery)" },
  ],
  groups: [
    { id: "step", members: ["--gbrain", "--index", "--complete"], required: true, message: "one of --gbrain --index --complete is required" },
  ],
  handler: (ctx, args) => {
    const step: IngestStep = b(args.complete) ? "committed" : b(args.index) ? "index" : "gbrain";
    return ingestAdvance(ctx.root, s(args.id), step);
  },
};

const ingestFailSpec: CommandSpec = {
  name: "fail",
  summary: "mark an ingest failed with compensation for the failing step",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  options: [{ name: "--reason", takesValue: true, required: true, metavar: "TEXT", help: "failure reason" }],
  handler: (ctx, args) => ingestFail(ctx.root, s(args.id), s(args.reason)),
};

const ingestRollbackSpec: CommandSpec = {
  name: "rollback",
  summary: "abandon a staged ingest (source stays in inbox)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  handler: (ctx, args) => ingestRollback(ctx.root, s(args.id)),
};

const ingestStatusSpec: CommandSpec = {
  name: "status",
  summary: "show one ingest journal",
  features: { dir: true, json: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  handler: (ctx, args) => ingestStatus(ctx.root, s(args.id), b(args.json)),
};

const ingestListSpec: CommandSpec = {
  name: "list",
  summary: "list ingest journals",
  features: { dir: true, json: true },
  handler: (ctx, args) => ingestList(ctx.root, b(args.json)),
};

export const ingestSpec: CommandSpec = {
  name: "ingest",
  summary: "file-hub ingest journal (stage/advance/commit with compensation)",
  commandArgName: "ingest_command",
  children: [ingestBeginSpec, ingestAdvanceSpec, ingestFailSpec, ingestRollbackSpec, ingestStatusSpec, ingestListSpec],
};
