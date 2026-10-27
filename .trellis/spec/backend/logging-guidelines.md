# Logging Guidelines

> How logging is done in this project. Core principle: **structured state is machine truth; prose logs are human payload**. No third-party logging library — the CLI writes files/JSON directly.

## Overview

- Machine state lives in `.jspace/state/` (gitignored, structured JSON): `runs/`, `incidents/`, `ingest/`, `pending/`, `locks/`, `upgrades/`, `materialized.json`.
- Human-readable payloads live in `.jspace/logs/cron/<id>/` (prose markdown). Note this directory also holds operational files (locks like `cron.<id>.lock`, backups) — only `state/` is the sole home of machine truth.
- Filehub-side logs: `<filehub>/.jspace-logs/inbox-batch.md` (batch execution log — the asset-ingest skill writes it and cron/doctor read the same path). Pending gbrain envelopes live in `<workbench>/.jspace/state/pending/<id>.APPLY.json`.
- Recovery / idempotency / compensation decisions are made from the structured state, never from prose.

## Log Levels

No leveled logger. Distinctions are by channel, not severity prefix:

| Channel | Purpose |
|---|---|
| `CmdResult.lines` | human stdout (or `--json` data) |
| `CmdResult.errors` / `warnings` | stderr diagnostics (doctor/upgrade) |
| `.jspace/state/*.json` | machine truth (runs, incidents, ingest journals, envelopes, upgrade journals) |
| `.jspace/logs/cron/<id>/*.md` | prose run payload for a human to read |

## Structured Logging

- Each structured record is a typed contract with a decoder (`core/contracts/*`), strict unknown-field, and a `version`/`schema_version` field.
- Identifiers are UUIDs; timestamps use a local `YYYY-MM-DDTHHmmss` stamp (kept simple, no TZ conversion — see `localStamp()`).
- A failed step records `failedStep` + `failureReason`; compensation is recorded as state, not just prose.
- `RunRecord` carries optional `reason` + `durationSec` (both additive; legacy records decode unchanged). `cron status` / `cron failures` read them for the "why" and the budget overrun; recovery decisions still use `status`, never the prose log.
- **A failure `reason` must name the fixable layer.** `system_sleep` exists because a suspended host produces the same observable symptom as a hung upstream (`Request timed out.`, a run that eats its whole budget) but a different fix: the idle-sleep guard / the closed lid, not the provider. Precedence is `stalled` > `system_sleep` > `timeout` — a sleep failure always also times out, so any later position makes the reason unreachable. It is **partial by construction** (the harness must notice the suspension), so never present it as a complete detector. Triage order: transcript gap width vs `pmset -g log` sleep windows first, upstream second.
- `prevent_sleep: unavailable` is logged only when the guard was wanted but could not be armed; the run then proceeded unprotected, which is a fact the next reader needs. `armed` is the normal case and stays unlogged.

## What to Log

- Every cron run (`RunRecord`), incident open/resolve/ack, ingest journal step, pending envelope status change, and workspace upgrade journal.
- The inbox batch execution summary (time, counts, per-file results) to `<filehub>/.jspace-logs/inbox-batch.md`.

## What NOT to Log

- **Secrets/tokens/provider credentials** — never written to logs, state, or diagnostics output (parent R8). Credentials live only in the host's provider-config tool / env / keychain.
- Absolute machine paths that belong in `.jspace/local.json` must not leak into portable state.
- Probe/smoke pages must be cleaned up (no residue).

## Common Mistakes

- Using prose to make recovery decisions — read the structured state instead.
- Writing machine truth into a markdown file (the sole exception is `inbox-batch.md`, a human/agent execution log, never used for recovery decisions).
- Two paths for the same log (skill writes A, cron reads B) — the unified batch-log contract test guards this.
