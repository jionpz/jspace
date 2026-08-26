# Research: Cross-platform harness wiring + CI facts (gbrain-harness-wiring / bootstrap-skill / github-ci-release)

- **Query**: 6 questions on per-OS harness MCP config paths, gbrain binary resolution on Windows, bun official Windows install, GitHub Actions runner matrix (3 OS × 2 arch), Windows-runner jq/find/sort equivalents, and release artifact upload practice.
- **Scope**: external (official docs) + internal (skills references)
- **Date**: 2026-08-02
- **All URLs below verified 2026-08-02** unless noted otherwise.

---

## 1. Per-OS user config paths + platform support for each harness's gbrain MCP wiring

### Claude Code

| Item | Fact | Source |
|---|---|---|
| Native Windows support | **Yes.** Runs natively on Windows 10 1809+ / Windows Server 2019+; also macOS 13.0+, Ubuntu 20.04+, Debian 10+, Alpine 3.19+. Hardware x64 **or ARM64**. Shells: Bash, Zsh, PowerShell, CMD. | code.claude.com/docs/en/installation (System requirements) |
| Windows install | PowerShell: `irm https://claude.ai/install.ps1 \| iex`; CMD: `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`; also WinGet, or `npm install -g @anthropic-ai/claude-code` (npm platforms include `win32-x64`, `win32-arm64`). | installation page |
| MCP config file | User-scope MCP servers stored at **`~/.claude.json`** top-level `mcpServers` (NOT settings.json). Project scope: `.mcp.json`. CLI: `claude mcp add --scope user`. | code.claude.com/docs/en/settings ("What uses scopes" table) + /en/mcp |
| Windows path | Docs: "On Windows, paths shown as `~/.claude` resolve to `%USERPROFILE%\.claude`" → MCP config = **`%USERPROFILE%\.claude.json`**; settings = `%USERPROFILE%\.claude\settings.json`. | settings page |
| stdio command shape on Windows | Governing rule (hooks reference, same exec-form spawn machinery): **on Windows exec form requires `command` to resolve to a real executable such as a `.exe`; `.cmd`/`.bat` shims (npm/npx/eslint in `node_modules/.bin`) are NOT executables and cannot be spawned without a shell** — invoke the underlying script via `"command": "node", "args": [...]` instead. Implication for gbrain: use the absolute path to a real `.exe` (`%USERPROFILE%\.bun\bin\gbrain.exe`). The MCP page itself has no Windows-specific example; this rule is documented in the hooks reference. | code.claude.com/docs/en/hooks ("Shell form / exec form") |
| Hooks / SessionStart on Windows | **Work on Windows.** Hooks run via shell: default `bash` (Git Bash), or `powershell` on Windows when Git Bash isn't installed; `"shell": "powershell"` field available. PowerShell hook pattern: `"command": "powershell.exe", "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "...ps1"]`. MDM on Windows uses registry `HKLM\SOFTWARE\Policies\ClaudeCode` (Settings JSON value). | hooks page |
| Windows local detail | Native Windows recommended over WSL for file-system perf; Git for Windows recommended so Claude Code can use the Bash tool (otherwise PowerShell used as shell tool); env `CLAUDE_CODE_GIT_BASH_PATH` if Git Bash not found. | installation + troubleshooting pages |

### OpenAI Codex CLI

| Item | Fact | Source |
|---|---|---|
| Windows support | **Yes.** "Use Codex on Windows with the native ChatGPT desktop app, the CLI, or the IDE extension." Windows installer: `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"`; also `npm install -g @openai/codex`; standalone binaries per release. Enterprise setups assume `winget` present. | openai/codex README + developers.openai.com/codex/windows |
| Config path | User config = **`~/.codex/config.toml`**; project override `.codex/config.toml` (trusted projects only). `CODEX_HOME` env var overrides the whole state dir, **defaults to `~/.codex`** (on Windows `%USERPROFILE%\.codex`). Config precedence: CLI flags → project `.codex/config.toml` (root→cwd, closest wins) → `~/.codex/profile-name.config.toml` (with `--profile`) → `~/.codex/config.toml` → system `/etc/codex/config.toml`. | developers.openai.com/codex/config-basic / config-advanced |
| Windows path | `~` = `%USERPROFILE%` → **`%USERPROFILE%\.codex\config.toml`**; MCP servers under `[mcp_servers.gbrain]` (stdio `command` + `args`). | config-basic |
| SessionStart hooks on Windows | **Yes — natively supported.** Hooks enabled by default; disable via `[features] hooks = false`. Hook discovery: `~/.codex/hooks.json`, `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml` (all matching hooks load; higher-precedence layers don't replace lower ones). **`commandWindows` is an optional Windows-only command override** (TOML: `command_windows` or `commandWindows`) — use it to give a Windows-specific hook command on a shared hooks.json. SessionStart matcher `startup|resume`; stdout JSON `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`. | developers.openai.com/codex/hooks |

### Cursor

| Item | Fact | Source |
|---|---|---|
| mcp.json locations | User-level **`~/.cursor/mcp.json`** and project-level **`.cursor/mcp.json`** (project overrides user). Cursor is a native Electron app on Windows. | local `skills/harness-config/references/harnesses.md` (verified vs official docs 2026-08-02) + cursor.com/docs/mcp |
| Windows paths | `~` = `%USERPROFILE%` → **`%USERPROFILE%\.cursor\mcp.json`**; project `.cursor\mcp.json`. | inferred (same `~` convention as above) |
| Interpolation | Supports `${env:VAR}`, `${userHome}`, `${workspaceFolder}` in mcp.json values. | harness-config reference |
| stdio command shape on Windows | Must be a real executable path (general MCP/Node stdio spawn rule, same as Claude Code exec form); gbrain.exe absolute path is the safe form. | general MCP behavior |
| Session injection | Rules (`.cursor/rules/*.mdc`, project-level) auto-load at session start; user-level rules are UI-only (Settings → Customize → Rules, no user-level rule file). Hooks: `~/.cursor/hooks.json` `sessionStart` → `{"additional_context":"..."}`. | harness-config reference |
| Caveat | cursor.com/docs primary pages are client-side-rendered; could not scrape current text directly (raw `.md`/`.txt`/`llms.txt`, Jina reader all returned SPA shell). Facts above come from the harness-config reference (checked against official docs today) + verified general behavior. No Windows-specific contradiction found. | — |

### Summary table

| Harness | User-level gbrain MCP file (POSIX) | Windows path | Native Win support | SessionStart on Win |
|---|---|---|---|---|
| Claude Code | `~/.claude.json` → `mcpServers.gbrain` | `%USERPROFILE%\.claude.json` | ✅ (Win10 1809+/Server 2019+, x64+arm64) | ✅ hooks (Git Bash or powershell.exe) |
| Codex | `~/.codex/config.toml` → `[mcp_servers.gbrain]` | `%USERPROFILE%\.codex\config.toml` | ✅ (CLI native; `CODEX_HOME` override) | ✅ hooks, incl. `commandWindows` override |
| Cursor | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` | ✅ (Electron) | Rules + `~/.cursor/hooks.json` sessionStart |

---

## 2. gbrain binary resolution on Windows

- **`which` vs `where`**: POSIX `which gbrain` / `command -v gbrain`; Windows = **`where gbrain`** (where.exe; also PowerShell `Get-Command gbrain`). PRD R2.1 already says "`which`/`where`" — on Windows use `where`.
- **bun global install on Windows puts a real `.exe` shim in the bin dir.** From bun source `src/install/bin.rs`: on Windows bun writes a **real PE shim executable** at `abs_dest + ".exe"` (`create_windows_shim` → `windows_shim::embedded_executable_data()`), plus a `.bunx` companion. On POSIX it creates a symlink. So `bun install -g gbrain` on Windows yields **`%USERPROFILE%\.bun\bin\gbrain.exe`** (a real executable — satisfies the harness exec-form rule, no `.cmd` shim problem).
- **Global bin dir resolution order** (bun source `src/install/PackageManager/PackageManagerOptions.rs::open_global_bin_dir`): `$BUN_INSTALL_BIN` → `--global-bin-dir` CLI option → `$BUN_INSTALL/bin` → `$XDG_CACHE_HOME/.bun/bin` or `$HOME/.bun/bin`.
- **HOME on Windows** = `USERPROFILE` (bun source `src/bun_core/env_var.rs`: `platform_specific_new!(pub HOME: string, posix = "HOME", windows = "USERPROFILE")`). So the `$HOME/.bun/bin` fallback on Windows resolves to `%USERPROFILE%\.bun\bin`.
- **Fallback absolute path if not on PATH**: Windows = **`%USERPROFILE%\.bun\bin\gbrain.exe`** (with `.exe` — required for direct spawn). macOS/Linux = `~/.bun/bin/gbrain` (no extension). There is no `.cmd`/`.bat`; it's the real shim `.exe`.
- **Is gbrain on PATH?** Only if `~/.bun/bin` is on the user's PATH. The bun PowerShell installer adds `%USERPROFILE%\.bun\bin` to the **user** PATH by default (unless `-NoPathUpdate`); the POSIX installer appends `~/.bun/bin` to the shell rc. PATH changes only take effect in new shells; GUI/IDE-launched (non-login) shells often miss it → **always use the absolute path for MCP `command`, never rely on PATH** (harness-config reference already recommends absolute path).

---

## 3. bun official install on Windows

- Official command (bun docs `installation.mdx`): **`powershell -c "irm bun.sh/install.ps1|iex"`**. Pinned-version variant: `iex "& {$(irm https://bun.com/install.ps1)} -Version 1.3.3"`. (Note: bun.sh now redirects to bun.com; both `bun.sh/install.ps1` and `bun.com/install.ps1` serve the script.)
- **Windows requirements**: Windows 10 **1809 / Server 2019 (build 17763) or newer**; x64 (AMD64) or ARM64 only (script exits otherwise). Bun README: "Bun supports Linux (x64 & arm64), macOS (x64 & Apple Silicon), and Windows (x64 & arm64)."
- **Per-user install, no admin required.** Installs under `%USERPROFILE%\.bun`; binary `%USERPROFILE%\.bun\bin\bun.exe`.
- **Execution-policy caveat**: the official command carries no `-ExecutionPolicy Bypass` flag. `irm | iex` executes the script content in-session, which runs even under the default `Restricted` policy (Restricted blocks saved `.ps1` files, not piped content). If a machine policy blocks `Invoke-Expression`/downloads, it fails; the Codex installer precedent uses `powershell -ExecutionPolicy ByPass -c "irm ... | iex"` — same pattern can be applied if needed. No admin elevation is mentioned anywhere in the script.
- **install.ps1 switches**: `-Version`, `-ForceBaseline`, `-NoPathUpdate` (skip PATH edit), `-NoRegisterInstallation`, `-NoCompletions`, `-DownloadWithoutCurl`.
- **Governance note (repo red line)**: the existing bootstrap `curl -fsSL https://bun.sh/install | bash` must become platform-split — Windows official PowerShell, POSIX official script — and the endpoint marked as reviewed (official bun.sh/bun.com). Uninstall on Windows: `powershell -c ~\.bun\uninstall.ps1`.

---

## 4. GitHub Actions runner matrix (3 OS × 2 arch), current 2026-08-02

Authoritative: `docs.github.com/en/actions/reference/runners/github-hosted-runners` (Supported runners and hardware resources) + `actions/runner-images` README.

**Standard (2-core / 4-core tiers), architecture + label:**

| OS | Arch | Workflow labels | Status |
|---|---|---|---|
| Linux | x64 | `ubuntu-latest` (=24.04), `ubuntu-24.04`, `ubuntu-22.04` | GA |
| Linux | arm64 | `ubuntu-24.04-arm`, `ubuntu-22.04-arm` | GA |
| Linux | arm64 | `ubuntu-26.04-arm` | **Public preview** |
| Windows | x64 | `windows-latest` (=Server 2025), `windows-2025`, `windows-2025-vs2026`, `windows-2022` | GA |
| Windows | arm64 | `windows-11-arm`, `windows-11-vs2026-arm` | **Public preview** (per docs.github.com reference table) |
| macOS | arm64 | `macos-latest` (=26 arm64), `macos-26`, `macos-15` | GA |
| macOS | arm64 | `macos-14` | **Deprecated** (issue actions/runner-images#13518) |
| macOS | x64/Intel | `macos-26-intel`, `macos-15-intel` | GA |

**Concrete x64+arm64 matrix per OS (all GA labels):**
- Linux: `ubuntu-latest` (x64) + `ubuntu-24.04-arm` (arm64)
- macOS: `macos-15-intel` (x64) + `macos-15` (arm64) — or `macos-latest` (arm64) for the single default
- Windows: `windows-latest` (x64) + `windows-11-arm` (arm64, **public preview** — gate with `continue-on-error` or exclude if preview instability is a risk)

**Key answers:**
- **macOS arm64 runner: GA** — `macos-latest`/`macos-14`/`macos-15`/`macos-26` are all arm64 and generally available. `macos-13` no longer exists in the current matrix (retired; x64 macs are now `macos-15-intel`/`macos-26-intel`).
- **Windows arm64 runner: Public preview** (`windows-11-arm`), per the docs.github.com reference table. (The runner-images README row for `windows-11-arm` shows no preview badge while `windows-11-vs2026-arm` does — treat windows arm64 as preview.)
- arm64 macOS limitations: GitHub-provided actions compatible; community actions may need manual install; no static UUID/UDID; no nested virtualization.

**Cross-compile alternative (relevant to github-ci-release):** `bun build --compile` supports **cross-compilation via `--target=`** from any host, with targets: `bun-linux-x64(-baseline|-modern|-musl)`, `bun-linux-arm64(-musl)`, `bun-darwin-x64(-baseline)`, `bun-darwin-arm64`, `bun-windows-x64(-baseline|-modern)`, `bun-windows-arm64`. Windows-target outfiles get `.exe` appended automatically. So a single ubuntu matrix job could emit all platform binaries, or the matrix can build natively per-OS (native = fewer surprises with native deps; cross = faster matrix). Pure-stdlib TS CLI cross-compiles cleanly. Source: bun docs `bundler/executables.mdx`.

---

## 5. Windows GitHub Actions runners: jq / find / sort

- **jq: preinstalled on Windows runners.** `windows-2025` image: `jq 1.8.1`; `windows-2022` image: `jq 1.8.1`. Also preinstalled on Ubuntu 24.04 (1.8.2) and macOS 15 (1.7). (An earlier draft claim "Windows runner 未预装 jq" is **incorrect for GH-hosted runners** — but jq is still absent on a typical user's local Windows machine, which matters for bootstrap-skill's local Phase-4 smoke.)
- **find / sort (POSIX):** not native to CMD/PowerShell, but the Windows runner images ship **Git Bash (Bash 5.3)** via Git for Windows, which includes GNU `find`/`sort`/`grep` etc. On the runner, Git-Bash-invoked `find`/`sort` work.
- **Cross-platform equivalents for a native PowerShell session (local Windows, and CI `shell: pwsh`):**
  - `jq . hub.json` → `python -m json.tool hub.json` (Python 3.12 preinstalled on runner), or PowerShell `Get-Content hub.json | ConvertFrom-Json`, or `node -e "JSON.parse(require('fs').readFileSync('hub.json'))"`.
  - `find workspace -maxdepth 2 -type f | sort` → PowerShell `Get-ChildItem workspace -Recurse -Depth 2 -File | Sort-Object FullName` (note: `-Depth` requires PowerShell 5.0+; `-File` PS 3.0+).
  - `where gbrain` instead of `which`; `Get-Command gbrain` also works in PowerShell.
  - Git-Bash shell (`shell: bash` on windows runners) keeps the POSIX smoke commands working verbatim since Git for Windows includes findutils.
- Other preinstalled Windows-runner facts: Git 2.55.0.windows.3, Node 22.23.1, Python 3.12.10, PowerShell 7.6.3 (`pwsh`), GitHub CLI 2.96.0, Chocolatey, 7zip, CMake.

---

## 6. Release artifact upload from a matrix job (recommended practice)

Two established patterns; both need `permissions: contents: write` on the workflow (or job).

**Pattern A — collect then release (recommended for matrices):**
1. Build matrix jobs each upload artifacts: `actions/upload-artifact@v4` with `name: jspace-${{ matrix.os }}-${{ matrix.arch }}`, `path: dist/...`.
2. A single `release` job (`needs: build`, `runs-on: ubuntu-latest`, `if: startsWith(github.ref, 'refs/tags/')`) runs `actions/download-artifact@v4` with `merge-multiple: true` into one dir, then `softprops/action-gh-release@v3` with `files: <dir>/**` + `generate_release_notes: true`. One uploader = no race; release is created once.

**Pattern B — each matrix job uploads directly:** every job runs `softprops/action-gh-release@v3` with `files:` (newline-delimited globs) and `if: github.ref_type == 'tag'`. If a tag already has a release, **the existing release is updated** with the new assets (no overwrite clash for distinct names; same-name assets are replaced). Windows globs accept both `\` and `/`. Slight race risk if two jobs upload simultaneously to a brand-new tag; usually fine.

**gh CLI alternative** (preinstalled on all runner images): `gh release create <tag> <files>...` on the first job and `gh release upload <tag> <files>... --clobber` on subsequent ones; `--clobber` deletes and re-uploads same-name assets (note: if the upload fails, the original assets are lost). Asset display labels via `file#label`.

**Asset naming convention:** `jspace-<os>-<arch>[.exe]`, e.g. `jspace-linux-x64`, `jspace-linux-arm64`, `jspace-darwin-x64`, `jspace-darwin-arm64`, `jspace-windows-x64.exe`, `jspace-windows-arm64.exe`. Derive from the runner matrix (`matrix.os`/`matrix.arch`) or from `bun build --compile --target` output. Also ship `SHASUMS.txt` (sha256sum) as an asset. Trigger docs: gate on `github.ref_type == 'tag'` or `workflow_dispatch`; tag convention `v*`.

---

## Local files inspected (internal scope)

| File Path | Relevance |
|---|---|
| `skills/jspace-bootstrap/SKILL.md` | Phase 0 (bun/python/git install commands, POSIX-only), Phase 4 smoke (`jq . hub.json`, `find workspace -maxdepth 2 -type f \| sort`) — the exact lines needing Windows variants |
| `skills/jspace-bootstrap/references/harnesses.md` | `<gbrain>` resolution `$GBRAIN_BIN → command -v gbrain → ~/.bun/bin/gbrain`; per-harness MCP JSON/TOML shapes |
| `skills/jspace-bootstrap/references/gbrain.md` | Binary resolution order, `gbrain serve` stdio, doctor/models commands |
| `skills/jspace-bootstrap/references/registry.md` | hub.json v3 validation + `jq` manual-fallback commands |
| `skills/harness-config/references/harnesses.md` | Deep per-harness wiring (verified 2026-08-02): `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, hooks configs; symlink caveat on Windows (admin/developer mode) |
| `skills/harness-config/scripts/detect.sh` | harness detection (POSIX shell) |
| `.trellis/tasks/08-02-cross-platform-migration/prd.md` | Task requirements R1–R4 + acceptance criteria |

## External references (all fetched/verified 2026-08-02)

- Claude Code: `code.claude.com/docs/en/settings` · `/en/mcp` · `/en/hooks` · `/en/installation` · `/en/troubleshooting`
- Codex: `github.com/openai/codex` (README) · `developers.openai.com/codex/config-basic` · `config-advanced` · `/codex/hooks` · `/codex/windows`
- Cursor: `docs.cursor.com/docs/mcp` (SPA; see caveat) + local harness-config reference
- bun: `bun.sh/docs/installation` (via `docs/installation.mdx` in oven-sh/bun) · `docs/pm/cli/install.mdx` · `docs/bundler/executables.mdx` · `bun.sh/install.ps1` · source `src/install/bin.rs`, `src/install/PackageManager/PackageManagerOptions.rs`, `src/bun_core/env_var.rs`
- GitHub Actions: `docs.github.com/en/actions/reference/runners/github-hosted-runners` · `docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners` · `github.com/actions/runner-images` (README + `images/windows/Windows2025-Readme.md`, `Windows2022-Readme.md`, `images/ubuntu/Ubuntu2404-Readme.md`, `images/macos/macos-15-Readme.md`) · `cli.github.com/manual/gh_release_upload`
- `softprops/action-gh-release` README (v3)

## Caveats / Not Found

- Cursor primary docs are fully client-side rendered; direct scraping (raw `.md`/`.txt`/`llms.txt`, Jina reader) returned only the SPA shell. Cursor facts rest on the harness-config reference (itself verified against official docs on 2026-08-02) + documented general MCP behavior; no Windows contradiction was found.
- Claude Code MCP docs do not contain an explicit "Windows stdio command" paragraph; the exec-form `.exe` rule is documented in the hooks reference (same process-spawn machinery family). Treat the `.exe`-absolute-path guidance as the safe rule.
- `macos-14` is now deprecated (still functional, arm64); `macos-13` is retired and absent from the current runner matrix — do not use it in the new CI workflow.
- Windows arm64 runner status is "Public preview" per the docs.github.com reference table; the runner-images README badge for `windows-11-arm` shows no preview marker while `windows-11-vs2026-arm` does — plan for preview-grade availability (e.g., `continue-on-error` or exclude).
- jq is preinstalled on GH-hosted Windows runners (so CI smoke can keep using jq), but NOT on a typical local Windows machine — bootstrap-skill still needs the PowerShell/`python -m json.tool` alternative for local Phase-4 smoke.
