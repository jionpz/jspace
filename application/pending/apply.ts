// application/pending/apply.ts — pending envelope applier.
// Applies staged gbrain writes when the lock frees; repeated apply is
// idempotent (non-staged envelopes are skipped, and a page already holding the
// identical content is marked applied without a second write). A page that
// exists with DIFFERENT content is never auto-overwritten — it becomes
// terminal_failed (knowledge pages are append-only; the producer/ack decides).
// put failures bump retryCount; >= MAX_RETRY -> terminal_failed.
import { sha256Of } from "../workspace/manifest.ts";
import type { PendingWriteEnvelopeV1 } from "../../core/contracts/pending.ts";
import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts";
import { readEnvelope, readEnvelopes, writeEnvelope } from "./envelope.ts";

export const MAX_RETRY = 3;

export interface ApplyResult {
  applied: string[]; // put succeeded
  deduped: string[]; // page already held identical content -> applied no-op
  failed: string[]; // put failed, retryCount < MAX (stays staged, retryable)
  terminal: string[]; // retry exhausted OR conflicting existing page
  skipped: string[]; // already applied/acked/terminal_failed
}

function terminal(fhRoot: string, env: PendingWriteEnvelopeV1, error: string): void {
  writeEnvelope(fhRoot, { ...env, status: "terminal_failed", error });
}

/** Apply staged envelopes. Idempotent and safe: never overwrites an existing
 *  page whose content differs, never re-applies a non-staged envelope. async —
 *  the gbrain port is async (a stalled gbrain resolves as {ok:false} after the
 *  timeout instead of hanging the caller, issue #8 #8). */
export async function applyPending(fhRoot: string, gbrain: GbrainDeps, targetId?: string): Promise<ApplyResult> {
  const res: ApplyResult = { applied: [], deduped: [], failed: [], terminal: [], skipped: [] };
  const envs = targetId !== undefined ? [readEnvelope(fhRoot, targetId)] : readEnvelopes(fhRoot).records;
  for (const env of envs) {
    if (env.status !== "staged") {
      res.skipped.push(env.id);
      continue;
    }
    const existing = await gbrain.get(env.slug);
    // An existing page only dedupes/protects when it carries real content: an
    // empty page (`content === ""`) counts as absent, so a staged write can
    // proceed instead of being misclassified as "existing content differs".
    // Note: get→put is not atomic (gbrain is an external CLI; no compare-and-swap
    // here). This is a single-user local CLI — a concurrent external writer could
    // in theory race between the get and the put and be overwritten.
    if (existing.ok && existing.content !== undefined && existing.content !== "") {
      if (sha256Of(existing.content) === env.idempotencyKey) {
        // identical content already stored -> applied, no duplicate fact
        writeEnvelope(fhRoot, { ...env, status: "applied" });
        res.deduped.push(env.id);
      } else {
        // different content on an existing page: never auto-overwrite (knowledge
        // pages are append-only); surface for the producer/ack to decide.
        terminal(fhRoot, env, `page ${env.slug} exists with different content; refusing to overwrite`);
        res.terminal.push(env.id);
      }
      continue;
    }
    const put = await gbrain.put(env.slug, env.content);
    if (put.ok) {
      writeEnvelope(fhRoot, { ...env, status: "applied" });
      res.applied.push(env.id);
    } else {
      const retryCount = env.retryCount + 1;
      if (retryCount >= MAX_RETRY) {
        terminal(fhRoot, { ...env, retryCount }, put.error ?? "gbrain put failed");
        res.terminal.push(env.id);
      } else {
        writeEnvelope(fhRoot, { ...env, retryCount, error: put.error ?? "gbrain put failed" });
        res.failed.push(env.id); // stays staged -> next apply retries
      }
    }
  }
  return res;
}
