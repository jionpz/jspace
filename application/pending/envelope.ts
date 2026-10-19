// application/pending/envelope.ts — pending write repository. Envelopes live
// under the owning workbench at `.jspace/state/pending/<id>.APPLY.json`; a
// shared filehub is not a valid ownership boundary for deferred writes.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import {
  decodePendingEnvelope,
  ENVELOPE_EXT,
  type PendingIntent,
  type PendingWriteEnvelopeV2,
} from "../../core/contracts/pending.ts";
import type { GbrainContentOrigin } from "../../core/contracts/gbrain.ts";
import { sha256Of } from "../workspace/manifest.ts";
import { localStamp } from "../time.ts";
import { readJsonRecords } from "../fs.ts";
import type { ContractIssue } from "../../core/contracts/diagnostics.ts";

export const PENDING_STATE_DIR = join(CONFIG_DIR, "state", "pending");

export function envelopesDir(root: string): string {
  return join(root, PENDING_STATE_DIR);
}

export function envelopePath(root: string, id: string): string {
  return join(envelopesDir(root), `${id}${ENVELOPE_EXT}`);
}

export function readEnvelopes(root: string): {
  records: PendingWriteEnvelopeV2[];
  issues: ContractIssue[];
} {
  return readJsonRecords(envelopesDir(root), {
    ext: ENVELOPE_EXT,
    decode: decodePendingEnvelope,
    sort: (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  });
}

export function readEnvelope(root: string, id: string): PendingWriteEnvelopeV2 {
  const env = readEnvelopes(root).records.find((e) => e.id === id);
  if (!env) throw new Error(`no pending envelope: ${id}`);
  return env;
}

export function writeEnvelope(root: string, env: PendingWriteEnvelopeV2): void {
  mkdirSync(envelopesDir(root), { recursive: true });
  writeBytesAtomic(envelopePath(root, env.id), JSON.stringify(env, null, 2) + "\n");
}

export interface StageEnvelopeInput {
  producer: string;
  slug: string;
  content: string;
  intent: PendingIntent;
  contentOrigin: GbrainContentOrigin;
  expectedRevision?: string;
}

/** Stage a deferred write with a stable request identity. The id and request id
 *  intentionally match: one envelope is one retryable write intent. */
export function stageEnvelope(root: string, input: StageEnvelopeInput): PendingWriteEnvelopeV2 {
  if (input.intent === "replace" && input.expectedRevision === undefined) {
    throw new Error("pending replace requires expectedRevision");
  }
  if (input.intent === "create" && input.expectedRevision !== undefined) {
    throw new Error("pending create must not carry expectedRevision");
  }
  const requestId = crypto.randomUUID();
  const env: PendingWriteEnvelopeV2 = {
    schema_version: 2,
    id: requestId,
    requestId,
    intent: input.intent,
    ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
    contentHash: sha256Of(input.content),
    contentOrigin: input.contentOrigin,
    sourceId: `jspace:pending:${input.producer}:${requestId}`,
    producer: input.producer,
    slug: input.slug,
    content: input.content,
    status: "staged",
    retryCount: 0,
    createdAt: localStamp(),
  };
  writeEnvelope(root, env);
  return env;
}
