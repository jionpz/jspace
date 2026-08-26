# 冗余代码/文档审计与清理

## Goal

在 jspace-bootstrap → jspace-use 重构(v1.0.9)完成后,对全仓做一次**结构化冗余收敛**:清除明确死代码、修正漂移/过时文档、收敛重复实现,使仓库状态与当前架构一致。**只删/改有证据的冗余,不破坏任何通用机制、生成物契约或既有行为。**

## Background

- 项目经历多轮重构(资产布局 / ownership / skill 路径单一来源 / bootstrap→use),命名漂移已收敛,但存在结构性冗余积累。
- 全仓只读审计已完成(`research/audit-*.md` 6 份),发现:**无整文件死代码、无旧布局过渡代码、无生成物漂移**(C1-C4 绿)。冗余集中在:2 个死导出、7 个未填充 spec 模板、少量重复 helper、文档/元数据漂移。
- `tsconfig` 已开 `strict`/`noUnusedLocals`/`noUnusedParameters` —— 局部未用被编译器抓;本任务聚焦**未被引用的顶层导出、跨文件重复、文档漂移**。

## Requirements

### R1 死代码清理(可安全删,证据充分)

- 删除零引用导出:`readAgentsFile` / `writeAgentsFile`(`application/workspace/agents-block.ts`)。
- 删除未填充 Trellis 模板目录 `.trellis/spec/frontend/`(7 文件全为占位,项目无前端)。
- 上述删除**不得触发** tsc/测试/check-skills 红;不得改动 ownership/upgrade/journal 机制。

### R2 文档与元数据漂移修正(措辞/断链,非删减)

- 修正 `.gitattributes:13` 引用不存在的 `.trellis/spec/cli/backend/...` → 实际路径。
- 修正 `package.json` version 与当前 tag(v1.0.9)对齐,或声明其非事实源。
- 修正 spec 所有权描述(`quality-guidelines.md:25`「currently all managed」→ seed/user/managed 三态 + migrate)。
- 删除 spec「legacy cron/update」过时措辞(`backend/index.md:7`、`directory-structure.md:18,37`)。
- 更新陈旧测试计数(`quality-guidelines.md:24`)。
- 泛化 cron uninstall 文案(`cli/commands/cron.ts:96`「remove installed launchd agents」→ platform scheduler tasks)。
- 更新 `state.ts:2-3` 已完成的迁移注释。
- 可选:`manifest.ts:173`/`workspace.ts:288`「legacy seed copy」reason 措辞泛化。

### R3 重复实现收敛(需小决策,保持行为不变)

- 收敛 `safeReadFile` 逐字重复(`application/workspace/workspace.ts:18` vs `journal.ts:21`)→ 同层共享 helper。
- 收敛 `sha256Of` 同名单双定义(`manifest.ts:11` string 版 vs `update.ts:56` bytes 版)→ 共享 hash helper(保留两个入口签名)。
- 清理「仅本文件使用」的无意义导出(去 export 关键字,行为零变化):`readHub`/`readLocal`/`formatJson`(workbench-state.ts)、`agentsRel`(agents-block.ts)、`applyOps`(scheduler-service.ts)、`export { CONFIG_DIR }`(init.ts)。
- `REGISTRY_FILE` 旧名别名(`core/contracts/files.ts:6`)→ 内联 `HUB_FILE` 删别名。
- `filehubRoot` 别名(`application/automation/status.ts:21`)→ 改引用点后删。
- `openIncidents`(`application/automation/incidents.ts:92-94`):确认生产路径(内联 filter)后移入测试或保留为语义 helper —— 按确认结果处理。

### R4 需产品决策项(不在本任务自动清理,列出待确认)

- `skills/jspace-use/agents/openai.yaml`:随包物化(seed)但全仓无消费方。删除需重跑 gen-assets(从 bundle 移除);确认无未来 OpenAI 系 harness 计划后单独处理。
- `.trellis/spec/backend/database-guidelines.md`:N/A 占位,删除或并入 quality-guidelines。
- 降级日志路径语义(`batch.md:57` vs `execute.ts:124-136`):确认分工后保留。

### R5 保留(不清理,明示边界)

- 所有通用机制:init legacy-layout guard、remove/stale 分支、hub migration、scheduler untagged 守卫、doctor orphan 诊断 —— 必要保护,保留。
- legacy 迁移测试(workspace.test.ts / doctor.test.ts 的 jspace-bootstrap fixture)—— 通用机制回归保护,保留。
- 生成物(assets/manifest/skills.generated.ts + AGENTS.md 生成块)—— 有单向生成关系 + C4 钉死,保留。
- 分层复制的 parseJsonFile/parseHubJson/isWithin —— 层级不同,合理。

## Acceptance Criteria

- [ ] AC1:全仓 `git grep "readAgentsFile\|writeAgentsFile"`(排 .trellis)仅剩定义删除痕迹;`bunx tsc --noEmit` 绿。
- [ ] AC2:`.trellis/spec/frontend/` 已删除;`.gitattributes` 断链路径已修正。
- [ ] AC3:`bun test` 全绿、`bun run scripts/check-skills.ts` C1-C4 全绿、`gen-assets` 重跑无 diff。
- [ ] AC4:safeReadFile / sha256Of 已收敛为共享 helper(无重复定义);无意义导出已去 export。
- [ ] AC5:spec 文档所有权描述/legacy 措辞/测试计数已修正;cron uninstall 文案、state.ts 注释已更新。
- [ ] AC6:`package.json` version 与当前 tag 对齐或声明非事实源。
- [ ] AC7:保留项未被误删(通用机制 / legacy 迁移测试 / 生成物);`git diff` review 确认删除面最小化。
- [ ] AC8:未触碰任何 skill 名 / 打包清单 / ownership 规则;若改 skills 或 templates 文件,已重跑 gen-assets。

## Out of Scope

- 大范围重构、行为变更、优化(非冗余清除的改进)。
- 清理 `bin/` 本地编译产物(约 630MB,git 已忽略,本地手动处理)。
- 修改通用 upgrade/ownership/journal 机制本身。
- 删除/改名为「需产品决策」项(openai.yaml / database-guidelines / 降级路径)前的自动动作。

## Constraints

- **分析≠清理**:只删有证据(带 file:line)的冗余;拿不准的归「需确认」或保留。
- 行为零变化:每次删除后跑 tsc + 相关测试 + check-skills。
- 仓库 PUBLIC:文档示例/措辞用中性占位,不引入真实个人数据。
- 现有未提交改动(`.trellis/.template-hashes.json`)不触碰。
