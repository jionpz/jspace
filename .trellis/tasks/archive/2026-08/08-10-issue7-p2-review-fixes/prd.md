# Issue #7 P2: 资产治理 + Cursor hook + 文档同步 + consistency 表驱动

## Goal

修复专家 review(issue #7)的 P2 批次 6 项(编号 10-15):gitignore 例外策略统一、Cursor hook 补模板 + envelope、AGENTS/README 文档与仓库现状同步、GEN_ASSETS_ALLOW_MISSING 语义收紧、check-harness-consistency 表驱动扩展、gen-assets skip 规则统一。

## Requirements

### R1 — gitignore 例外策略统一(P2.10)

- **R1.1** `.gitignore`:`.grok/` 纳入忽略列表(与其他 harness 一致);harness seed 例外统一为「解禁整棵模板目录树」(`!templates/workbench/.<harness>/` + `!templates/workbench/.<harness>/**`),删除钉死单文件的行(`.claude/settings.json`、`.opencode/plugins/jspace.ts`)。
- **R1.2** 补 `!templates/workbench/.cursor/` + `!templates/workbench/.cursor/**`(P2.11 新增模板)。
- **R1.3** 注释说明:新增 harness seed 目录时需加对应 `!` 例外;CI 已有 `check-manifest-integrity.ts` 验证 manifest path 不被忽略(P1.6,不需新增)。

### R2 — Cursor hook 补模板 + envelope(P2.11)

- **R2.1**(调研结论)Cursor 支持项目级 `<root>/.cursor/hooks.json`(check into VCS),`sessionStart` 事件输出顶层 JSON `{"additional_context": "..."}` 注入会话初始上下文——adapter 的 `hookFilePath` 指向项目级是**正确**的,harness-cursor.md 写用户级是错的。
- **R2.2** 新增 `templates/workbench/.cursor/hooks.json`:`sessionStart` → `jspace context session-start --envelope cursor 2>/dev/null || true`(thin emit,带失败兜底)。
- **R2.3** `application/context/envelope.ts` 新增 `cursorSessionStartEnvelope(context)` → `{"additional_context": context}`(顶层,Cursor 格式;注释已预留 platform branch)。
- **R2.4** `cli/commands/context.ts` session-start 新增 `--envelope <claude|cursor>` 选项(默认 claude,`--plain` 保留纯文本)。
- **R2.5** `skills/jspace-use/references/harness-cursor.md`:hook 位置改项目级 `.cursor/hooks.json`(seed),用户级列为备选。

### R3 — 文档与仓库现状同步(P2.12)

- **R3.1** 根 `AGENTS.md`:CLI 能力全列(init/doctor/cron/ingest/pending/workspace/context/harness/gbrain/domain/resource/project/skills);skills 4 个(jspace-use/asset-ingest/memory-recall/memory-writeback);删除 `__DEV_ROOT__` 过时描述;补目录结构(cli/core/application/adapters/scripts/templates/skills/types);Quality Checks 补 bun test / gen-assets / check-skills / check-harness-consistency / check-manifest-integrity;补 capabilities.yaml 单一事实源 + 多 harness 投影 + 防漂移脚本说明。`<!-- TRELLIS:START -->` 块不动。
- **R3.2** 根 `README.md`:目录结构补全(adapters/core/application/scripts);CLI 命令全集补 context/harness/gbrain/skills/domain/resource;删除 `__DEV_ROOT__`;补质量门禁与发布说明。
- **R3.3** P2.13 的 `GEN_ASSETS_ALLOW_MISSING` 说明并入 AGENTS.md Quality Checks(故意删除文件才用,CI 不设置)。

### R4 — GEN_ASSETS_ALLOW_MISSING 语义收紧(P2.13)

- **R4.1** `scripts/gen-assets.ts`:只接受 `"1"` / `"true"` 放行(`"0"` / `"false"` / unset 均严格)。修复当前 `!env` 下 `"0"`/`"false"` 是 truthy 反而放行删除的 bug。
- **R4.2** 文档化(AGENTS.md Quality Checks)。

### R5 — check-harness-consistency 表驱动扩展(P2.14)

- **R5.1** 保留现有 6 组断言,新增:
  - **hookFilePath 模板存在**:对每个有 `hookFilePath` 的 adapter,断言其指向的模板文件存在(防 cursor 类再次漏模板)。
  - **headless argv ↔ capabilities 前缀一致**:对每个 headless-capable harness,`harnessArgv` 实际返回的前缀 == `capability.headless.slice(1)`。
  - **lifecycle 与真实接线一致**:期望表——`session_end` 仅 grok=best_effort(模板有 SessionEnd),其余(含 cursor)manual;`session_start` 全部会话 harness best_effort;`fallback` 全部 manual;`crash_recovery` cursor=manual 其余 best_effort。
- **R5.2** 脚本 import `adapters/harness/index.ts`(getAdapter)与 `argv.ts`(harnessArgv)做真实调用断言。

### R6 — gen-assets skip 规则统一(P2.15)

- **R6.1** `scripts/gen-assets.ts`:skip 统一为 `*.test.ts` 和 `*.test.py`(注释「test files never embed」与行为一致)。
- **R6.2** 确认 verify.yml 的 python 测试在仓库路径跑(不走 bundle),skip 无影响。

## Acceptance Criteria

- [ ] AC1 `git check-ignore` 验证:模板 harness seed 文件均不被忽略;非模板 harness 目录仍被忽略
- [ ] AC2 `templates/workbench/.cursor/hooks.json` 存在,init 物化;`jspace context session-start --envelope cursor` 输出顶层 `additional_context` JSON
- [ ] AC3 `check-harness-consistency.ts` 3 个新断言全过(含 cursor 模板存在性)
- [ ] AC4 `harness-cursor.md` 项目级 hook 位置正确
- [ ] AC5 gen-assets 后 manifest 不含 `*.test.py`(文件数 40→38);`bun run scripts/check-manifest-integrity.ts` 绿
- [ ] AC6 AGENTS.md/README.md 无 `__DEV_ROOT__` 残留、CLI/skill/目录信息与现状一致
- [ ] AC7 `GEN_ASSETS_ALLOW_MISSING=0`/`false` 时 gen-assets 仍严格(故意删除文件会红);`=1` 放行
- [ ] AC8 `bunx tsc --noEmit` + `bun test` 全过
- [ ] AC9 `bun run scripts/gen-assets.ts` 后 git diff 无残留
- [ ] AC10 `bun run scripts/check-skills.ts` 通过(AGENTS.md/README 改动不破坏)

## Out of Scope

- P3 批次(issue #7 编号 16-19):manifestPaths 解析脆、任务代号残留、Windows hook 兼容、verify.yml timeout/concurrency
- P0/P1 已完成项
