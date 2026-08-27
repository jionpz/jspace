// core/contracts/gbrain.ts — knowledge-store port consumed by the application
// layer. The production impl lives in adapters/gbrain (real gbrain CLI); tests
// inject fakes. Naming stays "gbrain" because that is the product's chosen
// memory backend and the CLI verb surface is the swap-out contract — see
// skills/jspace-use/references/gbrain.md 「Backend contract」.

/** Port consumed by the application layer. get/put/list are async: a stalled
 *  backend resolves as `{ok:false}` after the timeout instead of blocking the
 *  caller. */
export interface GbrainDeps {
  get: (slug: string) => Promise<{ ok: boolean; content?: string }>;
  put: (slug: string, content: string) => Promise<{ ok: boolean; error?: string }>;
  /** List pages with optional type/tag filters. Rows are slug+updatedAt pairs,
   *  machine-parseable for prefix filtering (no slug-prefix filter upstream). */
  list: (opts?: { type?: string; tag?: string; limit?: number }) => Promise<{
    ok: boolean;
    rows?: { slug: string; updatedAt: string }[];
    error?: string;
  }>;
}
