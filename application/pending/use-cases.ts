// application/pending/use-cases.ts — `jspace pending` use cases (Child E, AC11).
// Stage (producer), list, apply (applier) and ack staged gbrain writes stored as
// typed envelopes in `<filehub>/.jspace-logs/`. Mechanical; the skill calls these
// when a gbrain write conflicts with the serve lock.
import { existsSync, readFileSync } from "node:fs";
import type { CmdResult } from "../commands/command.ts";
import { fail } from "../errors.ts";
import { resolveFilehubRoot } from "../registry/filehub-lookup.ts";
import { readEnvelopes, readEnvelope, stageEnvelope, writeEnvelope } from "./envelope.ts";
import { applyPending, realGbrain, type GbrainDeps } from "./apply.ts";

/** Producer: stage a gbrain write (lock conflict / deferred apply). */
export function pendingStage(root: string, slug: string, contentFile: string, producer: string): CmdResult {
  const fh = resolveFilehubRoot(root);
  if (!fh) fail(`jspace: no filehub registered for workbench ${root}`);
  if (!existsSync(contentFile)) fail(`content file not found: ${contentFile}`);
  const content = readFileSync(contentFile, "utf-8");
  const env = stageEnvelope(fh, producer, slug, content);
  return { lines: [`jspace: ok: staged pending write ${env.id} (${env.slug}, producer ${producer}); apply later with "jspace pending apply"`] };
}

export function pendingList(root: string, json: boolean): CmdResult {
  const fh = resolveFilehubRoot(root);
  if (!fh) return json ? { lines: [], data: { envelopes: [] } } : { lines: ["jspace: ok: no filehub registered (no pending envelopes)"] };
  const envs = readEnvelopes(fh);
  if (json) return { lines: [], data: { envelopes: envs } };
  if (envs.length === 0) return { lines: ["jspace: ok: no pending envelopes"] };
  return { lines: envs.map((e) => `${e.id}  ${e.status}  retry=${e.retryCount}  ${e.slug}  (${e.producer})`) };
}

/** Applier: apply staged envelopes (dedupe / put / retry / terminal-failure). */
export function pendingApply(root: string, id: string | undefined, gbrain: GbrainDeps = realGbrain()): CmdResult {
  const fh = resolveFilehubRoot(root);
  if (!fh) fail(`jspace: no filehub registered for workbench ${root}`);
  const res = applyPending(fh, gbrain, id);
  const lines = [
    `jspace: ok: pending apply: applied ${res.applied.length}, deduped ${res.deduped.length}, ` +
      `failed(retryable) ${res.failed.length}, terminal ${res.terminal.length}, skipped ${res.skipped.length}`,
  ];
  for (const t of res.terminal) {
    const env = readEnvelope(fh, t);
    lines.push(`  [terminal] ${t} ${env.slug}: ${env.error ?? ""} (ack with: jspace pending ack ${t})`);
  }
  return { lines };
}

/** Acknowledge a terminal-failed envelope (evidence retained, stops alerting). */
export function pendingAck(root: string, id: string): CmdResult {
  const fh = resolveFilehubRoot(root);
  if (!fh) fail(`jspace: no filehub registered for workbench ${root}`);
  const env = readEnvelope(fh, id);
  if (env.status !== "terminal_failed") fail(`envelope ${id} is ${env.status}; only terminal_failed can be acked`);
  writeEnvelope(fh, { ...env, status: "acked" });
  return { lines: [`jspace: ok: acknowledged pending write ${id} (${env.slug}); evidence retained`] };
}
