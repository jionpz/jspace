# Research: 过时 / 漂移文档审计

- **Query**: 全仓 .md（根 / AGENTS / GOAL / README / docs / skills / templates / .trellis/spec）中引用不存在路径、描述已不存在机制、或与当前实现漂移的内容。
- **Scope**: internal
- **Date**: 2026-08-06

## 结论一：命名漂移已收敛（验证通过）

- 上轮重构改名 jspace-bootstrap → jspace-use 后，文档/模板/skill 内已无旧名残留（`jspace-bootstrap` 仅存于测试 fixture，见 audit-dead-code 结论一）。
- `templates/workbench/README.md:36`、`AGENTS.md:129,158,185` 均指向 `.jspace/skills/jspace-use/...`，正确。

## 结论二：漂移文档清单（每条带证据）

### 2.1 `.trellis/spec/frontend/` 全目录为未填充模板（7 个文件）

`.trellis/spec/frontend/` 下 `index.md` / `directory-structure.md` / `component-guidelines.md` / `hook-guidelines.md` / `state-management.md` / `quality-guidelines.md` / `type-safety.md` 全部含「To fill」「To be filled by the team」「Document your project's ... conventions」等占位措辞（grep 确认 7/7 命中）。

- JSpace 是无前端、无 React/hook/组件/状态管理的 bun+TS CLI。这 7 个文件是 Trellis 默认模板、从未填充。
- **判断**：整目录可安全删除（保留 `backend/` 与 `guides/`）。

### 2.2 `.trellis/spec/backend/database-guidelines.md` 为「N/A」占位

- 文件 29 行，内容为「N/A — no local DB; JSON state + external gbrain」且标注 Status: Active。
- 项目确实无数据库（GOAL 非目标明确「不自研文件同步引擎」等），该文件是空占位。**需确认**（可删，或并入 quality-guidelines 一条说明）。

### 2.3 `.trellis/spec/backend/quality-guidelines.md:25` 所有权描述过时

- 原文「bundle files carry `AssetOwnership` (currently all `managed`)」——**与实现不符**：`application/workspace/manifest.ts:25-30` 的 `ownershipFor` 按前缀返回 `seed`（skills/、templates/workbench/）/ `user`（templates/workbench/.jspace/）/ `managed`（其余）。「currently all managed」已过时。
- 同句 diffBundle action 列表 `create / no-op / update / conflict / skip / stale / remove / block-update` **遗漏了 `migrate`**（hub schema 迁移，workspace.ts:233 会 push `migrate` action）。
- **判断**：需改（文档漂移）。

### 2.4 `.trellis/spec/backend/` 「legacy cron/update」措辞过时

- `index.md:7`、`directory-structure.md:18,37` 三层写「cli (CommandSpec tree + generated assets + **legacy** cron/update)」。
- cron / update 是**当前**实现（cron 全链 + update 自更新），不是 legacy。「legacy」是早期「legacy cli/args.ts / legacy cli/cron.ts」迁移期措辞残留。
- **判断**：措辞过时，需改为「cron/update」或删掉 legacy。

### 2.5 `.gitattributes:13` 引用不存在的 spec 路径

- 注释引用 `.trellis/spec/cli/backend/directory-structure.md` —— 该路径**不存在**（`ls .trellis/spec/cli` 报 No such file）。真实路径是 `.trellis/spec/backend/directory-structure.md`（无 `cli/` 段）。
- **判断**：注释路径错误，需修正。

### 2.6 `application/workspace/state.ts:2-3` 注释为迁移期残留

- 注释「Moved out of the cli compatibility facade (cli/registry.ts)... the cli facade is deleted after migration」——`cli/registry.ts` 门面早已删除，这句话读起来像未来时。**判断**：措辞过时（低优先）。

### 2.7 `package.json:3` 版本号漂移

- `package.json` 写 `"version": "1.0.8"`，但当前 git tag 与 `cli/version.generated.ts:3`（gen-version 生成）均为 **1.0.9**。全仓无代码读取 package.json 的 version（grep 无引用者），故为纯元数据漂移。
- **判断**：需同步（bump 到 1.0.9 或改由 gen-version 维护）。

### 2.8 `cli/commands/cron.ts:96` uninstall 文案只提 launchd

- summary「remove installed launchd agents for this workbench」——但 `cron uninstall` 经 `schedulerAdapter(process.platform)` 走三平台（launchd / crontab / schtasks）。**判断**：跨平台措辞漂移（低优先），应为「platform scheduler tasks」。

### 2.9 测试数量漂移（轻微）

- `.trellis/spec/backend/quality-guidelines.md:24`「currently 339 tests across 45 files」——实测 361 tests / 45 files（2026-08-06）。文件数一致，测试数差 22。**判断**：轻微陈旧，随改动更新即可。

### 2.10 `skills/asset-ingest/references/batch.md:57` 降级日志路径与 CLI 行为有细微差

- 文档：「未注册 filehub 时:写工作台 `.jspace/logs/inbox-batch.md`（工作台侧日志槽位）」。
- CLI 侧 `application/automation/execute.ts:124-136`：`fhRoot === null` 时 `batchLog = null`，inbox-tidy 的 batch 变更守卫直接跳过（不检查也不写工作台槽位）。写日志的是 skill/AI 侧行为，CLI 不写。
- **判断**：需确认——是「skill 侧降级路径」与「CLI 守卫不覆盖降级路径」的有意分工，还是文档与实现漂移。不阻断。

## 结论三：核对后无漂移的文档（避免误报）

- `README.md`（安装/目录结构/命令面）——与当前 CLI 一致。
- `docs/PLATFORMS.md`——harness 矩阵指针、3 默认 cron、build target、调度后端均与实现一致。
- `GOAL.md`——里程碑 M0-M5 状态、开放问题闭合记录、jspace-use 指针均正确。
- `templates/workbench/AGENTS.md` + `README.md`——所有权四类、升级边界、skill 名单与 manifest/ownershipFor 一致（生成块 + 手写散文已同步新名）。
- `skills/jspace-use/SKILL.md` + references——路径与命令面一致。
- `.trellis/spec/guides/`——通用思维指南，无项目路径依赖。
- `.trellis/spec/backend/error-handling.md` / `logging-guidelines.md`——与实现模式（diagnostics 收集器、machine-truth vs prose）一致。

## 判定汇总

- **可安全删**：`.trellis/spec/frontend/` 整目录（7 个未填充模板）。
- **需确认**：`.trellis/spec/backend/database-guidelines.md`（N/A 占位）；`batch.md:57` 降级路径语义。
- **需修改（漂移）**：quality-guidelines.md:25 所有权描述 + 缺 migrate；spec「legacy cron/update」三处；`.gitattributes:13` 路径；package.json version；cron.ts:96 文案；state.ts:2-3 注释；quality-guidelines.md:24 测试数。
