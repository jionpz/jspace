// application/pending/use-cases.ts — `jspace pending` use cases.
// Envelopes are workbench-owned state under `.jspace/state/pending/`.
import { existsSync, readFileSync } from "node:fs";
import type { CmdResult } from "../commands/command.ts";
import type { GbrainContentOrigin } from "../../core/contracts/gbrain.ts";
import type { PendingIntent } from "../../core/contracts/pending.ts";
import { fail } from "../../core/shared/errors.ts";
import { withPendingMutationLock } from "../lock.ts";
import { realGbrain, type GbrainDeps } from "../../adapters/gbrain/gbrain.ts";
import { readEnvelope, readEnvelopes, stageEnvelope, writeEnvelope } from "./envelope.ts";
import { applyPending } from "./apply.ts";

export interface PendingStageArgs {
  slug: string;
  contentFile: string;
  producer: string;
  intent: PendingIntent;
  contentOrigin: GbrainContentOrigin;
  expectedRevision?: string;
}

export function pendingStage(root: string, args: PendingStageArgs): CmdResult {
  if (!existsSync(args.contentFile)) fail(`content file not found: ${args.contentFile}`);
  const content = readFileSync(args.contentFile, "utf-8");
  const env = withPendingMutationLock(root, () =>
    stageEnvelope(root, {
      producer: args.producer,
      slug: args.slug,
      content,
      intent: args.intent,
      contentOrigin: args.contentOrigin,
      ...(args.expectedRevision !== undefined ? { expectedRevision: args.expectedRevision } : {}),
    }),
  );
  return {
    lines: [
      `jspace: ok: staged pending ${env.intent} ${env.id} (${env.slug}, producer ${env.producer}); apply later with "jspace pending apply"`,
    ],
  };
}

export function pendingList(root: string, json: boolean): CmdResult {
  const { records: envs, issues } = readEnvelopes(root);
  const warnings = issues.map((i) => `pending envelope damaged (${i.path}): ${i.message}`);
  if (json) {
    return { lines: [], data: { envelopes: envs, issues }, warnings: warnings.length > 0 ? warnings : undefined };
  }
  if (envs.length === 0 && issues.length === 0) return { lines: ["jspace: ok: no pending envelopes"] };
  const lines =
    envs.length === 0
      ? ["jspace: warn: no valid pending envelopes"]
      : envs.map(
          (e) =>
            `${e.id}  ${e.status}  ${e.intent}  retry=${e.retryCount}  ${e.slug}  (${e.producer})`,
        );
  return { lines, warnings: warnings.length > 0 ? warnings : undefined };
}

export async function pendingApply(
  root: string,
  id: string | undefined,
  gbrain: GbrainDeps = realGbrain(),
): Promise<CmdResult> {
  const damaged = readEnvelopes(root).issues;
  const res = await applyPending(root, gbrain, id);
  const attention = res.failed.length + res.terminal.length + damaged.length;
  const lines = [
    `jspace: ${attention > 0 ? "error" : "ok"}: pending apply: applied ${res.applied.length}, recovered ${res.recovered.length}, ` +
      `failed(retryable) ${res.failed.length}, terminal ${res.terminal.length}, skipped ${res.skipped.length}`,
  ];
  for (const t of res.terminal) {
    const env = readEnvelope(root, t);
    lines.push(`  [terminal] ${t} ${env.slug}: ${env.error ?? ""} (ack with: jspace pending ack ${t})`);
  }
  const warnings = damaged.map((i) => `pending envelope damaged (${i.path}): ${i.message}`);
  return {
    lines,
    ...(attention > 0 ? { exitCode: 1 } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export function pendingAck(root: string, id: string): CmdResult {
  return withPendingMutationLock(root, () => {
    const env = readEnvelope(root, id);
    if (env.status !== "terminal_failed") fail(`envelope ${id} is ${env.status}; only terminal_failed can be acked`);
    writeEnvelope(root, { ...env, status: "acked" });
    return { lines: [`jspace: ok: acknowledged pending write ${id} (${env.slug}); evidence retained`] };
  });
}
