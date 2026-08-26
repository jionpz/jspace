# spec/CI/全链最终验收

## 1. Goal

在 Child A-E 全部落地后,完成父任务「架构澄清与可持续演进重构」的**发布级组合质量门**(R10 / AC13 / AC14):填充 `.trellis/spec/backend/` 为真实约定、统一术语与同步文档、补强 PR/push CI 质量门、运行从 clean checkout 的全链最终验收并更新父任务 acceptance mapping(AC1-AC18)。完成后父任务四个支柱的跨层契约应可被 CI 持续证明,而非仅靠局部测试。

本任务是父任务 **Child F**(最后一个)。范围限定在 spec 文档、术语/文档同步、CI 补强与最终验收;不再新增业务功能。

## 2. Context(现状基线)

| 事实 | 证据 |
| --- | --- |
| `.trellis/spec/backend/` 6 个文件全部为「To be filled」模板(目录/错误/日志/质量/数据库/index) | `.trellis/spec/backend/*.md` |
| **verify.yml 已有 PR/push 质量门**:tsc / bun test / office-extract / asset freshness / init 集成 | `.github/workflows/verify.yml` |
| **verify.yml freshness 缺口**:只查 `assets.generated.ts` + `manifest.generated.ts`,**缺 Child D 新增的 `skills.generated.ts`** | `.github/workflows/verify.yml` asset freshness 步 |
| **build.yml 已有 6 平台构建矩阵**(3 OS × 2 arch,tag 触发,发布 Release) | `.github/workflows/build.yml` |
| verify.yml init 集成只到 `init → doctor → workspace diff`,未覆盖 R10 的 scheduler argv round-trip / reconciliation plan smoke / 全链 | `.github/workflows/verify.yml` init 步 |
| 术语约定已在 README 定义:JSpace = 开发仓库;JWorkspace = 生成的工作目录;「工作台/workbench」= JWorkspace 正式命名 | `README.md:6-10` |
| 术语散落:JSpace/JWorkspace 出现在 GOAL、templates、skills、docs,需一致性审计 | `grep -rln "JWorkspace\|JSpace"` |
| Child D/E 引入新契约未同步进产品文档:`.APPLY.json`、`jspace ingest/pending` 命令、ingest journal 流程、lifecycle 矩阵、skills manifest | `GOAL.md` / `README.md` / `docs/PLATFORMS.md` 未覆盖 |
| 父任务 prd 18 个 AC(AC1-AC18)全部未勾选;Child A-E 已交付,需逐项核对映射 | 父 `prd.md` §7 |
| 父设计:「父任务持有源需求、跨 child 验收和最终集成」;父任务本身不做大爆炸实现 | 父 `design.md` / `prd.md` §11 |

## 3. Requirements

### RF1. 填充 spec/backend 为真实约定(R10)

- `.trellis/spec/backend/directory-structure.md`:实际目录 + **精确依赖方向**(硬不变式:core 不 import application/adapters/cli;application 非测试不 import cli;adapters 只 import core + application/errors;adapters 是 application 与 cli 共同消费的底层工具层,**不是线性链顶**)。
- `.trellis/spec/backend/error-handling.md`:`fail()` 契约、diagnostics IssueCollector 解码模式、`CmdResult` 完整形状(`{ exitCode?, lines, errors?, warnings?, data? }`)、doctor 结构化诊断分级(invalid/unbound/missing/drift)。
- `.trellis/spec/backend/logging-guidelines.md`:prose 日志 = 人类 payload(注:`.jspace/logs/cron/` 也放 lock/backup 运维文件),结构化 state = 机器 truth(`.jspace/state/` 唯一归属);`<filehub>/.jspace-logs/` 批日志 + APPLY.json;敏感信息不落日志。
- `.trellis/spec/backend/quality-guidelines.md`:tsc / bun test / gen-assets freshness 门(含 skills.generated.ts);CommandSpec 单一来源;**混合 DI**(selected ports 注入 + fs 走 adapters,非全注入);decoder 严格 unknown-field + **contract 版本演进纪律**(`version`/`schema_version` + `*.version.unsupported`);**增量所有权模型**(`ownershipFor`/`AssetOwnership`/diff 动作 create/no-op/update/conflict/skip/stale/`materialized.json`/upgrade journal+rollback);**安全约定小节**(R8:密钥/token/provider credential 不落日志与诊断;bootstrap 不默认执行远程管道;自动化不碰真实 home/scheduler/gbrain/filehub)。
- `.trellis/spec/backend/database-guidelines.md`:标注 N/A(gbrain 为外部系统,无本地 DB);结构化 JSON state 即持久层,指向 quality 的版本/所有权约定。
- `.trellis/spec/backend/index.md`:更新 Overview 为真实指南索引。

### RF2. CI 补强(R10 / AC13 / AC14)

- verify.yml asset freshness 加入 `cli/skills.generated.ts`。
- **build.yml 修复版本嵌入顺序**(P1,实锤 v1.0.3 已发货陈旧 bundle_version):`gen-version` 移到 `gen-assets` 之前 + 构建期断言 `version.generated.ts == tag`(AC13 release 不回退)。
- **gen-assets 确定性**:`scripts/gen-assets.ts` walk 输出排序,防跨文件系统 freshness 假失败。
- verify.yml init 集成扩展为全链冒烟(修正后步骤):`rm -rf` 清理 → init → doctor → domain → **filehub init --register**(自带建域+注册+绑定)**不另做 resource add filehub**(避免 `filehub-path` binding 双写冲突)→ **resource add <project> --type project**(project 环节)→ cron run --dry-run → cron install --dry-run → cron check → workspace diff → **workspace upgrade --dry-run**;`cron status` 因不认 `--dir` 改 `cd` 后执行;每步加输出断言(防静默空跑)。
- 增加 scheduler argv round-trip(`invocation.test.ts` + `argv.test.ts`)+ reconciliation(`scheduler.test.ts`)冒烟。
- 明确 verify-install 覆盖 3/6 平台为已接受限制(arm/intel 分支无 install 冒烟)。

### RF3. 术语统一(R10「统一 JSpace/workbench/JWorkspace 术语」)

- 审计 GOAL / README / templates / skills / docs 中 JSpace、JWorkspace、工作台/workbench 的使用;产出 **grep 基线 + 漂移清单(可能为空,不虚构修正)**;只改确认误用点。

### RF4. 文档同步(守护性质)

- 产品文档/模板/skill 的 Child E 落地已同步 `.APPLY.json`(无残留待清理);RF4 转为**守护**:核对 GOAL / README / 模板 AGENTS / PLATFORMS / headless-ops(完整路径 `skills/jspace-bootstrap/references/headless-ops.md`)覆盖 `jspace ingest`/`jspace pending`、ingest journal 恢复、skill targets、skills manifest;不再引入旧 `*.APPLY.md`。
- 逐文档检查点:GOAL 运维节、README 快速开始、模板 AGENTS、PLATFORMS(lifecycle 矩阵已有,核对)、headless-ops。

### RF5. 全链最终验收 + AC 映射(R10 / AC13 / AC14)

- 从 clean checkout(verify.yml 即 clean checkout)运行临时工作台全链(修正后步骤),不触碰真实环境。
- 逐项核对父 prd AC1-AC18:每项标注 Child A-E 证据锚点(file:line / 测试 / commit);**区分 full / partial / 遗留**——真机行为(真实 scheduler apply、第二机 binding、真实 gbrain、真实 harness spawn)标 manual + PLATFORMS 矩阵;**project 环节显式标注**(无 project CLI 命令,以 resource add --type project 覆盖或列遗留,不静默跳过);产出**最终 release-gate 判定**(所有 release-blocking AC 通过 / 列出遗留 P0)。
- 对账父 implement.md 陈旧 checklist 项(如 Child E fault-injection 项已有测试但未勾选)。

## 4. Acceptance Criteria

### Release-Blocking

- [ ] **AC-F1 / RF1**:`.trellis/spec/backend/` 反映真实约定(目录/错误/日志/质量/**安全**),不再是模板;index 更新;quality-guidelines 含所有权模型 + contract 版本纪律 + 安全小节。
- [ ] **AC-F2 / RF2**:verify.yml freshness 含 `skills.generated.ts`;**build.yml 修复版本嵌入顺序**(gen-version 先于 gen-assets + tag 断言);CI 含 scheduler argv round-trip(invocation+argv 测试)+ reconciliation plan 冒烟 + **修正后**全链 init 集成(无 filehub binding 冲突、含 project/upgrade/status 环节、输出断言,不碰真实环境)。
- [ ] **AC-F3 / RF3**:术语 grep 基线 + 漂移清单产出(可能为空),漂移修正与 README 约定一致。

### Capability

- [ ] **AC-F4 / RF4**:GOAL / README / 模板 AGENTS / PLATFORMS / headless-ops(完整路径)逐文档核对,覆盖新命令/journal/skill targets;无旧 `*.APPLY.md` 引用(守护)。
- [ ] **AC-F5 / RF5**:clean checkout 全链最终验收通过;父 AC1-AC18 映射更新(full/partial/遗留 三态 + 证据锚点 + **release-gate 判定**;project 环节显式处置;真机行为标 manual;Child E 陈旧 checklist 对账)。

## 5. Scope

### In Scope

- `.trellis/spec/backend/` 填充(directory/error/logging/quality/database N/A/index)。
- verify.yml 补强(freshness + scheduler smoke + 全链 init 集成)。
- 术语审计与漂移修正。
- GOAL / README / 模板 AGENTS / PLATFORMS / headless-ops 文档同步(Child D/E 契约)。
- 全链最终验收 + 父任务 AC1-AC18 映射更新。

### Out of Scope

- 新增业务功能或新命令(Child A-E 已交付)。
- 六平台真实 scheduler 自动 apply(保持手动验证矩阵;CI 只做 plan/rehearsal)。
- 真实用户 home 配置 / 真实 gbrain store / 真实 filehub 的自动测试。
- gbrain 自身实现。
- 父任务本身的大爆炸实现(父任务只做最终集成 review)。

## 6. Constraints & Dependencies

- **依赖 Child A-E 已落地产物**:core/contracts、application use cases、CLI CommandSpec、skills manifest、ingest journal、pending envelope、lifecycle 矩阵——spec 内容与文档同步以其为准。
- **依赖既有 CI**:build.yml(6 平台)+ verify.yml 已存在;Child F 补强而非重建。
- **不降低父任务 Product Invariants**:不引入常驻运行时;CI 冒烟不触碰真实 scheduler/home/gbrain/filehub;不虚报自动化(CI 能验证的标 automated,真机行为进手动矩阵)。
- **术语以 README 为权威**(JSpace=开发仓库、JWorkspace=生成工作目录、工作台/workbench=JWorkspace)。
- **现有 218 个测试必须保持通过**。

## 7. Key Decisions

- **spec/backend 以真实约定为准**:内容来自当前代码(core→application→adapters→cli 依赖方向、fail()/diagnostics、CmdResult、结构化状态),不写理想化模板。
- **CI 补强而非重建**:verify.yml 已覆盖 tsc/unit/freshness/init;补 skills.generated.ts freshness + scheduler smoke + 全链 init。
- **全链验收在临时工作台**:AC14 的 CI 化,不触碰真实环境;scheduler 只做 plan/rehearsal(纯函数/dry-run)。
- **术语以 README 为准**:JSpace=开发仓库;JWorkspace=生成的工作目录;工作台/workbench=JWorkspace 正式命名。
- **父任务收尾**:Child F 运行全链验收并更新父 AC 映射后,父任务作为协调任务的职责完成,交由用户 review 后归档(父任务不做大爆炸实现)。

## 8. Planning Status

- 本文件为 Child F 规划(2026-08-04);证据勘察完成,范围由父 R10/AC13/AC14 与既有 CI 现状确定,无阻塞性开放问题。
- 下一步:完成 `design.md` + `implement.md`,走收敛 gate,提交最终规划摘要待批准。
- 父任务 artifacts:`prd.md` / `design.md` / `implement.md` 存在;父任务保持 planning。
