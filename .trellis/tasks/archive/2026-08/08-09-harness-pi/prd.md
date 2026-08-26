# P4: Pi 支持（插件通道 + 诚实边界）

## Goal

Pi 从「只有 argv.ts 的 `pi -p`」扩展为**有真实接入通道**：识别并提示安装 `pi-mcp-adapter` 扩展（stdio MCP 接 gbrain）、capabilities.yaml 如实标注 Pi 能力、harness-pi.md 写清安装路径与能力边界、doctor 对 Pi 用户提示。诚实标边界 > 假装支持（父任务 D4 变更）。

父任务：`08-09-multi-harness-support`。依赖：P1（capabilities.yaml + pi adapter 骨架）。

## Confirmed Facts（已核实）

- Pi core **无内置 MCP**（`skills/harness-config/references/harnesses.md:68`：settings.json 无 mcp/mcpServers 键）
- gbrain 接入两路（`:69-73`）：① CLI（`gbrain put/get/query/list`）② 扩展 `pi-mcp-adapter`：`pi install npm:pi-mcp-adapter` + 配置 mcpServers（stdio command+args），配置优先级 6 级：`~/.config/mcp/mcp.json` > `~/.agents/mcp.json` > `~/.agents/mcp/mcp.json` > `~/.pi/agent/mcp.json` > `.mcp.json` > `.pi/mcp.json`
- **供应链注意**（`:72`）：`npm:pi-mcp-adapter` 安装即执行包代码，提示安装时必须含核对包来源/README 提醒
- Pi 会话注入靠 `SYSTEM.md`/`APPEND_SYSTEM.md`（`:77`）+ `session_start` / `before_agent_start` 扩展事件（`:78`）；**无** Claude 风格 hooks.json（`:80`）
- Pi headless = `pi -p`；skills 目录含 `~/.agents/skills/`（`:86`）

## Requirements

- **R1** `capabilities.yaml` pi 条目如实标注（P1 已按 D4 终值定义，本任务核验对齐）：`headless: ["pi","-p"]`、`mcp: via: pi_mcp_adapter`（第三方扩展通道，非原生）、`sessions: [session_start, before_agent_start]`（**source: extension**，注明未实测待验证）、`user_install: [~/.agents/skills]`（用户级路径，P1 已拆 `user_install`）、`hook_format: none`（无 Claude 风格 hooks）
- **R2** 新增 `skills/jspace-use/references/harness-pi.md`：
  - 第一段写清当前支持面：cron 无头 `harness: pi` + gbrain 接入两路
  - **提示安装**：`pi install npm:pi-mcp-adapter` + 6 级配置优先级 + gbrain MCP stdio 配置示例 + **供应链核对提醒**（先看包来源/README 再装）
  - 能力边界诚实：无 hooks.json，会话注入靠 SYSTEM.md/APPEND_SYSTEM.md + 扩展事件；无自动 session-start context 注入（需手动 `jspace context session-start --plain`）
- **R3** `adapters/harness/pi.ts`（P1 落骨架）只实现 headlessArgv；hook 文件 no-op
- **R4** `application/diagnostics/doctor.ts` checkHarness 的 Pi 分支：报告 `wired(CLI 可用) / missing(CLI 不可用)` + 提示可安装 pi-mcp-adapter，**行内带供应链警告**（「手动安装；装前核对包来源/README，详见 harness-pi.md」）；不修改既有配置

## Acceptance Criteria

- [ ] AC1 `capabilities.yaml` pi 条目含 `via_pi_mcp_adapter` 标注与扩展事件 sessions，与真实能力一致（不虚报）
- [ ] AC2 `harness-pi.md` 含：安装命令 `pi install npm:pi-mcp-adapter` + 配置优先级 + 供应链核对提醒 + 边界说明
- [ ] AC3 doctor 对 Pi 用户输出边界清晰文案（wired/missing + 安装提示 + **行内供应链警告**），不假装 hook 生效
- [ ] AC4 `bunx tsc --noEmit` + `bun test` 全过
- [ ] AC5 `jspace cron run <cron> --harness pi --dry-run` 可组装 argv（回归不变）

## Out of Scope

- 自动安装 pi-mcp-adapter（红线：npm 安装即执行，需用户确认后自行执行）
- 制造不存在的 hook 支持（`hook_format: none` 如实）
