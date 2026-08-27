// adapters/gbrain/gbrain.ts — real gbrain CLI adapter (external system).
// The ONLY production impl of the GbrainDeps port consumed by
// application/pending/*. Process I/O goes through adapters/process/spawn.ts
// (async, timeout SIGTERM→SIGKILL, 1MiB output cap) — never a bare spawnSync,
// which would hang a harness hook forever when gbrain stalls (issue #8 #8).
import { spawnProcess, type SpawnOpts, type SpawnResult } from "../process/spawn.ts";
import type { GbrainDeps } from "../../core/contracts/gbrain.ts";

export type { GbrainDeps };

/** The process runner (spawnProcess); injectable for tests. */
export type GbrainRun = (argv: string[], opts: SpawnOpts) => Promise<SpawnResult>;

/** Default per-call budget — long enough for a real gbrain put, short enough
 *  that a stuck gbrain releases the hook. */
export const GBRAIN_TIMEOUT_MS = 30_000;

/** Resolve argv[0] for gbrain CLI calls: `$GBRAIN_BIN` (trimmed) → bare
 *  `"gbrain"` on PATH. Unlike `defaultGbrainBin` in application/harness/wire.ts
 *  (used when writing absolute MCP config paths), this adapter does not probe
 *  PATH or `~/.bun/bin` — callers already degrade on `{ok:false}`, and users
 *  who need a non-PATH binary set `$GBRAIN_BIN` (the documented override for
 *  CLI shims / alternate KBs). Evaluated at call time so env changes take
 *  effect without reloading the module. */
export function resolveGbrainCliBin(envBin: string | undefined = process.env.GBRAIN_BIN): string {
  const trimmed = envBin?.trim();
  return trimmed ? trimmed : "gbrain";
}

export function realGbrain(
  run: GbrainRun = spawnProcess,
  timeoutMs: number = GBRAIN_TIMEOUT_MS,
  bin: string = resolveGbrainCliBin(),
): GbrainDeps {
  const base: SpawnOpts = { cwd: process.cwd(), platform: process.platform, timeoutMs };
  return {
    async get(slug) {
      const r = await run([bin, "get", slug], base);
      // stdout only — stderr noise must not corrupt the page body used for dedup hashing
      return r.exit === 0 && !r.timedOut ? { ok: true, content: r.stdout } : { ok: false };
    },
    async put(slug, content) {
      const r = await run([bin, "put", slug], { ...base, input: content });
      return r.exit === 0 && !r.timedOut
        ? { ok: true }
        : { ok: false, error: `${r.stderr}${r.stdout}`.trim().slice(0, 300) || "gbrain put failed" };
    },
    async list(opts) {
      const argv = [bin, "list"];
      if (opts?.type !== undefined) argv.push("--type", opts.type);
      if (opts?.tag !== undefined) argv.push("--tag", opts.tag);
      if (opts?.limit !== undefined) argv.push("--limit", String(opts.limit));
      const r = await run(argv, base);
      if (r.exit !== 0 || r.timedOut) {
        return { ok: false, error: `${r.stderr}${r.stdout}`.trim().slice(0, 300) || "gbrain list failed" };
      }
      // CLI list output is TSV: `slug\ttype\tupdated_at(YYYY-MM-DD)\ttitle` per line
      // (see gbrain src/cli.ts list_pages). Parse line by line; UPGRADE_AVAILABLE
      // warning goes to stderr, not stdout, so it never pollutes the rows.
      const rows = r.stdout
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => {
          const [slug, , updatedAt] = l.split("\t");
          return { slug, updatedAt: updatedAt ?? "" };
        });
      return { ok: true, rows };
    },
  };
}
