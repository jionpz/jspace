# Quality Guidelines

> Code quality standards for backend development in this project. These are the enforced gates plus the conventions every change must follow.

## Overview

- No linter configured; the enforced gates are `bunx tsc --noEmit`, `bun test`, the `import-boundary.test.ts` layer-direction gate (runs inside `bun test`), and generated-asset freshness (`gen-assets` must be a no-op vs committed).
- Conventions here are the project's actual patterns (CommandSpec single source, diagnostics decoders, DI injection, ownership model, security red lines).

## Forbidden Patterns

- **application imports `cli`** (non-test) — generated manifests/journal/readFile are injected by the cli layer, never imported.
- **Duplicate command surface** — name/options/help/handler must live only in the CommandSpec; no separate `CHOICES` constants, help strings, or parse switches.
- **Loose JSON parsing** — unknown payloads must go through the typed decoder (strict unknown-field), not ad-hoc casts.
- **Writing machine truth to prose** — recovery/idempotency/compensation decisions read structured state only.
- **Silent failure** — `fail()` swallowed into a fake success, or a state-machine illegal transition no-opped.
- **Real-environment mutation in tests** — no touching real home config, real scheduler, real gbrain store, or real filehub in automated tests.
- **Over-claiming automation** — product docs may only say "automatic/保证" for paths with CI/test evidence (parent invariant #7).

## Required Patterns

- **CommandSpec single source**: every command's name/aliases/options/positionals/help/handler come from one `CommandSpec` in `cli/commands/registry.ts`; handlers bind to `application/*/use-cases.ts`.
- **Typed contract first**: any new schema gets `core/contracts/<name>.ts` (decoder, diagnostics pattern) + round-trip tests before use cases consume it.
- **Contract version discipline**: each contract carries `version`/`schema_version`; unsupported versions fail with `*.version.unsupported`; internal schema changes bump the version with an explicit migration, never silently.
- **Incremental ownership model** (parent R4/AC5): bundle files carry `AssetOwnership` (currently all `managed`); `diffBundle` produces `create / no-op / update / conflict / skip / stale / remove / block-update` (`remove` = pristine legacy seed copy cleaned up on upgrade; `block-update` = AGENTS.md JSPACE block refreshed, user content outside the block preserved); `materialized.json` is the last-applied base; `workspace upgrade` writes a plan + journal + rollback snapshot under `.jspace/state/upgrades/<id>/`. Locally-modified skills are never force-overwritten (reported as conflict).
- **Mixed DI**: selected ports are injected (generated manifests, journal, readFile, skill context, clock) by the cli layer; filesystem goes through `adapters/fs` directly. `application` stays free of `cli` imports.
- **Structured diagnostics**: `doctor`/`inspect` classify invalid / unbound / missing / drift with distinct codes and severities — never collapsed.

## Security & Red Lines (parent R8)

- Secrets/tokens/provider credentials never appear in logs, state, or diagnostics output.
- Bootstrap never default-executes remote pipe installs (`curl|bash` / `irm|iex`): download to a temp file, show source/checksum, require explicit user confirmation.
- Automated tests never mutate real home harness config, real scheduler, real gbrain store, or real filehub — always temp fixtures + injected stubs.
- gbrain is an external system; JSpace does not bypass its serve lock (conflicts are staged as pending envelopes).

## Testing Requirements

- Gates: `bunx tsc --noEmit` + `bun test` must stay green (currently 339 tests across 45 files).
- New function → unit test; bug fix → regression test; changed behavior → update existing tests.
- Fault-injection via injected deps (ingest journal fs ops, pending envelope gbrain stub).
- Contract round-trip + decode-issue tests for every decoder.
- Scheduler behavior: pure `planReconciliation` tests + argv round-trip through the real parser; no real scheduler apply in tests.

## Code Review Checklist

- [ ] tsc + tests green; generated assets fresh (`git diff --exit-code cli/*.generated.ts`).
- [ ] application layer has no `cli` import (non-test).
- [ ] New/edited schema uses the diagnostics decoder with strict unknown-field + version.
- [ ] Command surface added only via CommandSpec (no duplicate help/parse).
- [ ] No secrets/logs-in-state regression (R8).
- [ ] No real-environment mutation in tests.
