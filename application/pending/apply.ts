// application/pending/apply.ts — pending envelope applier.
//
// Safety rules:
// - `create` never overwrites an existing target.
// - `replace` uses the revision captured at stage time.
// - one stable request id is replayed unchanged.
// - a committed receipt plus readback is required before marking applied.
// - lock/timeout/transport failures stay retryable; semantic conflicts become
//   terminal and require an ack or a new intent.
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";
import type { PendingWriteEnvelopeV2 } from "../../core/contracts/pending.ts";
import { withPendingMutationLockAsync } from "../lock.ts";
import { sha256Of } from "../workspace/manifest.ts";
import { localStamp } from "../time.ts";
import { readEnvelope, readEnvelopes, writeEnvelope } from "./envelope.ts";

export const MAX_RETRY = 3;

export interface ApplyResult {
  applied: string[];
  recovered: string[];
  failed: string[];
  terminal: string[];
  skipped: string[];
}

function applied(root: string, env: PendingWriteEnvelopeV2, revision: string): void {
  writeEnvelope(root, {
    ...env,
    status: "applied",
    appliedAt: localStamp(),
    committedRevision: revision,
    error: undefined,
  });
}

function terminal(root: string, env: PendingWriteEnvelopeV2, error: string): void {
  writeEnvelope(root, { ...env, status: "terminal_failed", error });
}

function retry(root: string, env: PendingWriteEnvelopeV2, error: string): boolean {
  const retryCount = env.retryCount + 1;
  if (retryCount >= MAX_RETRY) {
    terminal(root, { ...env, retryCount }, error);
    return false;
  }
  writeEnvelope(root, { ...env, retryCount, error });
  return true;
}

function isTransient(code: string): boolean {
  return code === "lock" || code === "timeout" || code === "process_error" || code === "unknown";
}

function failOrRetry(
  root: string,
  env: PendingWriteEnvelopeV2,
  transient: boolean,
  error: string,
  res: ApplyResult,
): void {
  if (transient) {
    if (retry(root, env, error)) res.failed.push(env.id);
    else res.terminal.push(env.id);
    return;
  }
  terminal(root, env, error);
  res.terminal.push(env.id);
}

async function verifyReadback(
  gbrain: GbrainDeps,
  env: PendingWriteEnvelopeV2,
  committedRevision: string,
): Promise<{ ok: true } | { ok: false; terminal: boolean; error: string }> {
  const page = await gbrain.getPage(env.slug);
  if (!page.ok) {
    return {
      ok: false,
      terminal: page.code === "not_found" || page.code === "schema_error",
      error: `readback failed (${page.code}): ${page.message}`,
    };
  }
  if (page.page.slug !== env.slug) {
    return {
      ok: false,
      terminal: true,
      error: `readback returned slug ${page.page.slug}, expected ${env.slug}`,
    };
  }
  if (page.page.revision !== committedRevision) {
    return {
      ok: false,
      terminal: true,
      error: `readback revision ${page.page.revision} does not match committed revision ${committedRevision}`,
    };
  }
  if (page.page.contentHash.trim() === "") {
    return { ok: false, terminal: true, error: "readback page has an empty content_hash" };
  }
  return { ok: true };
}

export async function applyPending(
  root: string,
  gbrain: GbrainDeps,
  targetId?: string,
): Promise<ApplyResult> {
  const res: ApplyResult = { applied: [], recovered: [], failed: [], terminal: [], skipped: [] };
  const ids =
    targetId !== undefined
      ? [targetId]
      : readEnvelopes(root).records.map((e) => e.id);
  for (const id of ids) {
    await withPendingMutationLockAsync(root, () => applyOne(root, gbrain, id, res));
  }
  return res;
}

async function applyOne(root: string, gbrain: GbrainDeps, id: string, res: ApplyResult): Promise<void> {
  const env = readEnvelope(root, id);
  if (env.status !== "staged") {
    res.skipped.push(env.id);
    return;
  }
  if (sha256Of(env.content) !== env.contentHash) {
    terminal(root, env, "envelope content no longer matches contentHash");
    res.terminal.push(env.id);
    return;
  }

  // A previous response may have been lost after commit. Resolve that receipt
  // before issuing a new semantic check.
  const receipt = await gbrain.getWriteRequest(env.requestId);
  if (receipt.ok && receipt.receipt.state === "committed") {
    const revision = receipt.receipt.revision;
    if (revision === undefined) {
      terminal(root, env, "committed write receipt has no revision");
      res.terminal.push(env.id);
      return;
    }
    const verified = await verifyReadback(gbrain, env, revision);
    if (verified.ok) {
      applied(root, env, revision);
      res.recovered.push(env.id);
      return;
    }
    terminal(root, env, `committed receipt could not be verified: ${verified.error}`);
    res.terminal.push(env.id);
    return;
  }
  if (!receipt.ok && receipt.code !== "not_found") {
    failOrRetry(
      root,
      env,
      isTransient(receipt.code),
      `receipt lookup failed (${receipt.code}): ${receipt.message}`,
      res,
    );
    return;
  }

  if (env.intent === "create") {
    const existing = await gbrain.getPage(env.slug);
    if (existing.ok) {
      terminal(root, env, `page ${env.slug} already exists (create intent never overwrites)`);
      res.terminal.push(env.id);
      return;
    }
    if (existing.code !== "not_found") {
      failOrRetry(
        root,
        env,
        isTransient(existing.code),
        `create preflight failed (${existing.code}): ${existing.message}`,
        res,
      );
      return;
    }
  }

  const put = await gbrain.putPage({
    slug: env.slug,
    content: env.content,
    requestId: env.requestId,
    contentOrigin: env.contentOrigin,
    sourceId: env.sourceId,
    ...(env.intent === "replace" ? { expectedRevision: env.expectedRevision } : {}),
  });
  if (!put.ok) {
    failOrRetry(root, env, isTransient(put.code), `put failed (${put.code}): ${put.message}`, res);
    return;
  }

  const verified = await verifyReadback(gbrain, env, put.revision);
  if (!verified.ok) {
    failOrRetry(root, env, !verified.terminal, verified.error, res);
    return;
  }
  applied(root, env, put.revision);
  res.applied.push(env.id);
}
