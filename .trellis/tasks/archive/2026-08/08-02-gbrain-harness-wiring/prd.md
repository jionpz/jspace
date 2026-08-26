# gbrain 二进制解析 + harness MCP 接线跨平台

## Goal

把 gbrain 二进制解析和 Claude Code / Codex / Cursor 的 MCP 接线从"仅 POSIX"改为 **Windows + macOS + Linux 通用**:二进制解析按平台用 `which`/`where` 与 `.exe` 后缀;harness 配置路径按各平台用户 home 解析;stdio MCP 命令在 Windows 上以可执行形态存在。**父任务:08-02-cross-platform-migration**。

## Background / Decisions

- 全链三平台(owner 拍板),范围含 gbrain 接线。
- 接线信息事实源:`skills/harness-config/references/harnesses.md` 与 `skills/jspace-bootstrap/references/harnesses.md`;本子任务改这两处 + bootstrap skill 的相关段落,并同步 `~/.agents/agents.md` 治理文档若受影响。
- gbrain 二进制解析顺序约定:`$GBRAIN_BIN` → `which`/`where gbrain` → `~/.bun/bin/gbrain[.exe]`。

## Requirements

- R2.1 gbrain 二进制解析跨平台:POSIX 用 `which`/`command -v`;Windows 用 `where`;候选路径按平台补 `.exe`;解析失败时给出明确、分平台的修复提示。
- R2.2 Claude Code:配置 `~/.claude.json`(Windows: `%USERPROFILE%\.claude.json`)内 `mcpServers.gbrain` 的 `command` 在三平台均为可执行形态(Windows 下是真实 exe 路径,不用裸命令名);路径用各平台 home 解析。
- R2.3 Codex CLI:配置 `~/.codex/config.toml`(Windows 路径同理),`[mcp_servers.gbrain]` 与 SessionStart hooks(`features.hooks = true` + `.codex/hooks.json`)在 Windows 上可用;如 Codex 不支持 Windows,记录事实并给出降级说明。
- R2.4 Cursor:`~/.cursor/mcp.json`(user)/`.cursor/mcp.json`(project)的 Windows 路径与 stdio 命令形态。
- R2.5 SessionStart 检索注入 + 工作结束写回两条链路在三平台保持一致的描述与验证方法。
- R2.6 接线文档按平台分列(表格或每平台小节),不再默认 POSIX。

## Acceptance Criteria

- [ ] 接线文档(harness-config + jspace-bootstrap 两处 references)对 Windows/macOS/Linux 分别给出 config 路径、command 形态、hooks 说明,无裸 POSIX 假设。
- [ ] gbrain 解析顺序文档含 Windows `where` 与 `.exe` 规则。
- [ ] 已验证/记录各 harness 在 Windows 的可用性事实(如不可用,有明确降级)。
- [ ] `~/.agents/agents.md` 若涉及路径/命令,已同步为跨平台表述。

## Constraints

- 接线事实以官方文档为准,研究产出持久化到父任务 `research/harness-ci-facts.md`。
- 不改变 gbrain 本身的行为;只改"如何找到它、如何接线"。

## Ordering / Dependencies

- 依赖 `cli-bun-ts` 定下的二进制/路径解析约定(解析逻辑可能复用 CLI 的 home 解析)。
- 可并行于 `bootstrap-skill`。

## Notes

- 参考:父任务 `research/harness-ci-facts.md`(待产出)。
