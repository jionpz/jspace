# Database Guidelines

> Database patterns and conventions for this project.

## Overview

**N/A — JSpace has no local database.** There is no ORM, no migration runner, and no SQL in this repo.

- The workbench's persistent layer is **structured JSON files** under `.jspace/state/` (typed contracts + decoders; see `error-handling.md` for the diagnostics pattern and `quality-guidelines.md` for the version/ownership discipline that plays the role of schema migration).
- **gbrain** is an external system (PGLite + knowledge graph runs in its own process); JSpace never reads/writes gbrain's store directly — it calls the gbrain CLI/MCP and records its own identity/call-discipline/journal/compensation/pending-recovery in JSON state.

## Query Patterns

n/a — no database queries. Read/write of state files uses `adapters/fs/workbench-state.ts` (atomic writes) or direct `node:fs` for the state repositories.

## Migrations

- Schema evolution is handled by **contract versioning** (`version` / `schema_version` + `*.version.unsupported` decode failures) and the workspace upgrade journal — there is no SQL migration channel.
- Portable hub/local/marker schemas bump version with explicit migration, never silent field addition.

## Naming Conventions

- State files: `.jspace/state/<area>/<id>.json`; generated manifests: `cli/*.generated.ts`.
- Typed contracts: `core/contracts/<name>.ts` + `decode<Name>`.

## Common Mistakes

- Assuming gbrain's PGLite is reachable/queryable from JSpace code — it is external; JSpace stages pending writes on lock conflict instead.
- Treating `.jspace/` JSON as a "database" with ad-hoc reads instead of typed decoders.
