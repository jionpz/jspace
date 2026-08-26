# Design — Issue #13 剩余自动化缺口

## 背景

当前 main 已完成 issue #12 的统一 wire 五端 + capabilities.yaml + 沙盒 cron 降级。剩余工作围绕 issue #13 中“行为级自动化”与“主动可见性”：
1. Pi session-start hook 物化（wire 只写 MCP，不写 hook/extension 配置）
2. doctor 增加行为级检查（session-start hook 是否真的挂上、briefing 是否在跑、wire 缺口）
3. 首启文档补 cron install 引导
4. `jspace context` / cron check 的 incident banner

## 设计原则

- **capabilities.yaml 仍是单一事实源**：不把 harness 路径/能力散写进各命令。
- **hook 保持薄**：所有端都调用同一个 `jspace context session-start` 契约，wire 只负责把 hook 物化到对应端。
- **hook 永不阻塞会话**：任何写入/检测失败都降级为 info/warning，不影响 `context` 命令 exit 0。
- **不自动安装第三方包**：Pi 的 pi-hooks / pi-mcp-adapter 只提示或写配置，不执行 `pi install`。

## D1：capabilities.yaml 增加 session-start 物化声明

在 `harnesses.*` 下新增可选字段：

```yaml
session_start:
  # 已有 hook/plugin 的端：workbench 相对路径或 machine 路径（~ 展开）
  # 有模板 seed 的端用 workbench_projection 同源；Pi 是机器级配置
  path: "~/.pi/agent/settings.json"   # 或 ".claude/settings.json" 等
  format: json                         # json | toml | file
  key: "hooks.SessionStart"            # json/toml 的写入点；file 不需要
```

具体值：
- claude：`.claude/settings.json`，`json`，`hooks.SessionStart`
- grok：`.grok/hooks/jspace.json`，`json`，`hooks.SessionStart`
- cursor：`.cursor/hooks.json`，`json`，`hooks.sessionStart`
- opencode：`.opencode/plugins/jspace.ts`，`file`
- pi：`~/.pi/agent/extensions/jspace/index.ts`（或 `PI_CODING_AGENT_DIR` 下 `extensions/jspace/index.ts`），`file`，由 Pi 按“目录存在即加载扩展”自动发现

> 已通过 npm/本地源码核实：`pi-hooks` 是若干 Pi 扩展的集合（checkpoint/lsp/permission/...），本身不提供 jspace 的任意命令 hook 配置；Pi 真正的 session-start 自动化入口是 `pi.on("session_start")` / `pi.on("before_agent_start")` / `pi.on("context")` 扩展 API。因此 wire 物化的是**一个 jspace 专用 Pi extension**，而不是给 pi-hooks 写 JSON 配置。

需要同步更新：
- `adapters/harness/types.ts` 增加 `session_start?: { path: string; format: "json" | "toml" | "file"; key?: string }`
- `scripts/gen-assets.ts` 无需改（yaml 原样渲染）
- `scripts/check-harness-consistency.ts` 增加断言：每个 `sessions` 含 session-start 事件的 harness 必须声明 `session_start` 物化路径；模板/文档与其一致

## D2：wire 增加 session-start 物化

`application/harness/wire.ts` 的 `wireHarness` 在现有 MCP 写入后追加 `wireSessionStart(harness, deps, root)`。

行为：
- claude/grok/cursor/opencode：这些 hook/plugin 属于工作台 seed（`templates/workbench/`）。`harness wire` 不直接重写工作台文件，而是：
  - 若对应 seed 已存在且包含 `jspace context session-start` → `already-wired`
  - 若缺失 → 返回 `warning`/`info`：`run jspace workspace upgrade`（保持 upgrade 单一物化入口）
  - dry-run 同样打印计划/缺失
- pi：写机器级 Pi extension 到 `~/.pi/agent/extensions/jspace/index.ts`（合并/备份现有同名目录 + dry-run）：
  - 在 `before_agent_start` 中运行 `jspace context session-start --plain`（cwd = Pi session cwd，8s 超时，失败静默）
  - 在 `context` 事件中把输出作为 user message 注入，或直接返回 `{ systemPrompt: event.systemPrompt + briefing }`
  - 若 `~/.pi/agent/extensions/` 不可写/已有冲突，wire 返回 warning 并说明手动路径
  - 不自动安装任何 npm 包，也不依赖 pi-hooks 包已安装
- 输出中继续打印能力边界；如果某端无法自动物化 session-start，明说“briefing 不可用/需手动”。

新增 `WirePlan` 可包含多个写入路径；CLI `harness wire` 的 dry-run 已支持多 plan。

## D3：briefing 时间状态

新增机器状态文件 `.jspace/state/briefing.json`：

```json
{
  "schema_version": 1,
  "last_session_start_at": "2026-08-17T13:20:00+08:00",
  "session_count": 12
}
```

- 由 `cli/commands/context.ts` 的 `session-start` handler 在成功渲染后 best-effort 写入（原子写，失败静默）。
- `application/context/collect.ts` 不感知写入；新增 `application/context/briefing.ts` 负责读/写/判断。
- `doctor` 读取该文件：无记录或 `last_session_start_at` 距今超过阈值（默认 7 天）→ warning `briefing.stale`：提示 session-start hook 可能未生效。
- 阈值可先用常量，不新增 CLI 参数（避免范围膨胀）。

## D4：doctor 行为级检查

在 `application/diagnostics/doctor.ts` 的 `checkSkills`/`checkHarness` 附近新增 `checkSessionStartHooks(root, deps)`：

- 对 capabilities 中 `sessions` 含 session-start 事件的每个 harness：
  - 若对应 `session_start.path` 是 workbench 相对路径且存在：检查内容是否包含 `jspace context session-start`；缺 → warning `harness.session_start_not_wired`（保留现有 `hooks.not_wired` 作为 claude 兼容诊断，或统一映射）
  - 若对应路径是 machine 路径（如 pi）：通过注入的 `readHarnessConfig`/新 deps 读取，缺或未挂事件 → warning
  - 若 workbench 中根本没有该 harness 的 seed（例如用户只用 cursor 时没有 `.claude/`）→ 不报（只检查已选/已物化 harness）
- 读取 `briefing.json`：
  - 无记录/超阈值 → warning `briefing.stale`
  - 有记录且新 → 不报
- 复用已有 `gbrain.skillsdir_unwired` / `cursor.skills_unlinked`，不重复。

## D5：incident banner

在 `application/context/payload.ts` 增加：

```ts
function incidentBanner(state: WorkbenchState): string {
  if (state.cronIncidents.length === 0) return "";
  return `⚠️ open incidents: ${state.cronIncidents.length}（jspace cron check）`;
}
```

- `renderSessionStart` / `renderPreCompact` / `renderSessionEnd` 在最前面插入 banner（若有）。
- `renderTurn` 已输出单行 cron 失败，不需要重复 banner。
- `cronFailures` 输出已含 open incidents，保持现状；doctor 已有 `cron.open_incidents`。
- 可选：工作台根 `CRON-ALERT.md` 暂不做（issue 是“考虑”），放入非目标避免扩散。

## D6：首启文档

修改 `skills/jspace-use/SKILL.md` §2：
- 第 4 步后新增可选 “4.5 Scheduled tasks”：
  - 列出 `.jspace/cron.json` 任务与时段
  - 提示 `jspace cron install`
  - 建议先 `jspace cron run --id <name>` 手动演练
  - 明确可跳过
- 第 5 步 Final smoke 增加 cron 验证：
  - 有启用 cron → `jspace cron status` / doctor 确认 crontab 已装
  - 跳过 cron → 标 `deferred`，不报错
- 同步更新 `cli/assets.generated.ts`（跑 gen-assets）。

## 兼容性 / 回滚

- 新增 briefing.json 是纯增量机器状态；旧工作台无此文件时 doctor 会 warning，但不会写坏。
- capabilities.yaml 新字段是 optional；旧二进制忽略未知 yaml 字段不影响（但本仓库统一 gen-assets）。
- `harness wire` 的 Pi hook 写入只在 dry-run/显式 wire 时发生；backup + merge 保证不整文件覆盖。
- 回滚：撤销 commit 即可；Pi 机器配置可用 backup 文件恢复。

## 待核实清单（实现前）

- [x] pi-hooks 包分析：已确认是 Pi 扩展集合，不是“jspace hook 配置格式”
- [x] Pi session-start 自动化的真实机制：`pi.on("before_agent_start")` + `pi.on("context")` / 返回 `systemPrompt`
- [ ] 在真实 Pi 环境验证 `~/.pi/agent/extensions/jspace/index.ts` 自动加载与注入效果
- [ ] 现有 `hooks.not_wired` 测试与新增通用诊断的映射方式（保留旧 code 或迁移）
