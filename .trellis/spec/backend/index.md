# Backend Development Guidelines

> Best practices for backend development in this project. These are the **actual** conventions — read the guideline files for the enforced gates, patterns, and red lines.

## Overview

JSpace is a single-repo TypeScript/bun CLI that generates and validates JWorkspaces. The backend is organized in strict layers: `core/contracts` (pure typed decoders) → `core/registry` (effective merge + layered inspection) → `adapters` (base fs/harness tools) → `application` (use cases + CommandSpec + CmdResult) → `cli` (CommandSpec tree + generated assets + cron/update). No framework, no monorepo packages.

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module layout and dependency rules | Active |
| [Database Guidelines](./database-guidelines.md) | N/A — no local DB; JSON state + external gbrain | Active |
| [Error Handling](./error-handling.md) | `fail()`/CmdResult, diagnostics decoders, structured diagnostics | Active |
| [Quality Guidelines](./quality-guidelines.md) | Gates, CommandSpec, DI, ownership model, security red lines | Active |
| [Logging Guidelines](./logging-guidelines.md) | Structured state = machine truth; prose = human payload | Active |

## Quick Reference

- **New schema** → `core/contracts/<name>.ts` typed decoder (diagnostics pattern, strict unknown-field, version field) + round-trip tests, before any use case.
- **New command** → CommandSpec in `cli/commands/registry.ts`, handler binds to an `application/*/use-cases.ts`.
- **Application layer** must not import `cli`; injected ports come from the cli wiring.
- **Gates**: `bunx tsc --noEmit`, `bun test`, `gen-assets && git diff --exit-code cli/*.generated.ts`.
- **Never** touch real home config / scheduler / gbrain store / filehub in tests; never log secrets.

**Language**: All documentation in this directory is written in English.
