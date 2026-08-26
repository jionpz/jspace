# 冗余代码/文档审计与清理 — implement

> 执行计划。上下文:`prd.md`(范围/验收)+ `research/audit-*.md`(证据)。本任务所有改动均为**机械、证据充分、行为零变化**,无架构权衡,故不设独立 design.md。
> 原则:每改一类 → 跑对应验证;全部完成 → 全量回归 + diff review。

## 验证命令(全程)

```bash
bunx tsc --noEmit
bun test
bun run scripts/check-skills.ts        # C1-C4
bun run scripts/gen-assets.ts          # 改 skills/templates 后必须重跑,确认 C4 无 diff
git diff --stat                        # review 删除面
```

---

## Phase A — 死代码清理(R1)

- [ ] A1 `application/workspace/agents-block.ts`:删除零引用导出 `readAgentsFile`(:40-46)与 `writeAgentsFile`(:48-51)。确认全仓无引用(含测试)。
- [ ] A2 删除 `.trellis/spec/frontend/` 整目录(7 个未填充 Trellis 模板占位)。
- [ ] A3 验证:`bunx tsc --noEmit` + `bun test` + `check-skills` 全绿;`git grep "readAgentsFile\|writeAgentsFile"` 无残留。
- **Gate A**:tsc/测试绿,死代码清零。

## Phase B — 文档与元数据漂移修正(R2)

- [ ] B1 `.gitattributes:13` 断链 `.trellis/spec/cli/backend/...` → `.trellis/spec/backend/directory-structure.md`(实际存在路径)。
- [ ] B2 `package.json` version:对齐当前 tag(1.0.9),或补注释声明其非事实源(与 `cli/version.generated.ts` 一致)。
- [ ] B3 `templates/workbench/AGENTS.md` 参考的 spec 文档(如存在)`quality-guidelines.md:25` 所有权描述:「currently all managed」→ seed/user/managed 三态 + migrate。
- [ ] B4 spec legacy 措辞:`.trellis/spec/backend/index.md:7`、`directory-structure.md:18,37`「legacy cron/update」→ 删 legacy 措辞或改为当前机制描述。
- [ ] B5 测试计数 `quality-guidelines.md:24` 陈旧数字 → 实际数(运行 `bun test` 后填)。
- [ ] B6 `cli/commands/cron.ts:96`「remove installed launchd agents」→「remove installed platform scheduler tasks」。
- [ ] B7 `application/workspace/state.ts:2-3` 迁移完成注释 → 更新为已完成态。
- [ ] B8(可选)`manifest.ts:173`/`workspace.ts:288`「legacy seed copy」reason →「recorded copy no longer in bundle」(通用 remove 语义)。
- **Gate B**:文档/措辞修正完成,`git diff` review 确认无内容损失。

## Phase C — 重复实现收敛(R3)

- [ ] C1 `safeReadFile`:workspace.ts:18 与 journal.ts:21 逐字重复 → 收敛到 `application/workspace/` 下共享 helper(如 fs-helpers.ts),两处 import。
- [ ] C2 `sha256Of`:manifest.ts:11(string 版)与 update.ts:56(bytes 版)同名双定义 → 共享 hash helper。保留两个入口签名(string→hex、bytes→hex),内部共享底层逻辑;勿破坏两端现有调用。
- [ ] C3 无意义导出去 export(行为零变化):`readHub`/`readLocal`/`formatJson`(workbench-state.ts:55,57,75)、`agentsRel`(agents-block.ts:53)、`applyOps`(scheduler-service.ts:59)、`export { CONFIG_DIR }`(init.ts:21)。
- [ ] C4 `REGISTRY_FILE` 别名(core/contracts/files.ts:6)→ 内联 `HUB_FILE`,删别名;更新 `state.ts:7,16` 引用。
- [ ] C5 `filehubRoot` 别名(application/automation/status.ts:21)→ 改引用点后删。
- [ ] C6 `openIncidents`(incidents.ts:92-94):核实生产路径是否用内联 filter、该导出仅测试消费 → 移入测试文件或保留为语义 helper(二选一,按审计结论,保留但注明)。
- [ ] C7 验证:`bunx tsc --noEmit` + `bun test` + `check-skills` 全绿。
- **Gate C**:重复消除,行为不变。

## Phase D — 全量回归 + review

- [ ] D1 `bunx tsc --noEmit` 绿。
- [ ] D2 `bun test` 全绿。
- [ ] D3 `bun run scripts/check-skills.ts` C1-C4 绿。
- [ ] D4 `bun run scripts/gen-assets.ts` 重跑无 diff(本任务未改 skills/templates,应天然无 diff;C4 兜底)。
- [ ] D5 `git diff --stat` + 逐文件 review,确认:删除面最小化、保留项未误删、无内容损失。
- [ ] D6 残留确认:`git grep "readAgentsFile\|writeAgentsFile\|REGISTRY_FILE\|filehubRoot"` 无生产引用残留。
- **Gate D**:全绿 + diff review 通过。

## 收尾

- [ ] 提交:按 Phase 分次(A 一次、B 一次、C 一次)或合并;commit message 标注清理类别。
- [ ] PRD AC1-AC8 逐条勾选核对。
- [ ] 归档任务(实现完成后)。
- [ ] 发布衔接:本任务不改 bundle 内容(skills/templates 未动),**无需 bump version / 发布**。若 B2 选择 bump package.json 版本,仅元数据,不影响 bundle_version。

## 明确不做的(边界)

- 不删 `openai.yaml` / `database-guidelines.md`(R4 产品决策项,列出待确认,不自动清理)。
- 不清理 `bin/` 本地产物(本地手动)。
- 不改通用 upgrade/ownership/journal 机制、不删 legacy 迁移测试。
- 不触碰 `jspace-use` skill 名 / 打包清单 / ownership 规则。
