// adapters/gbrain/gbrain.ts — production gbrain adapter over the structured
// `gbrain call <method> <json>` interface. Process I/O goes through the shared
// async runner so a stalled backend cannot hang a harness hook.
import { spawnProcess, type SpawnOpts, type SpawnResult } from "../process/spawn.ts";
import type {
  GbrainDeps,
  GbrainBacklinksResult,
  GbrainErrorCode,
  GbrainFailure,
  GbrainListCursor,
  GbrainListResult,
  GbrainListRow,
  GbrainPageResult,
  GbrainPutResult,
  GbrainWriteRequestResult,
} from "../../core/contracts/gbrain.ts";

export type { GbrainDeps };

/** The process runner (spawnProcess); injectable for tests. */
export type GbrainRun = (argv: string[], opts: SpawnOpts) => Promise<SpawnResult>;

/** Default per-call budget. Pending lock budgets must remain above it. */
export const GBRAIN_TIMEOUT_MS = 30_000;

/** Resolve argv[0]: `$GBRAIN_BIN` (trimmed) -> bare `"gbrain"` on PATH. */
export function resolveGbrainCliBin(envBin: string | undefined = process.env.GBRAIN_BIN): string {
  const trimmed = envBin?.trim();
  return trimmed ? trimmed : "gbrain";
}

function failure(code: GbrainErrorCode, message: string, rawCode?: string): GbrainFailure {
  return { ok: false, code, message, ...(rawCode !== undefined ? { rawCode } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function rawErrorStatus(stdout: string, stderr: string): { rawCode?: string; message: string } {
  for (const text of [stdout, stderr]) {
    const parsed = parseJson(text);
    if (!isRecord(parsed)) continue;
    const rawCode =
      typeof parsed.code === "string"
        ? parsed.code
        : typeof parsed.error_code === "string"
          ? parsed.error_code
          : undefined;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : undefined;
    if (rawCode !== undefined || message !== undefined) {
      return {
        ...(rawCode !== undefined ? { rawCode } : {}),
        message: message ?? rawCode ?? "gbrain call failed",
      };
    }
  }
  const line = `${stderr}\n${stdout}`.split("\n").map((s) => s.trim()).find((s) => s !== "");
  return { message: line?.slice(0, 500) ?? "gbrain call failed" };
}

function normalizeError(stdout: string, stderr: string): GbrainFailure {
  const { rawCode, message } = rawErrorStatus(stdout, stderr);
  const key = (rawCode ?? message).toLowerCase();
  if (key.includes("page_not_found") || key === "not_found") return failure("not_found", message, rawCode);
  if (key.includes("revision_required")) return failure("revision_required", message, rawCode);
  if (key.includes("revision_conflict")) return failure("revision_conflict", message, rawCode);
  if (key.includes("idempotency_conflict")) return failure("idempotency_conflict", message, rawCode);
  if (key.includes("lock")) return failure("lock", message, rawCode);
  if (key.includes("timeout") || key.includes("timed out")) return failure("timeout", message, rawCode);
  return failure("process_error", message, rawCode);
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function tagsField(obj: Record<string, unknown>): string[] {
  if (!Array.isArray(obj.tags)) return [];
  return obj.tags.filter((tag): tag is string => typeof tag === "string");
}

function parsePage(raw: unknown, expectedSlug: string): GbrainPageResult {
  const candidate = isRecord(raw) && isRecord(raw.page) ? raw.page : raw;
  if (!isRecord(candidate)) return failure("schema_error", "get_page returned a non-object payload");
  const slug = stringField(candidate, "slug") ?? expectedSlug;
  const revision = stringField(candidate, "revision");
  const contentHash = stringField(candidate, "content_hash") ?? stringField(candidate, "contentHash");
  const content = stringField(candidate, "content");
  if (revision === undefined || contentHash === undefined || content === undefined) {
    return failure("schema_error", "get_page payload lacks revision, content_hash, or content");
  }
  const updatedAt =
    stringField(candidate, "updated_at_iso") ??
    stringField(candidate, "updated_at") ??
    stringField(candidate, "updatedAt");
  const trustTier = stringField(candidate, "trust_tier") ?? stringField(candidate, "trustTier");
  return {
    ok: true,
    page: {
      slug,
      revision,
      contentHash,
      content,
      tags: tagsField(candidate),
      ...(stringField(candidate, "type") !== undefined ? { type: stringField(candidate, "type")! } : {}),
      ...(stringField(candidate, "title") !== undefined ? { title: stringField(candidate, "title")! } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(stringField(candidate, "origin") !== undefined ? { origin: stringField(candidate, "origin")! } : {}),
      ...(trustTier !== undefined ? { trustTier } : {}),
    },
  };
}

function parseListRows(raw: unknown): GbrainListRow[] | null {
  const rows = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.rows)
      ? raw.rows
      : isRecord(raw) && Array.isArray(raw.pages)
        ? raw.pages
        : null;
  if (rows === null) return null;
  const out: GbrainListRow[] = [];
  for (const row of rows) {
    if (!isRecord(row)) return null;
    const slug = stringField(row, "slug");
    const updatedAt = stringField(row, "updated_at_iso") ?? stringField(row, "updated_at");
    if (slug === undefined || updatedAt === undefined) return null;
    out.push({
      slug,
      type: stringField(row, "type") ?? "",
      title: stringField(row, "title") ?? "",
      updatedAt,
      ...(stringField(row, "source_id") !== undefined ? { sourceId: stringField(row, "source_id")! } : {}),
    });
  }
  return out;
}

function parsePut(raw: unknown, requestId: string): GbrainPutResult {
  const candidate = isRecord(raw) && isRecord(raw.result) ? raw.result : raw;
  if (!isRecord(candidate)) return failure("schema_error", "put_page returned a non-object payload");
  const revision = stringField(candidate, "revision");
  const state = stringField(candidate, "state");
  if (revision === undefined || state === undefined) {
    return failure("schema_error", "put_page payload lacks revision or state");
  }
  return {
    ok: true,
    requestId: stringField(candidate, "request_id") ?? stringField(candidate, "requestId") ?? requestId,
    state,
    revision,
    ...(stringField(candidate, "operation") !== undefined ? { operation: stringField(candidate, "operation")! } : {}),
    ...(stringField(candidate, "outcome") !== undefined ? { outcome: stringField(candidate, "outcome")! } : {}),
  };
}

function parseBacklinks(raw: unknown): GbrainBacklinksResult {
  const candidate = isRecord(raw) && isRecord(raw.result) ? raw.result : raw;
  if (!isRecord(candidate) || !Array.isArray(candidate.rows)) {
    return failure("schema_error", "get_backlinks payload lacks rows");
  }
  const rows: { slug: string; title?: string }[] = [];
  for (const row of candidate.rows) {
    if (!isRecord(row) || typeof row.slug !== "string") {
      return failure("schema_error", "get_backlinks contains an invalid row");
    }
    rows.push({
      slug: row.slug,
      ...(typeof row.title === "string" ? { title: row.title } : {}),
    });
  }
  const coverageRaw = candidate.coverage;
  const coverage = isRecord(coverageRaw)
    ? {
        state: typeof coverageRaw.state === "string" ? coverageRaw.state : "unknown",
        degraded:
          typeof coverageRaw.degraded === "boolean"
            ? coverageRaw.degraded
            : coverageRaw.state !== "complete",
      }
    : { state: "unknown", degraded: true };
  return {
    ok: true,
    rows,
    total: numberField(candidate, "total") ?? rows.length,
    truncated: candidate.truncated === true,
    ...(typeof candidate.cursor === "string" ? { cursor: candidate.cursor } : {}),
    coverage,
  };
}

export function realGbrain(
  run: GbrainRun = spawnProcess,
  timeoutMs: number = GBRAIN_TIMEOUT_MS,
  bin: string = resolveGbrainCliBin(),
): GbrainDeps {
  const base: SpawnOpts = { cwd: process.cwd(), platform: process.platform, timeoutMs };

  async function call(
    method: string,
    args: Record<string, unknown>,
    callTimeoutMs?: number,
  ): Promise<{ ok: true; value: unknown } | GbrainFailure> {
    // A shared deadline hands each call its own remaining budget; a missing
    // override keeps the adapter default so every pre-existing caller is intact.
    const effectiveTimeoutMs = callTimeoutMs ?? timeoutMs;
    const r = await run([bin, "call", method, JSON.stringify(args)], {
      ...base,
      timeoutMs: effectiveTimeoutMs,
    });
    if (r.timedOut) return failure("timeout", `gbrain ${method} timed out after ${effectiveTimeoutMs}ms`);
    if (r.exit !== 0) return normalizeError(r.stdout, r.stderr);
    const parsed = parseJson(r.stdout);
    if (parsed === undefined) return failure("schema_error", `gbrain ${method} returned non-JSON stdout`);
    return { ok: true, value: parsed };
  }

  return {
    async getPage(slug, opts = {}) {
      const r = await call("get_page", { slug, include_content: true }, opts.timeoutMs);
      return r.ok ? parsePage(r.value, slug) : r;
    },

    async listPages(opts = {}) {
      const limit = opts.limit ?? 100;
      const sort = opts.sort ?? "updated_asc";
      // Ascending keyset and descending offset are separate continuations; mixing
      // them would invent a stability the store does not provide. Fail loud here
      // instead of silently dropping one of the two arguments.
      if (opts.cursor !== undefined && sort === "updated_desc") {
        return failure("schema_error", "list_pages: cursor is only valid with updated_asc");
      }
      if (opts.offset !== undefined && sort === "updated_asc") {
        return failure("schema_error", "list_pages: offset is only valid with updated_desc");
      }
      const args: Record<string, unknown> = {
        limit,
        sort,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.tag !== undefined ? { tag: opts.tag } : {}),
        ...(opts.cursor !== undefined
          ? {
              updated_after: opts.cursor.updatedAfter,
              updated_after_slug: opts.cursor.updatedAfterSlug,
            }
          : {}),
        ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
      };
      const r = await call("list_pages", args, opts.timeoutMs);
      if (!r.ok) return r;
      const rows = parseListRows(r.value);
      if (rows === null) return failure("schema_error", "list_pages returned an invalid row set");
      const filled = rows.length >= limit;
      if (sort === "updated_desc") {
        const nextOffset = filled ? (opts.offset ?? 0) + rows.length : undefined;
        return {
          ok: true,
          rows,
          ...(nextOffset !== undefined ? { nextOffset } : {}),
        } satisfies GbrainListResult;
      }
      const last = rows.at(-1);
      const nextCursor: GbrainListCursor | undefined =
        filled && last !== undefined
          ? { updatedAfter: last.updatedAt, updatedAfterSlug: last.slug }
          : undefined;
      return {
        ok: true,
        rows,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
      } satisfies GbrainListResult;
    },

    async putPage(input) {
      const r = await call("put_page", {
        slug: input.slug,
        content: input.content,
        request_id: input.requestId,
        content_origin: input.contentOrigin,
        source_id: input.sourceId,
        ...(input.expectedRevision !== undefined ? { expected_revision: input.expectedRevision } : {}),
      });
      return r.ok ? parsePut(r.value, input.requestId) : r;
    },

    async getWriteRequest(requestId) {
      const r = await call("get_write_request", { request_id: requestId });
      if (!r.ok) return r;
      const candidate = isRecord(r.value) && isRecord(r.value.request) ? r.value.request : r.value;
      if (!isRecord(candidate)) {
        return failure("schema_error", "get_write_request returned an invalid receipt");
      }
      const receiptRequestId =
        stringField(candidate, "request_id") ?? stringField(candidate, "requestId");
      const state = stringField(candidate, "state");
      if (receiptRequestId === undefined || state === undefined) {
        return failure("schema_error", "get_write_request receipt lacks request_id or state");
      }
      return {
        ok: true,
        receipt: {
          requestId: receiptRequestId,
          state,
          ...(stringField(candidate, "revision") !== undefined
            ? { revision: stringField(candidate, "revision")! }
            : {}),
          ...(stringField(candidate, "operation") !== undefined
            ? { operation: stringField(candidate, "operation")! }
            : {}),
          ...(stringField(candidate, "outcome") !== undefined
            ? { outcome: stringField(candidate, "outcome")! }
            : {}),
          ...(stringField(candidate, "slug") !== undefined ? { slug: stringField(candidate, "slug")! } : {}),
        },
      } satisfies GbrainWriteRequestResult;
    },

    async getBacklinks(slug, opts = {}) {
      const r = await call("get_backlinks", {
        slug,
        group: "page",
        limit: opts.limit ?? 100,
        ...(opts.cursor !== undefined ? { cursor: opts.cursor } : {}),
      });
      return r.ok ? parseBacklinks(r.value) : r;
    },
  };
}
