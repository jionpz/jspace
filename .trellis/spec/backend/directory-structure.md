# Directory Structure

> How backend code is organized in this project. This documents the **actual** layout and dependency rules so sub-agents and new members align on where logic lives and what may import what.

## Overview

JSpace is a single-repo TypeScript/bun CLI that generates and validates JWorkspaces (workbenches). There is no framework and no monorepo packages — layers are directories with a fixed dependency direction.

## Directory Layout

```
core/contracts/      # pure typed contracts + decoders (side-effect-free)
core/registry/       # effective-registry merge + layered inspection
adapters/            # base tool layer: filesystem, harness argv (no CLI, no app deps)
application/         # use cases: business logic, CommandSpec framework, CmdResult
  commands/command.ts
  workspace/  automation/  registry/  ingest/  pending/
cli/                 # CommandSpec tree + main entry + generated assets + cron/update
scripts/             # build-time: gen-assets / gen-version / build-all
skills/ + skills-manifest.json   # official skills (manifest is the packaging source of truth)
templates/           # workbench / filehub templates (embedded into the binary)
```

### Skill embedding: two maps, one rule (issue #37)

`skills-manifest.json` declares two scopes, and gen-assets embeds them into **two separate generated maps**:

- `workbench` → `cli/assets.generated.ts` (`ASSETS`) — materialized into every workbench (`.jspace/skills/<name>/` + harness projections) via `materializedRels`, which maps **every** `skills/…` key in `ASSETS` to workbench paths.
- `global` → `cli/global-skills.generated.ts` (`GLOBAL_SKILLS`) — machine-level skills (e.g. `harness-config`), installed only to the per-machine `~/.agents/skills/<name>/` by `skills install` and refreshed by `workspace upgrade` (union view in `cli/commands/skills.ts` `embeddedSkillAssets`).

**The rule**: global-scope skill content must never enter `ASSETS`. Workbench materialization machinery (`materializedRels` / `materializeTree` / `diffBundle`) reads only `ASSETS`, so keeping the maps separate is what structurally guarantees a global skill can never leak into a workbench — do not "unify" the maps, and do not add scope-aware branches to the materialization path. Global entries declare `install_path` (their machine target; contract-required) and `assets-reachability.test.ts` asserts the invariant.

## Workbench Layout (generated)

`jspace init` generates the workbench with a **placement principle: entry faces live at the root, everything else under `.jspace/`**. Root holds only the files harnesses/humans auto-discover — `AGENTS.md` (a JSpace-managed block inside the user's file: `<!-- JSPACE:START -->…<!-- JSPACE:END -->`, block managed by init/upgrade, everything outside owned by the user), `README.md`, `.gitignore`, `.claude/settings.json`. All other official assets live under `.jspace/`: official skills at `.jspace/skills/` (root `skills/` is user-owned), user data (`hub.json`, `cron.json`), machine state (`marker.json`, `local.json`, `logs/`, `state/`). The directory position encodes ownership, so upgrade behavior is readable from the tree without per-file explanations.

## Module Organization

| Layer | Responsibility | May import | Must NOT import |
|---|---|---|---|
| `core/contracts` | typed schemas + decoders (diagnostics pattern) | `core/*` only | application, adapters, cli |
| `core/registry` | merge portable+local, classify invalid/unbound/missing/drift | `core/*` | application, adapters, cli |
| `core/shared` | shared kernel: `errors` (CliError/fail), `fs` (isFile), `schedule` (parseSchedule) | `core/*` (no app/adapter/cli logic) | application, adapters, cli |
| `adapters` | platform/tool specifics (atomic fs writes, harness argv, scheduler) | `core/*` (incl. `core/shared`) | application, cli |
| `application` | use cases, CommandSpec, CmdResult | `core`, `adapters`, `application` | `cli` (non-test) |
| `cli` | declarative CommandSpec tree, entry, generated assets, cron/update | everything | — |

`adapters/` is a **base tool layer** consumed by both `application` and `cli` — it is not "on top of cli". The primitives both layers need (`fail`/`CliError`, `isFile`, `parseSchedule`) live in the shared kernel `core/shared/`; there are **no reverse edges** from adapters/core into application. The layer directions are enforced by the automated `import-boundary.test.ts` gate (runs with `bun test`).

### Transition state (accurate, not idealised)

- Platform scheduler install (launchd / crontab / schtasks) is implemented in `adapters/scheduler/{darwin,linux,win32}.ts` with workbench-tagged task identity (`com.jspace.cron.<tag>.<id>` / `JSpaceCron_<tag>_<id>`). `application/automation/scheduler-service.ts` is the single cron installer (desired compilation + Linux whole-block batching + reconciliation); `cli/commands/registry.ts` only composes adapter + env and validates skill targets. Schedule parsing (`parseSchedule`/`ScheduleDict`) lives in `core/shared/schedule.ts`, shared by the adapters and re-exported by `application/automation/definitions.ts`. The cron status/failures/check surface lives in `application/automation/status.ts` (returns `CmdResult`, exit 1 when anything needs attention, incl. damaged state records); `cli/cron.ts` keeps only `jspaceBinary` (binary/path resolution). `update` still lives in `cli/update.ts`.

## Naming Conventions

- Files: kebab-case (`workbench-state.ts`, `filehub-lookup.ts`).
- Test files: `*.test.ts` beside the module.
- CommandSpec: one file per command family in `cli/commands/registry.ts` (single CommandSpec tree); handlers bind to `application/*/use-cases.ts`.
- Generated assets: `cli/*.generated.ts` (assets / manifest / skills / version) — never edited by hand, regenerated by `scripts/gen-*.ts`.

## Examples

- A typed contract: `core/contracts/ingest.ts` (`IngestJournalV1` + `decodeIngestJournal`, diagnostics pattern).
- A use case: `application/ingest/use-cases.ts` (`ingestBegin` returns `CmdResult`).
- Command wiring: `cli/commands/registry.ts` `ingestSpec` family.
