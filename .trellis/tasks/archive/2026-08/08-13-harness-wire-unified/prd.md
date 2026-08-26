# 统一 harness init/wire 命令:五端对称接线(issue #12)

## Goal

提供与 Trellis `init --<platform>` 语义对齐的**按 harness 初始化/接线**命令,让 claude / grok / opencode / cursor / pi 五端的机器级接线走同一条命令,消除「Claude 一份文档、Grok 一个 subcommand、Cursor 手写 json」的现状。capabilities.yaml 保持为 wire 目标单一事实源(加第 N 个端 = 加条目)。

## Requirements

### R1 统一 CLI:`harness init` + `harness wire` 五端对称

- `jspace harness init --harness <claude|grok|opencode|cursor|pi> --dir . [--dry-run]` — 工作台内确保该端 seed / skill 投影存在(`jspace init`/`upgrade` 已物化则 no-op)。
- `jspace harness wire --harness <claude|grok|opencode|cursor|pi> --dir . [--dry-run]` — 机器级接线,幂等写该端 gbrain MCP 配置;claude 收敛现有 `gbrain wire`(保留 `gbrain wire` 为别名,向后兼容)。
- `--harness` 校验值从硬编码 `grok` 改为 capabilities.yaml 声明的五端枚举;未知值 loud fail。

### R2 capabilities.yaml 作为 wire 目标单一事实源

- 每端补齐 `mcp_config`(目前 claude/grok 有值,cursor/opencode/pi 为 null)。
- 每端声明 skills 投影目标与能力边界(现有字段已覆盖,需要时补充 wire 相关字段)。
- 加第 N 个会话 harness = 加 capabilities.yaml 条目 + 实现该端 wire backend,不改 CLI 分派。

### R3 各端 wire 语义(用户决策:五端全做)

- **claude**: 现有 `application/gbrain/wiring.ts`(JSON merge,`~/.claude.json` mcpServers.gbrain env GBRAIN_SKILLS_DIR),收敛为 `harness wire --harness claude` 的内部实现。
- **grok**: 现有 `application/gbrain/grok-wiring.ts`(TOML 行编辑,`~/.grok/config.toml`),行为保持不变。
- **cursor**: 直接写 `~/.cursor/mcp.json` 的 `mcpServers.gbrain`(`command` = 解析出的 gbrain 二进制路径,`args` = `["serve"]`);**不做 mcpc 检测**(用户决策);skills 官方薄链到 `~/.cursor/skills/`;可选项目级 `.cursor/rules/*.mdc` 指针。
- **opencode**: 幂等写 opencode MCP 配置(格式实现时经 context7 确认),注入 gbrain server。
- **pi**: 幂等写 pi 的 gbrain MCP 配置(位置按 `harness-pi.md` 优先级,取 `~/.pi/agent/mcp.json` 或最高存在位置),`GBRAIN_SKILLS_DIR` 注入。

### R4 wire 通用行为

- 幂等:已正确则报 `already-wired` 不写;错误则改并 backup。
- 机器级配置 merge,不整文件重写(沿 claude/grok 现有模式)。
- 每端 wire 打印该端能力边界(headless / hooks / session-end / 是否 cron harness),避免假装 Cursor 能跑 cron。
- `--dry-run` 打印将写的路径与内容,不落盘。
- 需要 gbrain MCP server 已存在时,沿用「永不创建 machine-level config」规则;文件缺失时报清晰指引。

### R5 doctor 缺口检查

- `checkGBrain` 已按 capabilities.mcp_config 泛化——补齐三端 mcp_config 后自动覆盖 cursor/opencode/pi。
- 对已 wire 的 harness 报缺口:`info`/`warning`,不 crash。
- 新增 Cursor skills 薄链缺口检查(无官方 skill 薄链时提示)。

### R6 文档收口

- `jspace-use` SKILL.md §2 第 4 步「Harness wiring」改为「选一个 harness → 跑同一条 wire 命令」。
- `harness-cursor.md` / `harness-opencode.md` / `harness-pi.md` 的「手写 mcp.json」改为命令输出。
- `harnesses.md` 支持全景表 + 逐 harness 接线节更新命令形态。

## Constraints

- **Cursor 不做 cron harness**:保持 `headless: null`、`cron_harness_enum_value: null`,`cron.harness` 拒绝 cursor(issue 非目标)。
- 不自动 session-end writeback(保持 manual)。
- 不引入 Trellis 任务管理 / agents 目录复制。
- 不把 Engram 写进 Cursor IDE mcp.json(机器级策略)。
- 供应链红线:不自动安装 pi-mcp-adapter / mcpc / 任何第三方包;wire 只提示不安装。
- 机器级配置写入必须 backup + merge,永不整文件重写。
- Windows:stdio MCP `command` 写可执行文件全路径;symlink 不可用则降级物化或提示。

## Acceptance Criteria

- [ ] AC1 `jspace harness wire --harness claude --dir . --dry-run` 输出与 `jspace gbrain wire --dry-run` 等效的计划;`gbrain wire` 仍可用。
- [ ] AC2 `jspace harness wire --harness cursor --dir . --dry-run` 打印将写的 `~/.cursor/mcp.json`(gbrain serve + 解析出的 gbrain 路径)与 skills 薄链路径,不落盘。
- [ ] AC3 `jspace harness wire --harness grok --dir .` 行为与现有 `--harness grok` 完全一致(TOML 行编辑、idempotent)。
- [ ] AC4 `jspace harness wire --harness opencode|pi --dir . --dry-run` 打印将写的 MCP 配置路径与内容;真实 wire 幂等可重跑。
- [ ] AC5 `jspace harness init --harness cursor --dir . --dry-run` 打印将确保的投影;已物化则 no-op。
- [ ] AC6 `jspace doctor --dir .`:cursor 无 `~/.cursor/mcp.json` 时在 doctor 输出报缺口(当前会话端或显式 wire 过的端)。
- [ ] AC7 五端 wire 均打印能力边界;cursor 明确「无 headless、不进 cron」。
- [ ] AC8 文档更新:jspace-use §2 第 4 步 + harness-cursor/opencode/pi.md + harnesses.md。
- [ ] AC9 测试覆盖:五端 wire dry-run、claude 别名兼容、TOML/JSON merge 幂等、doctor 新检查、未知 harness loud fail。
- [ ] AC10 真机验证:本机(macOS)`jspace harness wire --harness cursor` 后 `~/.cursor/mcp.json` 内容正确且 `jspace doctor` 缺口消失(或按现状如实报告)。
- [ ] AC11 `check-harness-consistency`(P5)与 manifest 完整性检查全绿;capabilities.generated.ts 重新生成。

## Notes

- issue 原文:#12「按 harness 初始化/接线缺少 Trellis 式 `init --<platform>` 对等命令」。
- 用户决策已定:Cursor 直接写 mcp.json(不做 mcpc 检测);五端全做。
- codex 是 cron 兼容条目(`documented: false`),不在本期五端内。
