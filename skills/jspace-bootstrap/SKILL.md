---
name: jspace-bootstrap
description: "Configure a fresh JSpace workbench after at least one AI harness (Pi, Claude Code, Codex, or Cursor) is already installed - the user picks which one to use: auto-installs python3, installs the gbrain unified memory base (PGLite + knowledge graph + local embedding), verifies the domain/resource registry, and wires the chosen harness via MCP/CLI with session-start retrieval injection and work-end write-back. hermes is optional (mentioned for awareness, not proactively promoted). Use when the user asks to initialize/set up/configure a JSpace workbench for the first time, when the registry looks broken, when gbrain is missing or unwired, or when starting a fresh environment."
triggers:
  - "initialize jspace"
  - "setup jspace"
  - "configure jspace"
  - "first-use jspace"
  - "workbench broken"
  - "registry broken"
  - "gbrain missing"
  - "wire gbrain"
  - "fresh environment"
---

# jspace-bootstrap

Bootstrap a fresh JSpace workbench end to end. Run phases in order; never skip a verification step. Report a checklist at the end.

## Phase 0 - Prerequisites

**Assumption: at least one AI harness (Pi, Claude Code, Codex, or Cursor) is already installed and functional.** This skill configures what comes after that: the registry, gbrain memory, and harness wiring. It does not install harnesses.

Auto-install missing tooling; do not stop to ask:

1. `python3` - if missing, install the latest stable 3.x:
   - macOS: `brew install python`
   - Debian/Ubuntu: `sudo apt-get install -y python3`
   - Fedora: `sudo dnf install -y python3`
2. `bun` - if missing (needed to install/upgrade gbrain): `curl -fsSL https://bun.sh/install | bash`
3. `git` - if missing, install via the platform package manager.

Verify after installs: `python3 --version && bun --version`.

## Phase 1 - Install gbrain (first core)

1. Resolve the binary: `$GBRAIN_BIN` -> `which gbrain`(Windows `where gbrain`) -> `~/.bun/bin/gbrain`(Windows `%USERPROFILE%\.bun\bin\gbrain.exe`).
2. If missing: `bun install -g gbrain`, then `gbrain upgrade`.
3. If `~/.gbrain` is absent: `gbrain init` (defaults to PGLite, no server).
4. `gbrain doctor --json` - check brain, resolver, embeddings; fix what it reports.
5. Embeddings are a **default-required config** — Chinese recall depends on semantic search (tsvector does not tokenize CJK). Recommended online option (free): SiliconFlow bge-m3 (see `skills/jspace-bootstrap/references/gbrain.md`); offline fallback: local Ollama bge-m3. If no embedding is reachable, bootstrap must still succeed: writes use `embed_skip: true` (never fail a write because embedding is down), and retrieval degrades to keyword search with a clear notice (ingest-side policy: `skills/asset-ingest/references/gbrain-write.md`).
6. Recommended AI config (ask the user; never force): offer the SiliconFlow embedding + chat-parity-with-harness scheme from `skills/jspace-bootstrap/references/gbrain.md` (Recommended AI configuration). Needs a SiliconFlow API key; chat parity additionally needs the cc-switch local proxy running. Skip entirely if the user declines or has no key.
7. Smoke test, then clean up (no probe pages left behind):

```bash
printf '---\ntype: smoke\nembed_skip: true\n---\nbootstrap probe\n' | gbrain put smoke/bootstrap
gbrain get smoke/bootstrap
gbrain delete smoke/bootstrap
gbrain list -n 10   # no smoke pages remain
```

Frontmatter schema and offline policy: `skills/jspace-bootstrap/references/gbrain.md`.

## Phase 2 - Registry health

The workbench has no standalone CLI inside itself; validation lives in the JSpace dev repo: `__DEV_ROOT__/bin/jspace doctor --dir .`. `hub.json` must stay valid JSON; repair drift only with explanation. Never invent domains/resources.

1. `jq . hub.json` parses.
2. Every `domains[]` folder exists and contains `README.md` + `domain.json`; the `domain.json` id matches both the folder name and `hub.json`.
3. Every resource with path entrypoints has exactly one primary path entrypoint; missing external paths are warnings, not blocking errors.
4. Domain/resource ids are globally unique; every resource `domain` references a registered domain.

Schema and drift rules: `skills/jspace-bootstrap/references/registry.md`.

## Phase 3 - Harness wiring (MCP/CLI)

Four session harnesses are supported: **Pi, Claude Code, Codex, Cursor**. Ask the user which one they will use (or detect it); wire that one. Each harness reads/writes the same gbrain store over MCP/CLI. gbrain CLI/MCP is the interface - do not add a JSpace wrapper around it:

| Harness | Config location | Wire |
| --- | --- | --- |
| Pi | MCP or CLI | gbrain reachable at least via CLI |
| Claude Code | `~/.claude.json` | `mcpServers.gbrain` with `command: <gbrain>, args: [serve], type: stdio` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.gbrain]` stdio `gbrain serve`; hooks `features.hooks = true` for session-start injection |
| Cursor | `~/.cursor/mcp.json` (user) or `.cursor/mcp.json` (project) | `mcpServers.gbrain` with `command: <gbrain>, args: [serve]` |
| hermes (optional) | `~/.hermes/config.yaml` | gbrain MCP server entry - mention only, do not proactively set up |

hermes is optional: hint that it exists for autonomous/cron/multi-endpoint use, but do not promote or install it unless the user asks.

Verify the chosen wiring and confirm the session-start retrieval-injection and work-end write-back flows (see `skills/jspace-bootstrap/references/harnesses.md`).

AI provider/model/proxy config is owned by cc-switch (`/Users/jionpz/.cc-switch`, resource `cc-switch`): read `workspace/agent-infra/README.md` before touching it.

## Phase 4 - Final smoke and sign-off

```bash
__DEV_ROOT__/bin/jspace doctor --dir .
jq . hub.json
find workspace -maxdepth 2 -type f | sort
gbrain doctor --fast
```

Report: configured / already-OK / missing-deferred items (e.g., Ollama offline, chosen harness not fully wired). Explain any registry or domain-file repairs.

> **Note — skill updates and existing workbenches.** New workbench skills added to the dev repo (e.g. `asset-ingest`) are only copied into workbenches by `jspace init`; an **existing live workbench does not get them retrofitted**. To pick them up: re-run `__DEV_ROOT__/bin/jspace init --force .` (clobbers local skill edits) or copy the skill manually. If a freshly generated workbench lacks a skill you expected, first check whether you are inside an old workbench.
