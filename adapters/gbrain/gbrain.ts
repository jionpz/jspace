// adapters/gbrain/gbrain.ts — real gbrain CLI adapter (external system).
// The ONLY production impl of the GbrainDeps port consumed by
// application/pending/*. Process I/O goes through adapters/process/spawn.ts
// (async, timeout SIGTERM→SIGKILL, 1MiB output cap) — never a bare spawnSync,
// which would hang a harness hook forever when gbrain stalls (issue #8 #8).
import { spawnProcess, type SpawnOpts, type SpawnResult } from "../process/spawn.ts";

/** Port consumed by the application layer. get/put are async: a stalled gbrain
 *  resolves as `{ok:false}` after the timeout instead of blocking the caller. */
export interface GbrainDeps {
  get: (slug: string) => Promise<{ ok: boolean; content?: string }>;
  put: (slug: string, content: string) => Promise<{ ok: boolean; error?: string }>;
}

/** The process runner (spawnProcess); injectable for tests. */
export type GbrainRun = (argv: string[], opts: SpawnOpts) => Promise<SpawnResult>;

/** Default per-call budget — long enough for a real gbrain put, short enough
 *  that a stuck gbrain releases the hook. */
export const GBRAIN_TIMEOUT_MS = 30_000;

export function realGbrain(run: GbrainRun = spawnProcess, timeoutMs: number = GBRAIN_TIMEOUT_MS): GbrainDeps {
  const base: SpawnOpts = { cwd: process.cwd(), platform: process.platform, timeoutMs };
  return {
    async get(slug) {
      const r = await run(["gbrain", "get", slug], base);
      // stdout only — stderr noise must not corrupt the page body used for dedup hashing
      return r.exit === 0 && !r.timedOut ? { ok: true, content: r.stdout } : { ok: false };
    },
    async put(slug, content) {
      const r = await run(["gbrain", "put", slug], { ...base, input: content });
      return r.exit === 0 && !r.timedOut
        ? { ok: true }
        : { ok: false, error: `${r.stderr}${r.stdout}`.trim().slice(0, 300) || "gbrain put failed" };
    },
  };
}
