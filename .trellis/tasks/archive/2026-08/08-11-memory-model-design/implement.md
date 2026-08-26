# implement.md — 记忆模型重构执行计划

> 有序 checklist + 验证命令 + 回滚点。依赖:prd.md + design.md。

## 执行顺序(R1 地基 → R2 写侧 → R3/R4 读侧 → R6 迁移脚本 → 全局验证)

### Step 1 — R1 记忆模型权威定义(gbrain.md)

- [ ] 重构 `skills/jspace-use/references/gbrain.md`:
  - §Page type semantics 重写:type 归一 `note`(smoke 一并移除——仅测试用),移除 lesson/decision/reference 分类语义
  - 新增「记忆模型权威定义」节:六命名空间 + 写语义矩阵 + 边界判据 + state 卡 schema + **tags 检索区分表**(design §1.1-1.4)
  - dated memory record 节 `memory/consolidate/` → `records/consolidate/`、`memory/retro/` → `records/retro/`
- [ ] 确认 `gbrain list --tag` 过滤可用作注入/检索路由(替代 `--type` 过滤),collect 侧依赖它
- [ ] 同步 `~/.agents/agents.md` §4:state 卡描述对齐新模型(命名空间表 + lessons/decisions 归属 + tags 约定),不新增篇幅

**验证**:`grep -rn "memory/consolidate\|type: decision" skills/jspace-use/` 零命中(迁移文档例外)

### Step 2 — R2 写侧对齐(五 skill + 验收基线)

- [ ] memory-writeback:SKILL.md 决策表(decision → project/<id>/decisions/;晋升 → lessons/knowledge)+ references/writeback.md 同步
- [ ] asset-ingest:SKILL.md + references/gbrain-write.md 写页 type → note + `tags: [asset]`
- [ ] weekly-report:SKILL.md 指针页 type 归一 + `tags: [asset]` + 引用 records/consolidate
- [ ] memory-consolidate:SKILL.md slug → records/consolidate/ + `tags: [consolidate, weekly]` 保持
- [ ] workbench-retro:SKILL.md slug → records/retro/ + 引用同步
- [ ] memory-recall:references/memory-acceptance.md 基线 slug 形态对齐(随迁移执行,本步仅核对引用面)

**验证**:`grep -rn "memory/consolidate\|memory/retro\|type: decision\|type: reference\|type: lesson" skills/ | grep -v "gbrain-write.md\|migration.md\|memory-acceptance.md"` 零命中(迁移文档/基线文档豁免)

### Step 3 — R3 注入腿(collect + payload)

- [ ] `application/context/collect.ts`:`WorkbenchState` 加 `projects` 字段;加 `collectActiveProjects()`(gbrain list --type note --tag project,过滤 project/*/state,取活跃 ≤8,摘要取「现在到哪了」首行);不可达/超时静默返回空
- [ ] `application/context/payload.ts`:`stateLines()` 加「项目」行(活跃才列,≤8 行)
- [ ] **超时保护**:gbrain 子进程调用带独立 2s 超时(防 session-start hook 10s 总超时拖死整个注入;超时省略项目行,不丢既有域/pending 行)
- [ ] collect.test.ts / payload.test.ts 补用例(有项目/无项目/不可达/超时)

**验证**:`bun test application/context/`;`jspace context session-start --plain` 含「项目」行;注入增量实测 ≤500 tokens;超时用例单测通过

### Step 4 — R4 俯瞰视图(project list --status)

- [ ] `cli/commands/project.ts`:`list` 加 `--status`——新增 `listProjectStates()`(与 collectActiveProjects 分离:俯瞰取全部 + 三段 + 交集),逐页 get 取三段摘要 + 解析「相关项目」wikilink
- [ ] 集合定义:`--status` 以 gbrain 全部 project/*/state 为主体,附 hub 注册但无 state 卡的项目(标记「无状态卡」)
- [ ] 单测覆盖(有/无 state 卡、交集标记、并集逻辑)

**验证**:`jspace project list --status` 输出正确(含代码项目 + hub 补缺);`bun test`

### Step 5 — R6 迁移脚本(备好,不执行)

- [ ] `scripts/migrate-memory-model.ts`:`--dry-run`(默认)输出映射清单(design §5.1 14 行);`--apply --confirm` 执行 + `state/migrations/memory-model-v2.jsonl` 幂等记录
- [ ] 映射含 review 修正:knowledge/jspace → project/jspace/lessons/;knowledge/机器学习/ → 补主题段;type 归一 + tags 对齐
- [ ] 单元测试:映射正确、幂等、apply 门控

**验证**:`bun run scripts/migrate-memory-model.ts --dry-run` 输出 = 14 行映射,与 design §5.1 一致

### Step 6 — 全局验证 + 收尾

- [ ] `bun run scripts/gen-assets.ts` 重新生成嵌入式资产
- [ ] `bun test`(全量)+ `bun run tsc -- --noEmit` 通过
- [ ] `jspace doctor --dir .` 通过(工作台无破坏)
- [ ] 更新 prd.md 验收勾选 + 更新记忆(如必要)

**验证**:全绿

## 风险文件 / 回滚点

| 风险 | 缓解 |
|---|---|
| gbrain.md 重写破坏既有引用 | R1 先行且文档级,git revert 即可 |
| R2 契约改错(某 skill 漏改) | Step 2 后 grep 断言兜底,零命中才进 Step 3 |
| R3 注入超预算/破坏既有行 | stateLines 追加不删改;单测 + 实测增量 |
| R4 破坏默认 list | --status 新增旗标,默认行为不变 |
| R6 apply 误执行 | 默认 --dry-run;apply 需 --confirm;交付但不部署 |

## 不做的(明确延后)

- 迁移脚本 `--apply` 的实际执行(等 serve 锁释放 + 用户确认时机)
- R5 project CLI 生命周期增强
- gbrain 自升级
- memory-recall 验收基线重跑(随迁移执行一并)
