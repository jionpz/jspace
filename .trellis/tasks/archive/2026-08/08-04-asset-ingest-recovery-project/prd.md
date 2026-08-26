# asset-ingest journal/补偿 + gbrain pending envelope + project 集成

## 1. Goal

把 asset-ingest 的「移动 → 写 gbrain → 登记 index」流程收敛为 **typed ingest journal + 补偿 + idempotency key**,并把 gbrain 锁冲突时的 pending write 收敛为 **typed pending envelope(producer/apply/ack/retry/terminal-failure)**,同时把 project ID 用于 asset path、index 与 gbrain slug。闭合父任务 R7(记忆与资产日常工作流)、R2(project 跨层稳定身份),验收锚定 AC10 / AC11。

完成后应达到:

- **可恢复执行**:asset-ingest 任一步失败(移动、gbrain put、index、中断)后处于明确、可重试、无静默丢失、无未知孤儿的状态(修复审计 F4)。
- **pending 有契约**:gbrain 锁冲突产生的 pending write 使用 versioned envelope + idempotency key + producer/applier/retry/ack/terminal-failure 规则;重复 apply 不产生重复事实。
- **project 对齐**:filehub asset path、项目 index、gbrain slug 使用同一 project ID;缺失/冲突可检测报告。
- **日志契约唯一**:inbox batch 执行日志位置 skill 写、cron 读同一处(闭合 F3 的 ingest 侧)。

本任务是父任务「架构澄清与可持续演进重构」的 **Child E**。范围限定在 asset-ingest 恢复性、pending envelope 与 project 集成;skill manifest(Child D 已完成)、scheduler/harness(Child C)、六平台 CI(Child F)不在此范围。

## 2. Context(现状基线)

审计确认的与本任务相关事实(行号 2026-08-04 实测):

| 事实 | 证据 |
| --- | --- |
| **F4**:asset-ingest 先移动文件(步骤2)再写 gbrain(步骤3);put 失败时文件已在目标目录、无 gbrain 页 → 孤儿;当前「失败文件仍留在 inbox」承诺无机械补偿 | `skills/asset-ingest/SKILL.md:30-39`;`references/batch.md:24` |
| 「失败即停、不留半成品页」是 prose 纪律,无 journal/机械状态机 | `skills/asset-ingest/SKILL.md:90`;`references/batch.md:24-28` |
| 批量 `.processing` 是瞬态锁(防并发/断点续跑),但无 per-file journal 记录进度/步骤 | `references/batch.md:26-28` |
| **pending APPLY 只有 scanner,无 producer**:`cron failures`/`doctor` 扫描 `<filehub>/.jspace-logs/*.APPLY.md`,但无任何 skill/命令**写**该文件;doctor 提示「apply when gbrain lock frees」为 prose | `cli/cron.ts:389-397`;`application/workspace/doctor.ts:76-80` |
| asset-ingest 对 serve 持锁仅「按其提示处理,不绕过锁」,不机械暂存 | `skills/asset-ingest/SKILL.md:19` |
| memory-writeback 不处理 gbrain 锁(无暂存路径);pending envelope 若落地应两 skill 共用 | `skills/memory-writeback/SKILL.md` |
| 无 `jspace ingest` / `jspace gbrain` / apply-pending 命令;`inbox status` 为只读辅助 | `cli/commands/registry.ts` |
| project ID 已有 typed 契约(Child A hub.ts Project)与 inspect drift;但 asset-ingest 用自由命名 `projects/<项目>/`、slug `assets/<项目|领域>/<语义名>`、index 登记,未用稳定 project id | `core/contracts/hub.ts`;`skills/asset-ingest/references/filing.md:21-23,52-55` |
| batch 执行日志已统一到 `<filehub>/.jspace-logs/inbox-batch.md`(skill 写、cron 读同一处);Child C 已闭合 cron 侧 | `skills/asset-ingest/references/batch.md:55`;`cli/cron.ts:127` |
| 深度抽取(office)写伴生 `.extract.md` + 页内 Key Facts,属派生数据;删除安全 | `references/deep-extract.md`;`references/gbrain-write.md:30-37` |
| 父设计 §10:journaled sequence(validate → stage target → write/stage gbrain → update index → commit/remove source → complete);§7 提及 pending envelope | `.trellis/tasks/08-03-*/design.md` §10 |
| 父任务 implement.md Child E checklist 已含 pending write envelope(2026-08-04 由 Child D 移入) | `.trellis/tasks/08-03-*/implement.md` Child E |

## 3. Requirements

### RE1. Ingest journal(plan/journal/idempotency key)

- 定义 typed ingest journal,记录每份文件的 plan:source、target、slug、projectId、indexEntry、content hash(idempotency key)、步骤状态机(validate → stage-target → write-gbrain → update-index → commit → complete)。
- journal 必须是机器 truth;中断/失败后可从 journal 恢复,不重复处理(幂等)。
- 重复检测基于 content hash + rel_path:同 hash 同目标已入库 → 跳过/版本决策,不重复写页。

### RE2. 移动/写脑/index 顺序与补偿(F4)

- 修正顺序为:先暂存目标(不丢 source)→ 写或暂存 gbrain 页 → 更新 index → 提交目标/删除 source → 完成 journal。
- gbrain put 失败 → 补偿:移除暂存目标副本,source 留在 inbox(无孤儿);记 journal 失败原因,可重试。
- index 更新失败 → 补偿:文件+页已存在,index 缺失为可恢复状态(journal 记录,index 可重试补写)。
- 中断 → 基于 journal 续跑,已完成步骤不重做。

### RE3. Pending write envelope(AC11)

- 定义 typed pending envelope:version、idempotency key、producer、slug、content、status(staged/applied/acked/terminal_failed)、retry_count、created。
- 定义 producer(锁冲突时暂存写入)、applier(锁空闲时应用)、retry、ack、terminal failure 规则。
- 重复 apply 不产生重复事实(幂等);成功/重试/ack/terminal failure 有结构化状态测试。
- envelope 位置:`<filehub>/.jspace-logs/*.APPLY.md`(与现有 scanner 一致);asset-ingest 与 memory-writeback 共用。

### RE4. 统一 batch 日志与 cron verification

- inbox batch 执行日志唯一位置 `<filehub>/.jspace-logs/inbox-batch.md`;skill 写、cron/doctor 读同一文件(已有,保持并测试)。
- ingest journal 与 batch 日志位置统一,不出现 skill 写 A、cron 查 B。

### RE5. project ID 用于 asset path、index、memory slug(R2)

- filehub asset path(`projects/<id>/`)、项目 index、gbrain slug(`assets/<id>/<语义名>`)使用同一 project ID。
- 已注册 project(稳定 id)→ 用 id;未注册 → 显式 fallback(用域/语义名派生)并提示,不静默。
- project id 缺失/不一致时 doctor/ingest 返回结构化报告。

### RE6. 恢复测试或可复跑 fixtures

- gbrain write 失败、index 更新失败、中断、重复/幂等、版本修复 五类均有测试或可复跑 fixture;不触碰真实 filehub/gbrain store。

## 4. Acceptance Criteria

### Release-Blocking

- [ ] **AC-E1 / RE1-RE2**:ingest journal round-trip;同 content hash 同目标重复入库不重复写页(幂等);gbrain put 失败后 source 留 inbox、无孤儿;index 失败可重试;中断续跑不重做已完成步骤。
- [ ] **AC-E2 / RE3**:pending envelope 重复 apply 不产生重复事实;成功/重试/ack/terminal failure 有结构化状态测试;`.APPLY.md` 可被 cron/doctor 现有 scanner 读取。
- [ ] **AC-E3 / RE5**:同一 project ID 解析到 asset path、index、gbrain slug;缺失/不一致返回结构化报告。
- [ ] **AC-E4 / RE4**:inbox batch 日志唯一位置,skill 写、cron/doctor 读同一文件(contract test)。

### Capability

- [ ] **AC-E5 / RE6**:gbrain failure / index failure / interruption / duplicate / version repair 五类 fixture 全绿(纯函数 + 注入 stub,不碰真实环境)。
- [ ] **AC-E6 / RE2**:补偿路径有明确日志与状态;失败原因记入 journal,可安全重试不静默。

## 5. Scope

### In Scope

- ingest journal typed contract + repository + 状态机 + 补偿 + idempotency。
- **`jspace ingest` 命令族**:begin(暂存副本+journal)/ 步骤推进(gbrain/index)/ complete(移除 source)/ fail·rollback(补偿)/ status·list。
- asset-ingest 步骤顺序修正(SKILL.md / batch.md)与 journal 接线。
- pending write envelope typed contract + **`jspace pending` 命令族**(stage 生产者 / list / apply applier / ack / retry / terminal-failure)。
- 统一 batch 日志位置 contract test。
- project ID 对齐(asset path / index / slug)+ 缺失/冲突报告。
- 恢复测试/可复跑 fixtures(gbrain/index/中断/重复/版本修复)。

### Out of Scope

- skill manifest / harness lifecycle(Child D 已完成)。
- scheduler/harness/incidents(Child C 已完成)。
- office 深度抽取本身(deep-extract 已交付;仅保证其日志/指针纪律不破坏 journal)。
- gbrain 自身实现(外部系统;JSpace 只做身份、调用纪律、journal/补偿、pending/recovery)。
- 真实 filehub / gbrain store 的自动写入测试(保持 fixture + 手动验证)。
- 常驻 daemon / 事件网关。
- 六平台 CI / spec 填充(Child F)。

## 6. Constraints & Dependencies

- **依赖 Child A/B/C/D 已落地产物**:`core/contracts/{files,ids,hub}.ts`、`application/workspace/{journal,manifest,doctor}.ts`、`application/automation/{incidents,execute,use-cases}.ts`、`cli/cron.ts findPendingApplies`、`inbox status`、`SkillsManifest`。
- **不降低父任务 Product Invariants**:不增加常驻运行时;外部变更默认可检查(plan/dry-run);本地优先且不泄密;不虚报自动化;语义与机械执行分离(journal/补偿/幂等走 typed code)。
- **不修改真实用户环境**:所有 journal/补偿/pending 测试只发生在临时 fixture 与注入 stub;不触碰真实 gbrain store 或真实 filehub。
- **跨 child 契约**:ingest journal 形状、pending envelope 形状定稿后可被 Child F 引用。
- **现有 173 个测试必须全部保持通过**。
- **gbrain 锁语义**:JSpace 不绕过 serve 锁;pending 是「锁冲突时暂存、锁空闲时应用」的机制。

## 7. Key Decisions

- **journal 是机器 truth**:prose 日志保留给人类,恢复/幂等/补偿判断一律基于 typed journal。
- **顺序修正为「先暂存目标、再写/暂存 gbrain、后提交」**:source 在 gbrain 页成功前留在 inbox(或可恢复),杜绝孤儿。
- **idempotency key = content hash + rel_path**:重复入库检测基于内容与目标,不基于文件名。
- **pending envelope 位置与现有 scanner 一致**(`<filehub>/.jspace-logs/*.APPLY.md`)。
- **project ID 使用已注册 id,未注册显式 fallback + 提示**(不静默、不阻塞)。
- **全机械 CLI(2026-08-04 用户决策)**:新增 `jspace ingest` 命令族(skill 驱动 journal 的机械步骤)+ `jspace pending` 命令族(producer/applier/ack/retry);机械逻辑(暂存副本、移除 source、补偿、幂等、envelope 应用)全部走 typed code,skill 只负责语义决策(目标路径/slug/projectId/index 内容/gbrain 正文)。

## 8. Planning Status

- 本文件为 Child E 最终规划(2026-08-04):证据勘察完成,唯一开放问题(机械深度)已决策为全机械 CLI;`prd.md` / `design.md` / `implement.md` 三件齐备,`implement.jsonl` / `check.jsonl` 已补齐。
- 下一步:用户 review 批准最终规划摘要后 `task.py start` 进入实施(M1 起);父任务保持 planning。
