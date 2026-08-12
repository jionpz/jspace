# Error Handling

> How errors are handled in this project. Three layers: user-facing `fail()`/`CmdResult` exit codes, contract decoding (diagnostics), and structured registry diagnostics.

## Overview

- **CLI user errors** throw via `fail()` (or return a `CmdResult` with an exit code) → `cli/main.ts` prints `jspace: error: <message>` and exits non-zero.
- **Schema/contract errors** go through the shared diagnostics decoder (typed issue codes), never partial-parse.
- **Health checks** (`doctor`, `cron check`) return structured diagnostics + exit code 1 when unhealthy; they do not throw for "expected" findings.
- **Diagnostic severity contract** (`core/contracts/diagnostics.ts` `Severity`): three levels, each with a distinct meaning — pick the level, not "the loudest one":
  - `error` — blocking; `doctor` exits 1 (missing/invalid machine truth).
  - `warning` — a real health problem worth acting on, but non-blocking (e.g. `cron.not_installed` when the user explicitly enabled a cron that never got installed; damaged incident record).
  - `info` — optional capability unconfigured with a designed degraded path, NOT a health problem; never counts as a warning, never sets exit code, surfaced only in `--json` diagnostics (`filehub.unregistered`: asset-ingest falls back to the staging area).
  - Default state is not a warning: a fresh workbench with the template's `enabled: false` crons and no filehub reports `0 error(s), 0 warning(s)` (the `info` count shows optional capabilities).

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
- **Version discipline**: each contract carries `version` / `schema_version`; unsupported versions fail with a `*.version.unsupported` code (never silently accepted). Internal schema changes bump the version with an explicit migration path. A `*.version.unsupported` error surfaced to the user (registry inspect, cron `loadCrons`) appends the shared `SCHEMA_VERSION_REPAIR_HINT` so a pre-1.0.11 state file shows how to fix it (regenerate or hand-edit); no migration channel is introduced (no-compat-burden rule).
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
- **Read-only diagnostics never throw on a hand-edited file**: `doctor`'s injected `readJson` lambda returns the `INVALID_JSON` sentinel instead of throwing, and a harness config whose `JSON.parse` fails degrades to an `info` diagnostic (`gbrain.config_invalid_json`) instead of crashing the whole run (issue #9 #9-02/#9-03).

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

## Process / Scheduler Reliability Guards

- **O_EXCL lock**: a post-create write failure (ENOSPC/EIO) is NOT contention — remove your own 0-byte poison lock and propagate, or every process skips for the whole staleMs and the real error is hidden behind a fake "already running" (issue #8 #7).
- **Fail-closed verification**: when a guard cannot verify success (inbox batch log missing / no filehub), report the failure (`batch-stale` incident), never default to success — a guard that defaults to "changed=true" records fake ok runs (issue #8 #6).
- **Timeout termination**: POSIX timeout must escalate SIGTERM → SIGKILL after a grace window — a harness that ignores SIGTERM otherwise hangs the CLI, the lock is never released, and ~1h later a second run double-executes. `timedOut` is the timer's own flag, not a wall-clock comparison (issue #8 #5).
- **Scheduler external commands are never bare `spawnSync`**: every `crontab`/`schtasks`/`plutil`/`launchctl` call routes through `adapters/scheduler/spawn.ts` (utf-8 + `SCHEDULER_SPAWN_TIMEOUT_MS`) so a hung platform tool degrades to fail-loud / empty-result instead of hanging `cron install`/`cron check` — same red line as gbrain's process spawn (issue #9 #9-04).
- **Health detection is tri-state, not boolean**: a scheduler-probe failure is NOT proof of a fault. `adapters/scheduler/linux.ts health()` returns `LinuxCronHealth` (`crontab`/`service` each `"ok" | "missing"/"stopped" | "unverifiable"`) and `doctor` maps only the confirmed negatives to `warning`; `unverifiable` (PID-namespace / UID-isolated sandbox hides the host state — probe `NSpid:` in `/proc/self/status`, ≥2 values = nested namespace) degrades to `info` (issue #10). This is the counterpart to fail-closed: fail-closed governs **internal guards** (batch log, lock) where "cannot verify" must not fake success; tri-state governs **external host state** where "cannot see" does not mean "broken". Conflating the two re-reports false warnings inside containers/Codex sandboxes.
- **`crontab -l` exit-code grading**: `status 0` → readable (`"ok"`); `status 1` → the legit "no crontab for this uid" state → `"missing"` on a verifiable host (still `warning` + `cron.not_installed` for enabled crons) but `"unverifiable"` under isolation; any other status → `"unverifiable"`. A missing `crontab` binary is a **confirmed** fault (`"missing"`, keep the warning) — never downgrade a confirmed fault to unverifiable.

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
- Lowering a handler exception into a `warning` with no `exitCode` — that still exits 0 and scripts/CI misjudge success. Business/IO failures (write EACCES, read failure) must go to `errors` + `exitCode: 1`; `warnings` is only for non-fatal conditions. A handler `catch` that maps exceptions to warnings is the exact shape that caused issue #8 #9 in three command families (skills/harness/gbrain).
