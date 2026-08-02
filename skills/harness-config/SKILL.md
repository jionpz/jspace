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
> **符号**:`$SKILL_DIR` = 本 skill 当前所在目录(含 SKILL.md);`<gbrain>` = gbrain 二进制路径,按 `$GBRAIN_BIN` → `command -v gbrain` → `~/.bun/bin/gbrain` 解析。

## Phase 0 - Detect installed harnesses

Run the bundled detector; it outputs one TSV row per harness (`harness<TAB>binary<TAB>config_dir<TAB>state`):

```bash
bash "$SKILL_DIR/scripts/detect.sh"
# 安装后: bash "$HOME/.agents/skills/harness-config/scripts/detect.sh"
```

- `state = installed`:binary 在 PATH,可接线。
- `state = config_only`:无 binary 但有配置目录或 GUI 应用。对 Pi/Codex/Claude Code 通常是残留配置;对 **Cursor** 常是"GUI 已装但 CLI 未在 PATH(未启用 shell integration)"。都不是"已卸载",向用户确认后决定接线方式。
- `state = not_found`:未安装,接线时跳过。
- detect.sh 尊重配置目录环境变量(`PI_CODING_AGENT_DIR` / `CODEX_HOME` / `CLAUDE_CONFIG_DIR`)。已装但从未运行的 harness 可能尚无配置目录(`installed` 仍成立,接线需先 `mkdir -p` 父目录)。

**前提**:至少一个 harness 为 `installed`;否则提示用户先安装 harness 再运行本 skill。

## Phase 1 - Install/upgrade this skill

Install (idempotent) to user root, alongside the governance doc:

```bash
SKILL_DIR="<this skill's directory, e.g. repo skills/harness-config/>"   # 源
DEST="$HOME/.agents/skills/harness-config"
mkdir -p "$DEST"
# 幂等:补缺本 skill 自己的文件;同名且本地已改过的既有文件不静默覆盖
rsync -a --ignore-existing "$SKILL_DIR"/. "$DEST/" 2>/dev/null || cp -Rn "$SKILL_DIR"/. "$DEST/"
# 列出与源不一致的既有文件(可能含你改过的本地文件),确认后决定是否更新
diff -rq "$SKILL_DIR" "$DEST" | grep -v '^Only in' || true
```

Verify: `ls "$DEST/SKILL.md" "$DEST/scripts/detect.sh" "$DEST/references/"`.

## Phase 2 - Create / maintain the governance document

`~/.agents/agents.md`(用户根目录)是 **所有 harness 的单一事实源**,只放 harness 无关规则。

- 若不存在:用 `references/governance.md` 的骨架模板创建,引导用户填写红线 / 规范 / 工作台入口。
- 若已存在:review 内容分层(放 harness 无关规则;MCP/hooks/注入不放),并确认**安全红线为最高优先级**(见 governance.md)。
- 记忆在 gbrain,规则在此文档;工作台 `AGENTS.md` 是路由层,本文件不重复其细节。
- **本文件不放任何密钥/令牌**;敏感配置一律走密钥管理/环境变量。

## Phase 3 - Wire installed harnesses' global files

对 Phase 0 检测为 `installed` 的每个 harness,按 `references/harnesses.md` 对应节接线(全局文件 → `~/.agents/agents.md`)。各节提供**幂等、带守卫**的接线命令,自动处理:父目录不存在、已接线、空 stub、非空既有文件、Codex `AGENTS.override.md`。

- Pi / Codex / Claude Code:symlink(Claude Code 备选 `@import`);接线前 `mkdir -p` 父目录。
- **Cursor**:文件式规则是**项目级**(`<project>/.cursor/rules/*.mdc`),用户级无规则文件——用项目级指针 `.mdc`,或把指针规则粘贴进 Cursor UI User Rules(详见 harnesses.md)。
- **跳过** `not_found`;`config_only` 的 harness 向用户确认后决定接线或跳过。
- **不覆盖**非空既有全局文件:内容并入治理文档,或保留原文件 + 附加接线,二选一并向用户说明。
- 逐 harness 报告:**wired / skipped / already-OK**。

## Phase 4 - Recommended config check(read-only)

对每个已接线 harness,按 `references/harnesses.md` 核对推荐会话级配置:gbrain MCP/CLI、session-start 注入、hooks。输出三态 **wired / missing / n/a**。

- **只核对报告,不修改既有配置**(gbrain MCP 写入由 bootstrap 负责)。
- **密钥卫生**:只报告 server 名称与状态;不回显/复制 `~/.claude.json` 的 oauth/令牌字段、`auth.json`、`config.toml` 的 env 值。
- missing 项列入报告,由用户决定是否另行处理。

## Phase 5 - Verify and report

```bash
ls -la "$HOME/.agents/agents.md"
ls -la "$HOME/.pi/agent/AGENTS.md" "$HOME/.codex/AGENTS.md" "$HOME/.claude/CLAUDE.md"   # symlink -> $HOME/.agents/agents.md
# Cursor(已装时):确认 <project>/.cursor/rules/ 下指针规则存在,或 Cursor UI User Rules 已含指针规则
```

- 对 Claude Code 做 **内容层** 验证:新会话 `/context` 确认治理文档出现在 Memory files(symlink 跟随为官方文档化行为;`/rewind` 不恢复 symlink 文件,与读取无关)。
- 其余 harness 文件层验证即可。
- 输出报告,两维词汇区分清楚:
  - **接线状态**(Phase 3):`wired / skipped / already-OK`
  - **配置核对状态**(Phase 4):`wired / missing / n/a`
  - 含跳过原因与 Phase 4 的 missing 项。
