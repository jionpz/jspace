---
name: harness-config
description: "Configure recommended settings for all installed AI harnesses (Pi, Claude Code, Codex, Cursor): auto-detects which harnesses are installed on this machine, installs/upgrades itself to the user-root global dir, creates the single-source governance document ~/.agents/agents.md (user root, harness-agnostic rules), wires each installed harness's native global file (symlink / @import / .mdc pointer) to that document, cross-checks recommended session-level config (gbrain MCP/CLI, session-start injection, hooks) read-only, and verifies. Use when the user asks to configure harnesses, set up a global governance doc, unify multi-harness entry, or when an installed harness's global context is missing or stale."
triggers:
  - "configure harness"
  - "harness config"
  - "global governance"
  - "multi-harness"
  - "wire harness"
  - "agent memory setup"
---

# harness-config

Configure recommended settings for **all** AI harnesses on this machine, under a single-source governance document. Run phases in order; skip-not-installed harnesses; report a checklist at the end.

> **命名**:所有 `~/.agents` 均指 **用户根目录**(`$HOME/.agents`),与本仓库项目级 `.agents/` 目录是不同位置,勿混淆。

## Phase 0 - Detect installed harnesses

Run the bundled detector; it outputs one TSV row per harness (`harness<TAB>binary<TAB>config_dir<TAB>state`):

```bash
bash "$HOME/.agents/skills/harness-config/scripts/detect.sh"
# 或从当前 skill 所在目录: bash <skill-dir>/scripts/detect.sh
```

- `state = installed`:binary 在 PATH,可接线。
- `state = config_only`:无 binary 但有配置目录(残留),提醒用户确认是否已卸载。
- `state = not_found`:未安装,接线时跳过。

**前提**:至少一个 harness 为 `installed`;否则提示用户先安装 harness 再运行本 skill。

## Phase 1 - Install/upgrade this skill

Install (idempotent) to user root, alongside the governance doc:

```bash
DEST="$HOME/.agents/skills/harness-config"
mkdir -p "$DEST"
# 复制本 skill 目录(源 = 本 skill 当前所在目录,通常为仓库 skills/harness-config/)
# 幂等:同名且内容不同的既有文件(用户可能改过)不静默覆盖,列出差异并询问
cp -R <skill-src>/. "$DEST/"
```

Verify: `ls "$DEST/SKILL.md" "$DEST/scripts/detect.sh" "$DEST/references/"`.

## Phase 2 - Create / maintain the governance document

`~/.agents/agents.md`(用户根目录)是 **所有 harness 的单一事实源**,只放 harness 无关规则。

- 若不存在:用 `references/governance.md` 的骨架模板创建,引导用户填写红线 / 规范 / 工作台入口。
- 若已存在:review 是否仍符合内容分层(放 harness 无关规则;MCP/hooks/注入不放)。
- 记忆在 gbrain,规则在此文档;工作台 `AGENTS.md` 是路由层,本文件不重复其细节。

## Phase 3 - Wire installed harnesses' global files

对 Phase 0 检测为 `installed` 的每个 harness,按 `references/harnesses.md` 对应节接线(全局文件 → `~/.agents/agents.md`):Pi / Codex / Claude Code 用 symlink(Claude Code 备选 `@import`),Cursor 用带 frontmatter 的 .mdc 指针文件。

- **跳过** `not_found` / `config_only` 的 harness。
- **不覆盖**非空既有全局文件:内容并入治理文档,或保留原文件 + 追加 import / 接线行(见 harnesses.md),二选一并向用户说明。
- 空 stub(如 0 字节 `~/.codex/AGENTS.md`)判定无用户数据,可删除后接线。
- 逐 harness 报告:已接线 / 跳过 / 已存在。

## Phase 4 - Recommended config check(read-only)

对每个已接线 harness,按 `references/harnesses.md` 核对推荐会话级配置:gbrain MCP/CLI、session-start 注入、hooks。输出三态 `wired / missing / n/a`。

- **只核对报告,不修改既有配置**(gbrain MCP 写入由 bootstrap 负责)。
- missing 项列入报告,由用户决定是否另行处理。

## Phase 5 - Verify and report

```bash
ls -la "$HOME/.agents/agents.md"
ls -la "$HOME/.pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md" "$HOME/.claude/CLAUDE.md"   # symlink -> $HOME/.agents/agents.md
ls -la "$HOME/.cursor/rules/agents.mdc"                                                  # 未装则跳过
```

- 对 Claude Code 做 **内容层** 验证:新会话 `/context` 或确认 `@import` 已加载治理文档(symlink 跟随行为有版本差异,不生效则改用 `@import` 并记录)。
- 其余 harness 文件层验证即可。
- 输出报告:逐 harness `wired / already-OK / skipped`,含 Phase 4 的 missing 项与任何跳过原因。
