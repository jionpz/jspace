# P1 Design: capabilities.yaml 数据化

## 架构边界

```
capabilities.yaml (作者态单一事实源, adapters/harness/)
      │ gen-assets render (Bun.YAML 解析)          [R1b]
      ▼
 cli/capabilities.generated.ts (TS 对象, 嵌入编译二进制)   ← 运行时唯一来源
      │
      ▼
 registry.loadCapabilities()  [registry.ts: 从 generated 模块读 + 校验]
      │
      ├──► argv.ts: registry.get(harness).headlessArgv(prompt, platform, bin)   # 替代 switch,保留 bin 注入;cursor → fail(无 headless)
      ├──► doctor.ts checkHarness(): 只查活跃 harness（cron.json harness 值 ∪ 已接线文件）
      ├──► manifest.ts SKILL_PROJECTIONS: 从 capabilities.workbench_projection 推导 [R6c]
      ├──► (P5) check-harness-consistency.ts / docs render（读作者态 yaml）
      └──► adapter/{claude,grok,opencode,pi,codex}.ts 各自封装 capability + 行为
```

- **边界**：capabilities.yaml 只声明「每个 harness 支持什么」，不含业务逻辑；行为在 adapter 文件
- **数据流**：单向下行——yaml → gen-assets → generated 模块 → registry → 消费方；P5 脚本直接读作者态 yaml 做漂移断言。无反向写回
- **契约**：`HarnessCapability` 字段 = yaml `harnesses.<name>` 字段（headless/argv_flags/sessions/mcp/skills_projection/hook_format/native_memory/lifecycle/cron_harness_enum_value）

## 关键设计决策

1. **运行时可达性（审查 H1，必须）**：`bun build --compile ./cli/main.ts` 只嵌入 `templates/+skills/`（`scripts/gen-assets.ts:33` SOURCES 不含 `adapters/`），capabilities.yaml 在用户机器二进制里不可达。**定案：gen-assets 加步骤 render 成 `cli/capabilities.generated.ts`**，与现有 `skills.generated.ts` / `manifest.generated.ts` 先例一致；yaml 仅 gen-assets/P5 脚本消费。这同时关闭 yaml 依赖悬案：`Bun.YAML`（实机验证存在）只在脚本期用，**运行时零 yaml 依赖**。
2. **`argv_flags` 表达**：yaml 用 `headless: [cmd, ...]` + `argv_flags: {permission, tools_value, output, output_value}`；`headlessArgv` 负责组装。**顺序由 adapter 代码拥有**（claude.ts 硬编码 `[bin, -p, prompt, --output-format, text, --allowedTools, ...]`），yaml 只提供键值对——保 `argv.test.ts` 现有逐字节断言。
3. **`cron run --harness` override（审查 H2，必须）**：`cli/commands/cron.ts:111-151` cronRunSpec 无 `--harness`（现状只属 `cron add`）。**定案：cronRunSpec 加可选 harnessOverride**，`execute.ts` 优先用它覆盖 `cron.harness`；「新 harness argv」验收命令全部依赖它。unsupported → `fail`（复用 `core/shared/errors.ts`）。
4. **类型正规化（审查 M7/M8）**：`mcp` 用联合 `{ native: true } | { via: "<adapter>" }`（pi 走 via）；`sessions` 每项带 `source: hook|plugin|extension`（pi 扩展事件可表达，不再与 `hook_format: none` 自相矛盾）；`skills_projection` 拆 `workbench_projection`（相对路径，进物化/漂移检测）与 `user_install`（`~/...` 前缀，doctor 只做存在性 info）；`lifecycle` 4 维 grade 枚举（automated/best_effort/manual/unsupported，初值照 harnesses.md 矩阵）。
5. **doctor checkHarness 只查活跃 harness（审查 M4）**：由 `cron.json` harness 值集合 + 已检测接线文件推导，非全遍历——避免 Claude 用户收到 grok/opencode 未安装噪音；`user_install` 路径只 info 不 warning。
6. **SKILL_PROJECTIONS 去第二事实源（审查 M2）**：`application/workspace/manifest.ts:46` 硬编码 `[".claude/skills", ".agents/skills"]`；定案：改为从 capabilities 的 `workbench_projection` union 推导，P2/P3 新增 `.grok/skills`/`.opencode/skills` 自动生效。
7. **codex 兼容**：capabilities.yaml 含 codex 条目 + `documented: false` 标注（P5 豁免 harness-codex.md），现有 cron 契约继续可用。
7b. **cursor 会话 harness（D6 保留）**：capabilities 含 cursor 条目——**无 headless**（IDE，无 `-p` 模式）→ `headlessArgv` fail、不进 cron enum；`mcp native`（`~/.cursor/mcp.json` / 项目 `.cursor/mcp.json`）；`sessions source hook`（`~/.cursor/hooks.json` sessionStart 注入 additional_context，harnesses.md:257）；`hook_format: cursor_hooks_json`。现状接线已存在（harnesses.md:55-72），本任务只数据化不新增行为。lifecycle grade 照矩阵 Cursor 行（session-start best_effort / session-end manual / fallback manual / crash manual）。
8. **`get(unsupported)`**：`fail(...)`——cron run 传错 harness 立即明确报错，延续现状语义。
9. **`hookFilePath` / `skillProjectionTargets` 只对有能力者实现**：pi 的 hook_format:none → no-op；grok/opencode 的 hook 生成 P2/P3 填实现。

## 兼容性 / 迁移

- `cron.json` 现有 harness:claude 值不变；enum 扩 5 只放宽不收紧（向后兼容）
- argv 组装结果与现状**逐字节一致**（claude/codex/pi 三 case 迁移后行为不变）→ 现有 argv.test.ts 断言保住
- `cron run --harness` 是纯新增 override，不改变默认行为（未传时用 cron.harness）
- 回滚：capabilities.yaml + generated 模块为新增；argv.ts/cron.ts/manifest.ts 改动点小，git revert 即回滚，无数据迁移

## 风险 / 权衡

- **gen-assets 新增步骤**是唯一新机制，复用现有 render 管线；若 render 失败 CI 即红（asset freshness），风险低
- **SKILL_PROJECTIONS 推导**改动 manifest 物化路径，需回归 init/upgrade 测试（P1 测试覆盖）
- **lifecycle grade 初值**来自现有 harnesses.md 矩阵，Grok/OpenCode 待 P2/P3 实测后校正（P5 render 前校准）
- **行为不变是硬约束**：argv 组装任何字节级漂移都会被 argv.test.ts 抓到——这是 P1 的护栏
