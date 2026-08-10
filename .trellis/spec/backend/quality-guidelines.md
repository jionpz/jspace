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

- **CommandSpec single source**: every command's name/aliases/options/positionals/help/handler come from one `CommandSpec` in `cli/commands/registry.ts`; handlers bind to `application/*/use-cases.ts`. Repeatable options (`repeatable: true`) need an explicit `dest` when the handler reads a plural key — without it the parser emits the singular key (`--tag` → `args.tag`) and the handler reading `args.tags` silently gets `undefined` (tags never persisted, exit 0; issue #8 #2).
- **`--dir` is the workbench root convention** for every command (feature `dir: true`); `init` also accepts a legacy positional target for backward compatibility — both together is an ambiguous error (exit 2). Do not add new positional-path commands.
- **Version string contract** (`scripts/gen-version.ts`): non-release builds carry the commit delta via `git describe --tags` (e.g. `1.0.9-2-g7cef2bc`) so `--version` distinguishes a tag-point build from leading commits — do NOT re-add `--abbrev=0` (it reintroduces binary/source drift). Release builds are overwritten to the clean tag by `JSPACE_BUILD_VERSION` (CI). `compareVersions` parses `[.+-]`-separated leading numerics, so suffixed versions compare equal to their tag.
- **Typed contract first**: any new schema gets `core/contracts/<name>.ts` (decoder, diagnostics pattern) + round-trip tests before use cases consume it.
- **Contract version discipline**: each contract carries `version`/`schema_version`; unsupported versions fail with `*.version.unsupported`; internal schema changes bump the version with an explicit migration, never silently.
- **Incremental ownership model** (parent R4/AC5): bundle files carry `AssetOwnership` in three tiers — `seed` (user-customizable templates: README/.gitignore/.claude settings + bundled skills), `user` (`.jspace/` data such as hub.json/cron.json; upgrade never overwrites them, schema evolution goes through migration), and `managed` (reserved force-replace class, currently unused). `diffBundle` produces `create / no-op / update / conflict / skip / stale / remove / migrate / block-update` (`remove` = a recorded copy no longer in the bundle, unmodified, cleaned up on upgrade; `migrate` = hub schema migration; `block-update` = AGENTS.md JSPACE block refreshed, user content outside the block preserved); `materialized.json` is the last-applied base; `workspace upgrade` writes a plan + journal + rollback snapshot under `.jspace/state/upgrades/<id>/`. Locally-modified skills are never force-overwritten (reported as conflict).
- **Mixed DI**: selected ports are injected (generated manifests, journal, readFile, skill context, clock) by the cli layer; filesystem goes through `adapters/fs` directly. `application` stays free of `cli` imports.
- **Structured diagnostics**: `doctor`/`inspect` classify invalid / unbound / missing / drift with distinct codes and severities — never collapsed.

## Security & Red Lines (parent R8)

- Secrets/tokens/provider credentials never appear in logs, state, or diagnostics output.
- Bootstrap never default-executes remote pipe installs (`curl|bash` / `irm|iex`): download to a temp file, show source/checksum, require explicit user confirmation.
- Automated tests never mutate real home harness config, real scheduler, real gbrain store, or real filehub — always temp fixtures + injected stubs.
- gbrain is an external system; JSpace does not bypass its serve lock (conflicts are staged as pending envelopes).
- **Path-bounded destructive ops**: every unlink is confined to its owning root (filehub/workspace). Ingest validates the source lives in `<filehub>/_inbox` at `begin` AND re-checks a (possibly tampered) journal path at every unlink; `--rollback` ids are UUIDs and journal rel paths pass `portabilityIssues` (issues #8 #4/#15).
- **Shell/cmd injection**: `.cmd/.bat` spawn targets escape every arg for cmd (`"`→`""`, wrap in quotes so `& | < > ^ % !` stay literal); the crontab writer rejects newline/CR/NUL and its parser is symmetric with the writer (unshq restores `'\''` and `\%`) (issues #8 #3/#12).

## Testing Requirements

- Gates: `bunx tsc --noEmit` + `bun test` must stay green (currently 360 tests across 46 files).
- New function → unit test; bug fix → regression test; changed behavior → update existing tests.
- Fault-injection via injected deps (ingest journal fs ops, pending envelope gbrain stub).
- Contract round-trip + decode-issue tests for every decoder.
- Scheduler behavior: pure `planReconciliation` tests + argv round-trip through the real parser; no real scheduler apply in tests.
- Regression tests call the real production path under test (public adapter methods, parse the actual output) — never hand-craft the internal payload with the expected values baked in. A test that assembles `schtasksArgs(...)`/`JSON.stringify` by hand stays green while the shipped method (`buildContent`) emits a mismatched task handle → false-green masked a Windows cron bug (issue #8 #1).

## Code Review Checklist

- [ ] tsc + tests green; generated assets fresh (`git diff --exit-code cli/*.generated.ts`).
- [ ] application layer has no `cli` import (non-test).
- [ ] New/edited schema uses the diagnostics decoder with strict unknown-field + version.
- [ ] Command surface added only via CommandSpec (no duplicate help/parse).
- [ ] No secrets/logs-in-state regression (R8).
- [ ] No real-environment mutation in tests.
