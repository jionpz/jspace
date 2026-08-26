# gbrain 二进制解析 + harness MCP 接线跨平台 — 执行计划

**子任务**:08-02-gbrain-harness-wiring | **父**:08-02-cross-platform-migration

## 顺序依赖
- 平台事实以父任务 `research/harness-ci-facts.md` 为准(已定稿)。

## 执行清单 ✅
- [x] 依据 research 定稿"三平台 × 每 harness"事实表:
  - Claude Code:config 路径(`~/.claude.json` / Windows `%USERPROFILE%\.claude.json`)、Windows 原生支持、stdio MCP command 全路径
  - Codex CLI:config 路径(`~/.codex/config.toml` / Windows `%USERPROFILE%\.codex\config.toml`)、官方 Windows 安装器、hooks 同款
  - Cursor:mcp.json user/project 路径(`~/.cursor/mcp.json` / Windows `%USERPROFILE%\.cursor\mcp.json`)
- [x] gbrain 二进制解析顺序文档化:`$GBRAIN_BIN` → `which`(posix)/`where`(win) → `~/.bun/bin/gbrain[.exe]`;Windows `.exe` 规则。
- [x] `skills/harness-config/references/harnesses.md`:补"跨平台(Windows)路径速查"表 + 每 harness Windows 说明,移除裸 POSIX 假设。
- [x] `skills/jspace-bootstrap/references/harnesses.md`:补"跨平台路径速查"表 + Windows stdio command 注意。
- [x] `skills/jspace-bootstrap/references/gbrain.md` + SKILL.md Phase 1:gbrain 解析补 Windows `where`/`.exe`。
- [x] `~/.agents/agents.md`:核验无需同步(治理文档不含 POSIX 专属路径/命令,接线细节已指针到已更新的 harness-config 文档)。
- [x] 记录各 harness Windows 可用性结论(均原生支持;hooks ⏳ 归 CI 验证,已在 research 标注)。

## 验证
- 文档三平台视角通读无歧义;grep 确认 Windows 说明覆盖各 harness 与 gbrain 解析。
- Windows/Linux 实际 wiring 走查归 github-ci-release 的 CI 冒烟 + bootstrap-skill 跨平台文档。

## 评审门 / 回滚
- 纯文档+验证变更,低风险;无改动 `~/.agents/agents.md`。

## 参考
- 父 design 4.2、`research/harness-ci-facts.md`。
