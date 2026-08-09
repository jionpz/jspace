// core/contracts/diagnostics.ts — shared decode/issue types for all state
// contracts. Decoders are pure: they take `unknown` and return a typed value
// or a list of stable issues. No filesystem I/O, no throwing on bad fields.
export type Severity = "error" | "warning" | "info";

export interface ContractIssue {
  code: string;
  path: string;
  message: string;
}

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ContractIssue[] };

/** Runtime (post-decode) diagnostics; severity distinguishes blocking from advisory. */
export interface RegistryDiagnostic extends ContractIssue {
  severity: Severity;
}

/** Repository read outcome: missing and invalid are distinct from ok. */
export type FileRead<T> =
  | { status: "missing" }
  | { status: "invalid"; issues: ContractIssue[] }
  | { status: "ok"; value: T };

/** Accumulates independent issues so one decode reports every problem at once. */
export class IssueCollector {
  readonly issues: ContractIssue[] = [];

  add(code: string, path: string, message: string): void {
    this.issues.push({ code, path, message });
  }

  get ok(): boolean {
    return this.issues.length === 0;
  }
}

export function success<T>(value: T): DecodeResult<T> {
  return { ok: true, value };
}

export function failure<T>(issues: ContractIssue[]): DecodeResult<T> {
  return { ok: false, issues };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Reject unknown keys on closed objects (marker/local and contract-owned nested objects). */
export function checkNoUnknownFields(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  code: string,
  issues: IssueCollector,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      issues.add(code, `${prefix}.${key}`, `unknown field: ${key}`);
    }
  }
}

/** Read a required non-empty string; records one issue when missing/wrong-typed. */
export function readRequiredString(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
  code: string,
  issues: IssueCollector,
): string | undefined {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    issues.add(code, `${prefix}.${key}`, `${key} must be a non-empty string`);
    return undefined;
  }
  return v;
}

/** Read an optional string; records an issue only when present but wrong-typed/empty. */
export function readOptionalString(
  obj: Record<string, unknown>,
  key: string,
  prefix: string,
  code: string,
  issues: IssueCollector,
): string | undefined {
  if (obj[key] === undefined) return undefined;
  return readRequiredString(obj, key, prefix, code, issues);
}

/** UUID shape shared by every state contract's id (matches the historical
 *  ingest check; lenient enough for legacy writers, strict enough that junk
 *  ids can't pass). Accepts any UUID shape (v1/v3/v4/v5); variant/magic bits
 *  are not enforced. Rationale: v4-only 太严,而 jspace 生成的 id 本就是
 *  v4(crypto.randomUUID);接受任何形状的 uuid 可让外部工具自己生成的 ids
 *  也能进 schema。 */
export const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

/** Read a value that must be one of `allowed`; records an issue otherwise.
 *  Shared by run/incident/pending/cron decoders so enum strictness never drifts. */
export function readEnum<T extends string>(
  issues: IssueCollector,
  code: string,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.add(code, path, `must be one of ${allowed.join(", ")}`);
    return undefined;
  }
  return value as T;
}

/** Read a uuid; records an issue when the value is not the uuid shape. */
export function readUuid(issues: IssueCollector, code: string, path: string, value: unknown): string | undefined {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    issues.add(code, path, "must be a uuid");
    return undefined;
  }
  return value;
}

/** Read a strict boolean; records an issue otherwise. */
export function readBool(issues: IssueCollector, code: string, path: string, value: unknown): boolean | undefined {
  if (typeof value !== "boolean") {
    issues.add(code, path, "must be a boolean");
    return undefined;
  }
  return value;
}

/** Read a schema version that must be one of `expected`; records an issue otherwise. */
export function readVersion(
  issues: IssueCollector,
  code: string,
  path: string,
  value: unknown,
  expected: number[],
): number | undefined {
  if (typeof value !== "number" || !expected.includes(value)) {
    issues.add(code, path, `must be one of ${expected.join(", ")}`);
    return undefined;
  }
  return value;
}
