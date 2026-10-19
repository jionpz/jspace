// core/contracts/gbrain.ts — knowledge-store port consumed by the application
// layer. The production adapter uses gbrain's structured `call` surface; the
// old bare-text/TSV CLI shapes are not part of this contract.

export const GBRAIN_ERROR_CODES = [
  "not_found",
  "revision_required",
  "revision_conflict",
  "idempotency_conflict",
  "lock",
  "timeout",
  "schema_error",
  "process_error",
  "unknown",
] as const;

export type GbrainErrorCode = (typeof GBRAIN_ERROR_CODES)[number];
export type GbrainContentOrigin = "user_said" | "tool_output" | "inferred";

export interface GbrainFailure {
  ok: false;
  code: GbrainErrorCode;
  message: string;
  /** Backend code retained for diagnostics (for example `page_not_found`). */
  rawCode?: string;
}

export interface GbrainPage {
  slug: string;
  /** Opaque CAS token from gbrain (currently a UUID string). */
  revision: string;
  contentHash: string;
  content: string;
  tags: string[];
  type?: string;
  title?: string;
  updatedAt?: string;
  origin?: string;
  trustTier?: string;
}

export interface GbrainListCursor {
  updatedAfter: string;
  updatedAfterSlug: string;
}

export interface GbrainListOptions {
  type?: string;
  tag?: string;
  limit?: number;
  cursor?: GbrainListCursor;
}

export interface GbrainListRow {
  slug: string;
  type?: string;
  title?: string;
  updatedAt: string;
  sourceId?: string;
}

export interface GbrainBacklinkRow {
  slug: string;
  title?: string;
}

export interface GbrainCoverage {
  state: string;
  degraded: boolean;
}

export interface GbrainPutInput {
  slug: string;
  content: string;
  requestId: string;
  contentOrigin: GbrainContentOrigin;
  sourceId: string;
  expectedRevision?: string;
}

export interface GbrainWriteReceipt {
  requestId: string;
  state: string;
  revision?: string;
  operation?: string;
  outcome?: string;
  slug?: string;
}

export type GbrainPageResult = { ok: true; page: GbrainPage } | GbrainFailure;

export type GbrainListResult =
  | {
      ok: true;
      rows: GbrainListRow[];
      /** Present when the adapter filled the requested page size. */
      nextCursor?: GbrainListCursor;
    }
  | GbrainFailure;

export type GbrainPutResult =
  | {
      ok: true;
      requestId: string;
      state: string;
      revision: string;
      operation?: string;
      outcome?: string;
    }
  | GbrainFailure;

export type GbrainWriteRequestResult =
  | { ok: true; receipt: GbrainWriteReceipt }
  | GbrainFailure;

export type GbrainBacklinksResult =
  | {
      ok: true;
      rows: GbrainBacklinkRow[];
      total: number;
      truncated: boolean;
      cursor?: string;
      coverage: GbrainCoverage;
    }
  | GbrainFailure;

/** Port consumed by the application layer. Every operation resolves to a
 *  typed result; transport failures never throw into a harness hook.
 *  `getWriteRequest` returns `not_found` for an unknown request id. */
export interface GbrainDeps {
  getPage: (slug: string) => Promise<GbrainPageResult>;
  listPages: (opts?: GbrainListOptions) => Promise<GbrainListResult>;
  putPage: (input: GbrainPutInput) => Promise<GbrainPutResult>;
  getWriteRequest: (requestId: string) => Promise<GbrainWriteRequestResult>;
  getBacklinks: (
    slug: string,
    opts?: { limit?: number; cursor?: string },
  ) => Promise<GbrainBacklinksResult>;
}
