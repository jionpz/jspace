// application/pending/envelope.ts — pending write envelope repository. Envelopes
// live in `<filehub>/.jspace-logs/<id>.APPLY.json` (same dir the cron/doctor
// scanners surface). Pure persistence over an explicit fhRoot; the applier and
// CLI use cases live in apply.ts / use-cases.ts.
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import {
  decodePendingEnvelope,
  ENVELOPE_EXT,
  type PendingWriteEnvelopeV1,
} from "../../core/contracts/pending.ts";
import { sha256Of } from "../workspace/manifest.ts";

export const PENDING_LOG_DIR = ".jspace-logs";

export function envelopesDir(fhRoot: string): string {
  return join(fhRoot, PENDING_LOG_DIR);
}

function localStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

export function envelopePath(fhRoot: string, id: string): string {
  return join(envelopesDir(fhRoot), `${id}${ENVELOPE_EXT}`);
}

export function readEnvelopes(fhRoot: string): PendingWriteEnvelopeV1[] {
  let names: string[];
  try {
    names = readdirSync(envelopesDir(fhRoot));
  } catch {
    return [];
  }
  const out: PendingWriteEnvelopeV1[] = [];
  for (const n of names) {
    if (!n.endsWith(ENVELOPE_EXT)) continue;
    try {
      const decoded = decodePendingEnvelope(JSON.parse(readFileSync(join(envelopesDir(fhRoot), n), "utf-8")));
      if (decoded.ok) out.push(decoded.value);
    } catch {
      /* skip corrupt envelope */
    }
  }
  // deterministic order: createdAt then id — readdir order differs across
  // filesystems (APFS vs ext4) and a createdAt tie must not make the order
  // filesystem-dependent (CI caught a flaky order in cron.test.ts).
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function readEnvelope(fhRoot: string, id: string): PendingWriteEnvelopeV1 {
  const env = readEnvelopes(fhRoot).find((e) => e.id === id);
  if (!env) throw new Error(`no pending envelope: ${id}`);
  return env;
}

export function writeEnvelope(fhRoot: string, env: PendingWriteEnvelopeV1): void {
  mkdirSync(envelopesDir(fhRoot), { recursive: true });
  // atomic write (temp+rename): a crash mid-write must not leave a truncated
  // .APPLY.json that readEnvelopes would silently skip.
  writeBytesAtomic(envelopePath(fhRoot, env.id), JSON.stringify(env, null, 2) + "\n");
}

/** Producer: stage a gbrain write (lock conflict / deferred). Idempotency key is
 *  sha256(content) so the applier can dedupe and repeated apply never duplicates. */
export function stageEnvelope(fhRoot: string, producer: string, slug: string, content: string): PendingWriteEnvelopeV1 {
  const env: PendingWriteEnvelopeV1 = {
    version: 1,
    id: crypto.randomUUID(),
    idempotencyKey: sha256Of(content),
    producer,
    slug,
    content,
    status: "staged",
    retryCount: 0,
    createdAt: localStamp(),
  };
  writeEnvelope(fhRoot, env);
  return env;
}
