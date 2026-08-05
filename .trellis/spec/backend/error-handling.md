# Error Handling

> How errors are handled in this project. Three layers: user-facing `fail()`/`CmdResult` exit codes, contract decoding (diagnostics), and structured registry diagnostics.

## Overview

- **CLI user errors** throw via `fail()` (or return a `CmdResult` with an exit code) → `cli/main.ts` prints `jspace: error: <message>` and exits non-zero.
- **Schema/contract errors** go through the shared diagnostics decoder (typed issue codes), never partial-parse.
- **Health checks** (`doctor`, `cron check`) return structured diagnostics + exit code 1 when unhealthy; they do not throw for "expected" findings.

## Error Types

- `fail(msg)` — `core/shared/errors.ts`; throws; the CLI layer catches and prints `jspace: error: <msg>`, exits 1. Used for fatal, user-actionable errors; the message should include the **fix action** where possible (`run "jspace workspace upgrade" to restore`).
- `CmdResult` — the normal return channel:

```ts
interface CmdResult {
  exitCode?: number;   // default 0; doctor/cron-check use 1 for unhealthy
  lines: string[];     // stdout
  errors?: string[];   // stderr channel (doctor/upgrade diagnostics)
  warnings?: string[];
  data?: unknown;      // --json payloads
}
```

- `DecodeResult<T>` — `{ ok: true, value } | { ok: false, issues: Issue[] }` from the diagnostics decoder.

## Error Handling Patterns

- **Contract decoding (diagnostics pattern)** — every typed contract in `core/contracts/*` decodes strictly:

```ts
import { checkNoUnknownFields, isRecord, IssueCollector, readRequiredString, ... } from "./diagnostics.ts";

export function decodeIngestJournal(input: unknown): DecodeResult<IngestJournalV1> {
  const issues = new IssueCollector();
  checkNoUnknownFields(input, [...], "ingest", "ingest.unknown-field", issues);
  // readRequiredString / type checks -> issues.add(code, path, message)
  if (!issues.ok) return failure(issues.issues);
  return success(input as IngestJournalV1);
}
```

- **Strict unknown-field**: extra fields are rejected, not ignored.
- **Version discipline**: each contract carries `version` / `schema_version`; unsupported versions fail with a `*.version.unsupported` code (never silently accepted). Internal schema changes bump the version with an explicit migration path.
- **Issue codes** are layered `<file>.<field>.<kind>` (e.g. `ingest.status.invalid`, `pending.unknown-field`) so consumers can group on stable codes.
- **State-machine transitions** throw on illegal moves rather than silently no-op: `ingest <id>: cannot advance to <step> from <status>`; `only terminal_failed can be acked`.
- **Destructive-op ordering leaves a retryable marker**: persist the target state before the destructive operation and only flip to the terminal state after the operation is proven complete. Ingest commit does this with cleanup-pending: persist `failed + failedStep=committed` first (a legal, pre-existing v1 combination — reuse it, do not bump the schema), then unlink the source, then persist `committed`. On unlink failure the journal stays cleanup-pending, the command exits non-zero with an exact retry command, and the same `--complete` converges idempotently (unlink if the source is present, persist committed if already gone). `begin` refuses to re-stage while cleanup is pending; `advance`/`fail`/`rollback` refuse to disturb it. A visible retryable residue beats a false terminal state or silent loss.
- Errors are **propagated to the caller** as `CmdResult` (with exitCode) or thrown to the CLI entry — never swallowed into a fake success.

## Machine-Truth Read Policy (recovery-critical vs historical)

Every machine-truth state has a versioned decoder in `core/contracts/*` (strict unknown-field + `version`). When READING it, classify the state into one of two policies — never a silent `null` on damage:

| Class | Examples | Damaged record | Absent file |
|---|---|---|---|
| **Recovery-critical** | materialized journal, upgrade journal | `fail()` with file path + fix direction (`repair it or run "jspace workspace upgrade" to restore`) | `null` / explicit "no journal" error — genuinely absent, not damage |
| **Historical collection** | run records, incidents, ingest journals, pending envelopes | surfaced as `ContractIssue` (parse/decode codes), valid records still readable | empty collection |

- Historical reads go through `readJsonRecords(dir, { ext, decode, sort })` → `{ records, issues }`; a corrupt file never blocks the rest. Consumers that feed health surfaces (`cronFailures` / `doctor`) must forward `issues` as warnings — damaged records count toward `needs_attention`, they are never silently dropped.
- All state writes use `writeBytesAtomic` (temp sibling + rename) — no path may leave a partial JSON readable as complete state.

```ts
// recovery-critical: only "file truly missing" may be null
const raw = safeReadFile(p);
if (raw === null) return null;
const d = decodeUpgradeJournal(JSON.parse(raw));   // throws on bad JSON/damage
if (!d.ok) fail(`upgrade journal ${p} is damaged: ...; fix it before rolling back`);
return d.value;
```

```ts
// historical: valid records load, damaged ones report as issues
export function readRuns(root, cronId): { records: RunRecord[]; issues: ContractIssue[] } {
  return readJsonRecords(runsDir(root, cronId), { ext: ".json", decode: decodeRunRecord, sort });
}
```

## API / CLI Error Responses

- `jspace: error: <message>` + non-zero exit for user errors.
- `jspace doctor` prints structured diagnostics and exits 1 on errors.
- `jspace cron check` aggregates incidents + pending writes + cron status, exits 1 when attention needed.
- `--json` commands return `{ ...data, errors?, warnings? }`; exit codes stay scriptable.

## Common Mistakes

- Partial-parse / type-coerce unknown JSON without the decoder.
- Collapsing distinct diagnostic classes (invalid / unbound / missing / drift) into one generic "registry broken".
- Swallowing `fail()` and returning exit 0.
- Throwing raw `Error` with no `jspace: ` user prefix (state-machine errors are the exception; the CLI layer wraps them).
