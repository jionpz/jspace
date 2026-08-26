# P4 Design: Pi 插件通道 + 诚实边界

## 架构边界

```
Pi 用户(harness:pi 或手动) ──► harness-pi.md 指引 ──► 二选一
                                    │
                    ┌───────────────┴────────────────┐
              CLI 直连(最简)                   pi-mcp-adapter 扩展
   gbrain put/get/query/list        pi install npm:pi-mcp-adapter
                                    + 6 级 mcp 配置 + gbrain stdio MCP
```

- **诚实边界**：Pi 无 Claude 风格 hooks.json（`hook_format: none`）；会话注入靠 SYSTEM.md/APPEND_SYSTEM.md + 扩展事件；本任务不制造不存在的 hook 支持
- **D4 变更**：从「纯边界文档」扩为「提示安装插件」——接入通道真实存在，写进 capabilities + 文档 + doctor

## 关键设计决策

1. **capabilities.pi 字段（如实标注，P1 已按 D4 终值定义）**：
   - `headless: ["pi", "-p"]`（现状 argv.ts 即有）
   - `mcp: via: pi_mcp_adapter`——区分于 claude/grok/opencode 的 `mcp: native: true`；`via:` 联合显式声明「第三方扩展通道」，P5 断言/文档 render 能识别这种非原生态
   - `sessions: [session_start, before_agent_start]`（扩展事件，需 pi-mcp-adapter 提供）——`source: extension` 标注，非原生 hook，注明未实测待验证
   - `hook_format: none`
   - `user_install: [~/.agents/skills]`（harness-config 已确认 Pi 认 `~/.agents/skills/`；用户级路径，doctor 只做存在性 info）
2. **harness-pi.md 结构**：
   - 支持面：cron 无头 `harness: pi`（argv `pi -p`）+ gbrain 两路接入
   - **安装提示**：`pi install npm:pi-mcp-adapter` + 6 级配置优先级（`~/.config/mcp/mcp.json` > … > `.pi/mcp.json`）+ gbrain MCP stdio 配置示例 + **供应链核对**（npm 安装即执行包代码，装前核对来源/README）
   - 边界：无 hooks.json；无自动 session-start context 注入（需手动 `jspace context session-start --plain`）；收工显式
3. **doctor Pi 分支**：`checkHarness` 遇 pi 时报告 `wired(CLI 可用) / missing(CLI 不可用)` + 提示可装 pi-mcp-adapter + **行内供应链警告**（「手动安装；装前核对包来源/README，详见 harness-pi.md」，对齐红线「未经审查的 npm install 不执行」）；**不修改既有配置**（沿用 harness-config 的核对语义：报告不修复）
4. **供应链红线**：任何地方只「提示安装」，不自动执行 `pi install`（npm 安装即执行代码，需用户确认）

## 数据流

Pi 用户按 harness-pi.md 选 CLI 或扩展 → CLI：会话内直接 `gbrain put/get/query/list`；扩展：pi-mcp-adapter 提供 gbrain stdio MCP → Pi 会话能读写同一 gbrain 库。session-start 注入为手动/文件式（SYSTEM.md），无自动。

## 兼容性 / 迁移

- capabilities.pi 字段调整是纯声明；argv 行为不变
- doctor 新增 Pi 分支是增量检测，不碰既有检查
- 回滚：capabilities 改回 + 删 harness-pi.md + doctor 分支 revert

## 风险 / 权衡

- **pi-mcp-adapter 是第三方、npm 即执行** → 安装提示必须带供应链核对，且只提示不自动装（红线）
- **扩展事件能力未实测**（`session_start` 等是否真能触发）→ capabilities 标注「经扩展」+ harness-pi.md 写「待验证」，不写死自动化保证
