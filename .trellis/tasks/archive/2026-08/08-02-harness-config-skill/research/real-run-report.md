# harness-config 实跑报告(2026-08-02)

## 检测(detect.sh)
- pi: installed — `/Users/jionpz/.nvm/versions/node/v24.14.1/bin/pi`
- claude: installed — `/Users/jionpz/.nvm/versions/node/v24.14.1/bin/claude`
- codex: installed — `/Users/jionpz/.nvm/versions/node/v24.14.1/bin/codex`
- cursor: not_found(未安装)

## 治理文档
- `~/.agents/agents.md` 已创建(骨架模板 + JSpace 实际事实:定位/安全红线/默认中文/工作台路由/维护约定)

## skill 安装
- 源 `skills/harness-config/` → `~/.agents/skills/harness-config/`(SKILL.md + references/ + scripts/ 共 4 文件)
- 已安装 skill 自包含可用:detect.sh 从安装目录独立运行正常

## 接线(wired / skipped)
| Harness | 入口 | 处置 | 结果 |
|---|---|---|---|
| Pi | `~/.pi/agent/AGENTS.md` | 原本不存在 → symlink | ✅ wired |
| Codex | `~/.codex/AGENTS.md` | 0 字节 stub(研究确认 Codex 视为 no-op、从不自建)→ 删除后 symlink | ✅ wired |
| Claude Code | `~/.claude/CLAUDE.md` | 原本不存在 → symlink | ✅ wired,内容层验证通过 |
| Cursor | — | 未安装 | ⏭️ skipped |

3 个 symlink 均 → `~/.agents/agents.md`,`ls -la` + readlink + head 验证通过。

## Claude Code 内容层验证
- 无头新会话 `claude -p` 确认加载 `~/.claude/CLAUDE.md`(symlink),引用首标题 `# 全局治理文档(用户根目录 ~/.agents)` → **内容层生效,无需 @import 备选**

## gbrain MCP 只读核对(wired / missing / n/a)
- gbrain binary: gbrain 0.42.71.0(`~/.bun/bin/gbrain`)
- Claude Code: **wired**(`~/.claude.json` mcpServers 含 context7/playwright/gbrain)
- Codex: **missing**(config.toml 有 mcp_servers 但无 gbrain 条目);CLI 可用
- Pi: **n/a**(研究确认 Pi 核心无内置 MCP);gbrain CLI 可用;`pi-mcp-adapter` 未装(可选)
- 按边界**未修改任何既有 MCP 配置**

## 质量检查
- grep `myhub|hub-dev|hub doctor` → clean
- grep `jionpz|/Users/` → clean(自包含,无硬编码路径)
- 研究产物 4 份(research/claude-code.md、codex.md、pi.md、cursor.md),harnesses.md 每节标注来源

## 跳过项 / 备注
- Cursor:未安装,接线跳过;harnesses.md 按研究记录真实机制(用户规则在 UI、文件式 rules 为项目级)
- 相对 prd 假设的两处事实修正(研究结论优先):① Pi 无内置 MCP;② Cursor 用户级无规则文件
