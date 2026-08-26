# P1: capabilities.yaml + argv/doctor 数据化

## Goal

把 harness 支持从硬编码 switch 迁到**数据驱动**：新增 `adapters/harness/capabilities.yaml` 作为单一事实源，argv 组装 / doctor 检测 / 文档 render / CI 断言全部消费它。**本阶段不动任何功能语义**，只把「3 个 harness 的 hard switch」数据化，为 P2–P5 打地基。

父任务：`08-09-multi-harness-support`。依赖：无（架构基石，必须先上）。

## Confirmed Facts（已核实）

- `adapters/harness/argv.ts` 现为 `switch(harness)`：claude（`-p` + `--output-format text` + `--allowedTools Bash,Read,Write,Edit,mcp__gbrain__*`）、codex（`exec`）、pi（`-p`）；default → `fail(unsupported harness)`
- `core/contracts/cron.ts:27`：`HARNESSES = ["claude", "codex", "pi"]`，`readEnum` 用它校验 cron.json 的 harness 字段
- `application/diagnostics/doctor.ts`：有 `checkGBrain` / `checkCrons` 等，无 checkHarness
- 模板 `templates/workbench/.jspace/cron.json` 的 cron 项 harness 均为 `claude`
- Grok Build headless = `grok -p`，hook 兼容 `.claude/settings.json` 路径；OpenCode headless = `opencode run`，plugin 为 `.opencode/plugins/*.ts`；Pi headless = `pi -p`
- 决策记录见父任务 prd D1–D5；本任务只搬数据，不实现 P2–P5 的行为

## Requirements

- **R1** 新增 `adapters/harness/capabilities.yaml`（**作者态单一事实源**）：schema_version + `harnesses:`（claude/grok/opencode/pi/**cursor** + codex 兼容条目），每项含 `headless` / `argv_flags` / `sessions`（每项带 `source: hook|plugin|extension`）/ `mcp`（`native: true` 或 `via: <adapter>` 联合）/ `skills_projection`（拆 `workbench_projection` 相对路径 与 `user_install` 用户级路径）/ `hook_format` / `native_memory` / `lifecycle`（session_start / session_end / fallback / crash_recovery 四维 grade，值 automated/best_effort/manual/unsupported）/ `cron_harness_enum_value`。值如实标注：claude mcp native、grok native_memory:full、opencode hook_format:opencode_plugin_ts、**pi mcp via: pi_mcp_adapter + sessions source: extension（D4 定案，P1 即按终值写，不临时占位）**、**cursor 无 headless（IDE，不进 cron enum）+ mcp native + sessions source hook（sessionStart，`~/.cursor/hooks.json`）+ hook_format: cursor_hooks_json（D6 定案保留）**；lifecycle grade 初值照现 `harnesses.md:87-92` 矩阵（Grok/OpenCode 标注待 P2/P3 验证）
- **R1b** 新增 gen-assets 步骤：把 capabilities.yaml render 成 `cli/capabilities.generated.ts`（TS 对象）嵌入编译二进制；yaml 解析用 `Bun.YAML`（gen-assets / P5 脚本期），**运行时零 yaml 依赖**
- **R2** 新增 `adapters/harness/types.ts`：`HarnessCapability` 类型（对齐 R1 字段；mcp 联合、sessions.source、lifecycle grade 枚举、workbench_projection/user_install 拆分都在此一次定义）
- **R3** 新增 `adapters/harness/registry.ts`：`loadCapabilities()`（**从 R1b 的 generated 模块读**，含诊断校验）、`get(harness)`（unsupported → fail）
- **R4** 新增 `adapters/harness/{claude,grok,opencode,pi,codex,cursor}.ts`：每文件 export `capability` / `headlessArgv(prompt, platform, bin)` / `hookFilePath(workbench, homedir)`（有 hook_format 才实现）/ `skillProjectionTargets(workbench)`。**cursor 的 headlessArgv → `fail("cursor 无 headless CLI")`**（IDE，仅会话 harness）
- **R5** 改 `adapters/harness/argv.ts`：删 switch，改 `registry.get(harness).headlessArgv(prompt, platform, bin)`（**保留 bin 注入参数**，`application/automation/execute.ts:193` 依赖）；新建 `harness.ts` barrel export（现状 `adapters/harness/` 无此文件）
- **R6** 改 `application/diagnostics/doctor.ts`：新增 `checkHarness()`——**只检查活跃 harness**（由该 workbench `cron.json` 的 harness 值集合 + 已检测到的接线文件推导），非全遍历：headless 在 PATH？hook 文件已写？`workbench_projection` 投影到目标目录？`native_memory` 与用户 cron harness 匹配？drift → warning；`user_install` 路径只做存在性 info（避免 Claude 用户收到 grok/opencode 未安装噪音）
- **R6b** 给 `cron run` 加 `--harness <x>` override（cronRunSpec 加 harnessOverride 覆盖 cron 定义的 harness；「新 harness argv」验收命令的前提）
- **R6c** 改 `application/workspace/manifest.ts` `SKILL_PROJECTIONS`：从 capabilities 推导（union 所有 harness 的 `workbench_projection`）或显式并入新目标，消除与 capabilities 平级的第二事实源
- **R7** 改 `core/contracts/cron.ts`：`HARNESSES` 扩为 `["claude","codex","grok","opencode","pi"]`（与 capabilities.yaml 的 cron_harness_enum_value 一致）
- **R8** 模板 `templates/workbench/.jspace/cron.json` 的 enum 校验随 R7 生效，现有 cron 项 harness 值不变

## Acceptance Criteria

- [ ] AC1 `bunx tsc --noEmit` 全过
- [ ] AC2 `bun test` 全过（新增 registry.test.ts：generated 模块 decode、unknown harness fail、所有可无头 harness 的 headless argv 组装、**cursor 无 headless fail case**；argv.test.ts 改造为「registry→组装」wire，不再含平台 switch；doctor.test.ts **活跃 harness** 至少一个 ok + 一个 drift case）
- [ ] AC3 `jspace cron run <cron> --harness claude --dry-run` 回归通过（现行为不变）；`--harness grok` 可组装 argv（R6b 生效）
- [ ] AC4 `jspace doctor --dir <verify>` 输出新增 checkHarness 分组（只含活跃 harness 检查，无全遍历噪音）
- [ ] AC5 无遗留独立 `switch(harness)`（grep 验证）
- [ ] AC6 capabilities.yaml 与 `core/contracts/cron.ts` enum **双向一致**（每个 key 的 cron_harness_enum_value 过 readEnum，且 HARNESSES 每个值 ∈ yaml keys）
- [ ] AC7 gen-assets 重跑后 `cli/capabilities.generated.ts` 更新，verify.yml asset freshness 通过（capabilities 进嵌入资产）

## Out of Scope

- P2–P5 的行为实现（hook 写入、插件落地、文档 render、CI 脚本）
- 修改 gbrain 存储层 / slug 纪律
- 新增第 5 个 harness
