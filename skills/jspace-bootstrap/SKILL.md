---
name: jspace-bootstrap
description: "Configure a fresh JSpace workbench after at least one AI harness (Pi, Claude Code, Codex, or Cursor) is already installed - the user picks which one to use: installs the gbrain unified memory base (PGLite + knowledge graph + local embedding), verifies the domain/resource registry, and wires the chosen harness via MCP/CLI with session-start retrieval injection and work-end write-back. hermes is optional (mentioned for awareness, not proactively promoted). Use when the user asks to initialize/set up/configure a JSpace workbench for the first time, when the registry looks broken, when gbrain is missing or unwired, or when starting a fresh environment."
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

Auto-install missing tooling; do not stop to ask (分平台命令):

1. `bun` - if missing (needed to install/upgrade gbrain):
   - macOS / Linux: `curl -fsSL https://bun.sh/install | bash`
   - Windows: `powershell -c "irm bun.sh/install.ps1 | iex"`
   - ⚠️ 治理红线:两者均为 bun 官方安装脚本,属 `curl | bash` 一类;**执行前先核验来源与内容**(bun.sh 官方),不盲跑未审查脚本。
2. `git` - if missing, install via the platform package manager(Windows: `winget install Git.Git`)。

Verify after installs: `bun --version`。

## Phase 1 - Install gbrain (first core)

1. Resolve the binary: `$GBRAIN_BIN` -> `which gbrain`(Windows `where gbrain`) -> `~/.bun/bin/gbrain`(Windows `%USERPROFILE%\.bun\bin\gbrain.exe`).
2. If missing: `bun install -g gbrain`, then `gbrain upgrade`.
3. If `~/.gbrain`(Windows `%USERPROFILE%\.gbrain`) is absent: `gbrain init` (defaults to PGLite, no server).
4. `gbrain doctor --json` - check brain, resolver, embeddings; fix what it reports.
5. Embeddings are a **default-required config** — Chinese recall depends on semantic search (tsvector does not tokenize CJK). **默认(零外部账号):本地 Ollama bge-m3**(offline,见 `skills/jspace-bootstrap/references/gbrain.md`);可选提升:SiliconFlow bge-m3(在线,需 API key)。If no embedding is reachable, bootstrap must still succeed: writes use `embed_skip: true` (never fail a write because embedding is down), and retrieval degrades to keyword search with a clear notice (ingest-side policy: `skills/asset-ingest/references/gbrain-write.md`).
6. Recommended AI config (ask the user; never force): **默认本地 Ollama bge-m3**;可选提升 = SiliconFlow embedding + chat-parity-with-harness scheme from `skills/jspace-bootstrap/references/gbrain.md` (Recommended AI configuration). Needs a SiliconFlow API key; chat parity additionally needs a local proxy running (user-environment specific). Skip entirely if the user declines or has no key.
7. Smoke test, then clean up (no probe pages left behind):

```bash
printf '---\ntype: smoke\nembed_skip: true\n---\nbootstrap probe\n' | gbrain put smoke/bootstrap
gbrain get smoke/bootstrap
gbrain delete smoke/bootstrap
gbrain list -n 10   # no smoke pages remain
```

Frontmatter schema and offline policy: `skills/jspace-bootstrap/references/gbrain.md`.

## Phase 2 - Registry health

The workbench has no standalone CLI inside itself; validation lives in the JSpace CLI: `jspace doctor --dir .`(`jspace` 为编译二进制,需在 PATH 上;源码检出则 `bun run cli/main.ts`)。`.jspace/hub.json` must stay valid JSON; repair drift only with explanation. Never invent domains/resources.

1. `jq .jspace/hub.json` parses(Windows 无 jq → PowerShell `Get-Content .jspace/hub.json | ConvertFrom-Json`)。
2. Every `domains[]` folder exists and contains `README.md` + `domain.json`; the `domain.json` id matches both the folder name and `.jspace/hub.json`.
3. Every resource with path entrypoints has exactly one primary path entrypoint; missing external paths are warnings, not blocking errors.
4. Domain/resource ids are globally unique; every resource `domain` references a registered domain.

Schema and drift rules: `skills/jspace-bootstrap/references/registry.md`.

## Phase 3 - File center (文件中心/资产层)

The asset layer is a separate folder (`filehub`) for heavy files (pdf/ppt/excel/md). Ask the user which root to use — **first choice = Obsidian folder**, then local dir / cloud-dir / **skip for now**. Structure is pure md + relative links (Obsidian is a view, not a system): no `.obsidian/` config is written.

1. **Ask the user (offer options, one decision)**: ① Obsidian 文件夹(默认第一选择:已有的 vault 或新目录)② 本地普通目录 ③ 网盘同步目录 ④ 暂不配置。
2. **If Obsidian**: recognize an existing vault (`test -d <root>/.obsidian`) or a new folder that can be opened as a vault; explain the Obsidian compatibility conventions are already in the filehub root `README.md` (Obsidian Sync option, wikilink, frontmatter discipline) — no plugin / private format, no `.obsidian` written by us.
3. **Register**: `jspace filehub init <root> --register`(`jspace` 为编译二进制,需在 PATH 上;源码检出则 `bun run cli/main.ts`)。Creates the skeleton and registers `type: filehub` (auto-creates the `files` domain).
4. **Skip for now**: explicitly tell the user that asset-ingest falls back to the degraded staging area (`../<workbench>-inbox/`) until a filehub is registered — they can register later with the command above.

> **首配验收(端到端)**:not "everything configured" — put one real file into `<root>/_inbox/` and run `整理一下 inbox` once, confirming 入库→gbrain 页→中文召回 round trip. This is the acceptance for first-use.

## Phase 4 - Harness wiring (MCP/CLI)

Four session harnesses are supported: **Pi, Claude Code, Codex, Cursor**. Ask the user which one they will use (or detect it); wire that one. Each harness reads/writes the same gbrain store over MCP/CLI. gbrain CLI/MCP is the interface - do not add a JSpace wrapper around it:

| Harness | Config location | Wire |
| --- | --- | --- |
| Pi | MCP or CLI | gbrain reachable at least via CLI |
| Claude Code | `~/.claude.json` | `mcpServers.gbrain` with `command: <gbrain>, args: [serve], type: stdio` |
| Codex | `~/.codex/config.toml` | `[mcp_servers.gbrain]` stdio `gbrain serve`; hooks `features.hooks = true` for session-start injection |
| Cursor | `~/.cursor/mcp.json` (user) or `.cursor/mcp.json` (project) | `mcpServers.gbrain` with `command: <gbrain>, args: [serve]` |
| hermes (optional) | `~/.hermes/config.yaml` | gbrain MCP server entry - mention only, do not proactively set up |

hermes is optional: hint that it exists for autonomous/cron/multi-endpoint use, but do not promote or install it unless the user asks.

> Windows 注意:上表为 macOS/Linux 路径;Windows 下各 harness 的 config 路径与 stdio MCP command 全路径写法见 `skills/jspace-bootstrap/references/harnesses.md` 的"跨平台路径速查"表。

Verify the chosen wiring and confirm the session-start retrieval-injection and work-end write-back flows (see `skills/jspace-bootstrap/references/harnesses.md`).

AI provider/model/proxy config is user-environment specific and outside this workbench's defaults; if the user has a management tool or local proxy, manage it via a registered resource in `.jspace/hub.json`.

## Phase 5 - Final smoke and sign-off

```bash
# 校验(编译二进制在 PATH 时用 jspace;源码检出则 bun run cli/main.ts)
jspace doctor --dir .
# .jspace/hub.json 合法 JSON(POSIX: jq;Windows: ConvertFrom-Json)
jq .jspace/hub.json
# 列出工作区文件(POSIX: find|sort;Windows: Get-ChildItem)
find workspace -maxdepth 2 -type f | sort
gbrain doctor --fast
```

Windows 等价(如适用):`Get-ChildItem -Path workspace -Recurse -Depth 1 -File | Sort-Object FullName`。

Report: configured / already-OK / missing-deferred items (e.g., Ollama offline, chosen harness not fully wired). Explain any registry or domain-file repairs.

> **Note — skill updates and existing workbenches.** New workbench skills added to the dev repo (e.g. `asset-ingest`) are only copied into workbenches by `jspace init`; an **existing live workbench does not get them retrofitted**. To pick them up: re-run `jspace init --force .` (clobbers local skill edits) or copy the skill manually. If a freshly generated workbench lacks a skill you expected, first check whether you are inside an old workbench.
