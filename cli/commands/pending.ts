// cli/commands/pending.ts — `jspace pending` command family.
import type { CommandSpec } from "../../application/commands/command.ts";
import { pendingAck, pendingApply, pendingList, pendingStage } from "../../application/pending/use-cases.ts";
import { b, quiet, s } from "./helpers.ts";

const pendingStageSpec: CommandSpec = {
  name: "stage",
  summary: "stage a deferred gbrain write (lock conflict) as a typed envelope",
  features: { dir: true },
  positionals: [{ name: "slug", required: true, help: "target gbrain slug" }],
  options: [
    { name: "--content", takesValue: true, required: true, metavar: "FILE", help: "file containing the full page markdown" },
    { name: "--producer", takesValue: true, metavar: "NAME", help: "producer (default: asset-ingest)" },
  ],
  handler: (ctx, args) => pendingStage(ctx.root, s(args.slug), s(args.content), s(args.producer) || "asset-ingest"),
};

const pendingListSpec: CommandSpec = {
  name: "list",
  summary: "list pending envelopes",
  features: { dir: true, json: true },
  handler: (ctx, args) => pendingList(ctx.root, b(args.json)),
};

const pendingApplySpec: CommandSpec = {
  name: "apply",
  summary: "apply staged envelopes (dedupe -> put; retry -> terminal-failed)",
  features: { dir: true },
  positionals: [{ name: "id", help: "specific envelope id (default: all staged)" }],
  options: [{ name: "--quiet", takesValue: false, help: "suppress stdout (keep exit code; for harness hooks)" }],
  handler: (ctx, args) => {
    const result = pendingApply(ctx.root, args.id === undefined ? undefined : s(args.id));
    return b(args.quiet) ? quiet(result) : result;
  },
};

const pendingAckSpec: CommandSpec = {
  name: "ack",
  summary: "acknowledge a terminal-failed envelope (evidence retained, stops alerting)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "envelope id" }],
  handler: (ctx, args) => pendingAck(ctx.root, s(args.id)),
};

export const pendingSpec: CommandSpec = {
  name: "pending",
  summary: "staged gbrain writes (stage/apply/ack)",
  commandArgName: "pending_command",
  children: [pendingStageSpec, pendingListSpec, pendingApplySpec, pendingAckSpec],
};
