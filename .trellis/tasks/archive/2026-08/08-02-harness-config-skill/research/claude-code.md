# Claude Code — config research (2026-08-02)

Research date: 2026-08-02. All findings verified against official docs fetched today from code.claude.com/docs (Claude Code docs).

## 全局文件(CLAUDE.md/AGENTS.md)

Claude Code reads **CLAUDE.md**, NOT `AGENTS.md` directly. `AGENTS.md` is only loaded when explicitly imported via `@AGENTS.md` or symlinked.

Supported memory files and load order (broadest → most specific):

| Scope | Location | Purpose |
|---|---|---|
| Managed policy | macOS: `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL: `/etc/claude-code/CLAUDE.md`; Windows: `C:\Program Files\ClaudeCode\CLAUDE.md` | Org-wide instructions, cannot be excluded |
| User instructions | **`~/.claude/CLAUDE.md`** | Personal preferences for all projects |
| Project instructions | `./CLAUDE.md` or `./.claude/CLAUDE.md` | Team-shared, checked into source control |
| Local instructions | `./CLAUDE.local.md` | Personal project-specific; gitignore it |

Key facts:
- Claude Code walks up the directory tree from cwd loading every `CLAUDE.md` / `CLAUDE.local.md` found; all are concatenated (filesystem root first, working dir last). `CLAUDE.local.md` is appended after `CLAUDE.md` within each directory.
- `AGENTS.md` quote: "Claude Code reads `CLAUDE.md`, not `AGENTS.md`. If your repository already uses `AGENTS.md` for other coding agents, create a `CLAUDE.md` that imports it... Claude loads the imported file at session start, then appends the rest." Example: `@AGENTS.md` at top of CLAUDE.md.
- Recommended size < 200 lines per file; content is context, not enforced config (enforcement = PreToolUse hooks / settings).
- User-level personal rules also load from `~/.claude/rules/*.md` (loaded before project rules).
- `claudeMdExcludes` setting (any settings layer) can exclude CLAUDE.md by path/glob.

Source: https://code.claude.com/docs/en/memory.md

## @import

**Supported.** Syntax: `@path/to/import` anywhere in a CLAUDE.md / memory file.

- Relative AND absolute paths allowed. **Relative paths resolve relative to the file containing the import, not the working directory.**
- `~` expansion works: docs example `- @~/.claude/my-project-instructions.md` (import from home directory).
- Imports are recursive, max depth **four hops**.
- Import parsing skips Markdown code spans and fenced code blocks. To mention a path literally, wrap in backticks: `` `@README` ``.
- Imports load into context at launch (organization aid; does NOT save context).
- **Glob support: NOT documented for @import.** Official docs describe imports as single file paths only (relative/absolute, `~` expansion, recursion). The only wildcard/glob matching documented for memory files is in `.claude/rules/` YAML `paths:` frontmatter and in the `claudeMdExcludes` setting.
- External-import approval: an import in a project-level memory file whose path resolves OUTSIDE the working directory (e.g. home-dir import) shows an approval dialog the first time. Imports in user-scope memory files (`~/.claude/CLAUDE.md`, `~/.claude/rules/`) load without a dialog.

Source: https://code.claude.com/docs/en/memory.md

## symlink 跟随

**Yes — Claude Code follows symlinks for CLAUDE.md/AGENTS.md.**

- Explicit example in docs: `ln -s AGENTS.md CLAUDE.md` "A symlink also works if you don't need to add Claude-specific content... In your next session, run `/context` and confirm `CLAUDE.md` appears under **Memory files**." This is the documented alternative to `@AGENTS.md` import.
- `.claude/rules/` directory also supports symlinks: "Symlinks are resolved and loaded normally, and circular symlinks are detected and handled gracefully." Example: `ln -s ~/shared-claude-rules .claude/rules/shared`.
- Windows caveat: "On Windows, creating a symlink requires Administrator privileges or Developer Mode, so use the `@AGENTS.md` import instead."
- Path-scoped rule matching also works through a symlinked checkout (since v2.1.198): "matching also works when Claude reaches a file through a symlinked path to the project directory, for example in a symlinked checkout."

**Documented caveats (not loading, but related):**
- Checkpointing does NOT restore symlinked or hard-linked files: `/rewind` "skips any tracked path that is a symlink or hard link and shows a `Restored the code, but skipped N files` warning." Config files a dotfile manager symlinks into a project fall into this category.
- A user-configured MCP server defined at top-level of `~/.claude.json` is used over a same-named server in `.mcp.json` (scope precedence), which matters for symlinked repos.

Sources:
- https://code.claude.com/docs/en/memory.md
- https://code.claude.com/docs/en/checkpointing.md

## MCP 配置

**Current location for a user-level MCP server: `claude mcp add --scope user` → stored in `~/.claude.json` under the top-level `mcpServers` key.** NOT in `settings.json`.

- `~/.claude.json` is the home-directory config file (OAuth session, MCP configs for user + local scopes, per-project state). On Windows: `%USERPROFILE%\.claude.json`. Overridden by `CLAUDE_CONFIG_DIR`.
- Scopes:
  - `local` (default): private to you, current project only. Stored in `~/.claude.json` under that project's path. Note: local MCP scope ≠ local settings scope (`settings.local.json`).
  - `project`: shared via `.mcp.json` at project root (requires per-user approval on first use).
  - `user`: private to you, all projects. Stored in `~/.claude.json` top-level `mcpServers`.
- Scope precedence (highest → lowest): local → project → user → plugin-provided → claude.ai connectors. Whole entry wins; fields not merged.
- JSON shape (user scope):
```json
{
  "mcpServers": {
    "hubspot": {
      "type": "http",
      "url": "https://mcp.hubspot.com/anthropic"
    }
  }
}
```
- stdio shape: `"type": "stdio"`, `"command": "...", "args": [...], "env": {...}`. `type` also accepts `sse` (deprecated) and `ws`. A `url` with no `type` is a config error.
- Settings.json does NOT host server definitions: settings page states "Other configuration is stored in `~/.claude.json`. This file contains your OAuth session, MCP server configurations for user and local scopes..." The settings `mcpServers`-adjacent keys are approvals/restrictions: `enabledMcpjsonServers`, `disabledMcpjsonServers`, `enableAllProjectMcpServers`, `allowedMcpServers`, `deniedMcpServers`, `disableClaudeAiConnectors`.
- Files that are NOT read: `~/.claude/.mcp.json`, `~/.claude/config/mcp.json`, `~/.claude/mcp.json`, `%APPDATA%\Claude\mcp.json`.
- Related commands: `claude mcp add-json <name> '<json>' --scope user`, `claude mcp add-from-claude-desktop --scope user`, `claude mcp list` / `get` / `remove`, `/mcp` in-session. OAuth login: `claude mcp login <name>`.

Sources:
- https://code.claude.com/docs/en/mcp.md (scopes table, JSON shapes)
- https://code.claude.com/docs/en/mcp-quickstart.md (disk locations table)
- https://code.claude.com/docs/en/settings.md (settings files; no mcpServers key in settings.json)

## SessionStart hooks / 注入

**Supported.** `SessionStart` runs when Claude Code starts a new session or resumes an existing one. Only `type: "command"` and `type: "mcp_tool"` handlers are supported for SessionStart.

- Configured in settings files under the `hooks` key — e.g. user level `~/.claude/settings.json`, plus `.claude/settings.json`, `.claude/settings.local.json`, managed policy settings, plugins, or skill/agent frontmatter.
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/load-context.sh",
            "args": []
          }
        ]
      }
    ]
  }
}
```
- Matchers filter by how the session was initiated: `startup` (new), `resume` (--resume/--continue//resume), `clear` (/clear), `compact` (auto/manual), `fork` (--fork-session with resume/continue, /fork, /branch).
- Input: JSON on stdin (command) / POST body (HTTP), fields include `session_id`, `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`. Only SessionStart hooks may receive a `model` field (not guaranteed).
- Injecting context: exit 0 and print JSON to stdout:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "This file is generated. Edit src/schema.ts and run `bun generate` instead."
  }
}
```
  - Claude Code wraps the string in a system reminder and inserts it at the start of the conversation, before the first prompt. Write factual statements, not imperatives (imperative framing can trigger prompt-injection defenses).
  - SessionStart is context-only: no blocking/decision control. Exit 2 shows stderr to user only, cannot block session start.
  - Also accepts `initialUserMessage`, `watchPaths`, `sessionTitle`, `reloadSkills` alongside `additionalContext`.
  - Injected text is saved to the transcript; on resume the hook re-runs with source `"resume"` (or `"fork"`), so it can refresh context.
- Keep hooks fast: they run on every session, including resumes and compactions.

Source: https://code.claude.com/docs/en/hooks.md

## 治理相关推荐设置(permission modes)

- Modes (Shift+Tab cycle in CLI): `default` (Manual; reads only) → `acceptEdits` (auto-approves file edits + common fs commands) → `plan` (research, no edits until plan approved). Optional: `auto` (classifier-gated autonomous; requires recent model, e.g. Sonnet 4.6+/Opus 4.6+/Sonnet 5 on some providers), `dontAsk` (only pre-approved tools; never prompts — for CI), `bypassPermissions` (everything, isolated VMs/containers only).
- Set default mode in settings: `"permissions": { "defaultMode": "acceptEdits" }`. `defaultMode: "auto"` is honored ONLY from user/managed settings (`~/.claude/settings.json`); ignored from project/local settings since v2.1.142 (repo can't grant itself auto).
- Managed-policy governance keys: `permissions.disableAutoMode: "disable"`, `permissions.disableBypassPermissionsMode: "disable"`, `permissions.deny`, `sandbox.enabled`, `env`, `forceLoginMethod` / `forceLoginOrgUUID`, `claudeMd` (managed CLAUDE.md content inline), managed `managed-mcp.json` for fixed MCP sets.
- Protected paths (`.git`, `.claude`, shell rc files, `.mcp.json`, `.claude.json`, etc.) are never auto-approved except in `bypassPermissions`; `permissions.allow` rules do NOT override protected-path checks.
- `dontAsk` + allow rules + PreToolUse hook approvals = locked-down governance for CI/scripts.
- Settings precedence: managed (highest) → CLI args → local → project → user (lowest). Permission rules merge across scopes rather than override.

Sources:
- https://code.claude.com/docs/en/permission-modes.md
- https://code.claude.com/docs/en/settings.md

## 来源汇总
- https://code.claude.com/docs/en/memory.md — CLAUDE.md/AGENTS.md files, load order, @import syntax (relative/absolute/~, depth 4, no glob), symlink support (`ln -s AGENTS.md CLAUDE.md`), `.claude/rules/` symlinks, external-import approval dialog
- https://code.claude.com/docs/en/mcp.md — MCP reference: scopes (local/project/user), storage locations, `~/.claude.json` JSON shapes, `claude mcp add --scope user`, scope precedence
- https://code.claude.com/docs/en/mcp-quickstart.md — where servers are saved on disk (`~/.claude.json` top-level `mcpServers` for user scope; `.mcp.json` for project), files NOT read
- https://code.claude.com/docs/en/settings.md — settings files + precedence, settings.json does NOT hold MCP server definitions, MCP approval/restriction keys
- https://code.claude.com/docs/en/hooks.md — SessionStart event, configuration shape, matchers, hookSpecificOutput.additionalContext injection JSON
- https://code.claude.com/docs/en/permission-modes.md — mode table (default/acceptEdits/plan/auto/dontAsk/bypassPermissions), defaultMode setting, protected paths, managed-policy disable keys
- https://code.claude.com/docs/en/checkpointing.md — caveat: symlinked/hard-linked paths not restored by `/rewind`
