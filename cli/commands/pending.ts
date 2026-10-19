// cli/commands/pending.ts — `jspace pending` command family.
import type { CommandSpec } from "../../application/commands/command.ts";
import { pendingAck, pendingApply, pendingList, pendingStage } from "../../application/pending/use-cases.ts";
import type { GbrainContentOrigin } from "../../core/contracts/gbrain.ts";
import type { PendingIntent } from "../../core/contracts/pending.ts";
import { CliError } from "../../core/shared/errors.ts";
import { b, optS, quiet, s } from "./helpers.ts";

const pendingStageSpec: CommandSpec = {
  name: "stage",
  summary: "stage a deferred gbrain write (lock conflict / response loss) as a typed envelope",
  features: { dir: true },
  positionals: [{ name: "slug", required: true, help: "target gbrain slug" }],
  options: [
    { name: "--content", takesValue: true, required: true, metavar: "FILE", help: "file containing the full page markdown" },
    { name: "--producer", takesValue: true, metavar: "NAME", help: "producer (default: asset-ingest)" },
    {
      name: "--intent",
      takesValue: true,
      required: true,
      metavar: "create|replace",
      help: "create fails if the target exists; replace requires --expected-revision",
      validate: (v) => (v === "create" || v === "replace" ? null : "--intent must be create or replace"),
    },
    {
      name: "--origin",
      takesValue: true,
      required: true,
      metavar: "ORIGIN",
      help: "content origin: user_said | tool_output | inferred",
      validate: (v) =>
        v === "user_said" || v === "tool_output" || v === "inferred"
          ? null
          : "--origin must be user_said, tool_output, or inferred",
    },
    {
      name: "--expected-revision",
      dest: "expectedRevision",
      takesValue: true,
      metavar: "REVISION",
      help: "opaque target revision captured before a replace",
    },
  ],
  handler: (ctx, args) => {
    const intent = s(args.intent) as PendingIntent;
    const expectedRevision = optS(args.expectedRevision)?.trim();
    if (expectedRevision !== undefined && expectedRevision === "") {
      throw new CliError("argument --expected-revision: expected a non-empty opaque revision", 2);
    }
    if (intent === "replace" && expectedRevision === undefined) {
      throw new CliError("argument --expected-revision: required when --intent replace", 2);
    }
    if (intent === "create" && expectedRevision !== undefined) {
      throw new CliError("argument --expected-revision: not allowed when --intent create", 2);
    }
    return pendingStage(ctx.root, {
      slug: s(args.slug),
      contentFile: s(args.content),
      producer: s(args.producer) || "asset-ingest",
      intent,
      contentOrigin: s(args.origin) as GbrainContentOrigin,
      ...(expectedRevision !== undefined ? { expectedRevision } : {}),
    });
  },
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
  handler: async (ctx, args) => {
    const result = await pendingApply(ctx.root, args.id === undefined ? undefined : s(args.id));
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
