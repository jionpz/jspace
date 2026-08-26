# 架构澄清与可持续演进重构 — Implementation Plan

## Execution Strategy

本任务作为父任务，不直接启动大爆炸式实现。批准后按以下 child tasks 顺序创建、规划、实施和验收；每个 child 都应保持主干可运行，并以独立 acceptance criteria 收口。

**进度（2026-08-04）**：Child A 已完成（`29117d3`）；Child B 已完成（`2d75214`→`eb3b026`）；Child C 已完成（`9da28cd`→`953293f`）；Child D 已完成并提交（`9e696ef`/`0784fcc`/`a461d37`）；Child E 已完成并提交（`20fa5f0`/`7454261`/`5edc12a`）；**Child F 已完成并提交（`5f13bc0`/`490e8e5`/`02d96c0`/`4adb5b9`/`583f6b5`/`5a8374b`/`f951e3f`）**：spec/backend 填充 + build.yml 版本顺序修复（v1.0.4 bundle_version 修复闭环）+ gen-assets 确定性 + verify.yml 全链 CI + 术语/文档同步 + 全链验收 + AC1-AC18 映射 + **v1.0.4 发布验证**（`jspace 1.0.4` + template_version 1.0.4,6 平台 Release）+ P1 崩溃窗口修复（原子写 + commit 先持久化）。**A-F 全部交付,父任务已归档收尾。**（注：AC7 真实 apply 未接线 workbench tag 为已知遗留,非 manual 缺口;release-gate 已知遗留清单见父 prd §7。）

## Child Task Map

### Child A — Core contracts and portable/local state

> 状态：✅ 已完成（2026-08-04，提交 `29117d3`）。原子任务目录已归档，父任务 children 引用已摘除。

- [x] 建立 hub v4、local binding、project、marker/manifest typed schemas。
- [x] 把 registry load/save/doctor 改为 effective registry（portable + local）模型。
- [x] 新增 project 最小实体与 drift checks。
- [x] 更新模板 `.gitignore` 和中性 fixtures。
- [x] 验证 schema round-trip、missing binding、multi-machine path fixtures。

**交付核对（2026-08-04 review）**：`core/contracts/{hub,local,workbench,distribution,ids,paths,diagnostics,files}.ts`（纯 decoder）；`core/registry/{effective,inspect}.ts`（effective 合并 + inspect 分级诊断，区分 invalid/unbound/missing/drift）；`adapters/fs/workbench-state.ts`（marker/local 原子写）；`cli/init.ts` 写 marker v1 + local v1；模板 `.gitignore` 忽略 local/logs/state；测试 95 个。遗留：multi-machine fixture（同一 portable hub 绑定两台本机路径通过 doctor）需在 Child B/E 补显式验证。

Validation gate（已于 `29117d3` 通过）：

```bash
bunx tsc --noEmit
bun test
bun run cli/main.ts init <temp-workbench>
bun run cli/main.ts doctor --dir <temp-workbench>
```

Rollback point: schema/template 变更独立提交；若 application/CLI 尚未完成，保留兼容 fixture adapter 仅用于开发迁移测试，不形成公共兼容承诺。

### Child B — CommandSpec, application layer, workspace upgrade

- [ ] 建立 declarative CommandSpec 和共享 workspace context。
- [ ] 将 init/doctor/domain/resource/project handlers 迁入 application use cases。
- [ ] 统一 structured result、JSON output、exit codes 和 dry-run contract。
- [ ] 生成 embedded asset/skill manifest，并增加 freshness check。
- [ ] 实现 `workspace diff`、upgrade plan、conflict detection、apply journal 和 recovery fixture。
- [ ] 明确 managed/seed/user ownership，禁止 `init --force` 充当升级命令。

Validation gate:

```bash
bunx tsc --noEmit
bun test
# clean init + old fixture diff/upgrade + doctor
```

Rollback point: parser/command migration按命令族分批落地；旧 parser 仅在同一 child 内短期并存，最终删除重复 help/choice/switch。

### Child C — Cron invocation, scheduler reconciliation, incidents

- [ ] 抽出 CronRunInvocation 和 scheduler/harness adapter interfaces。
- [ ] 修复位置参数/`--id` 断裂，并为三 backend 建 argv round-trip tests。
- [ ] 为所有平台引入 workbench-scoped scheduler identity。
- [ ] 实现 inspect/plan/apply reconciliation，删除 disabled/deleted/stale tasks。
- [ ] 实现 rehearsal、force/retry、enable/disable、ack/resolve。
- [ ] 将 prose log 状态迁移为 runs/incidents structured metadata。
- [ ] 修正 inbox batch verification 使用唯一日志契约。

Validation gate:

```bash
bun test cli/cron*.test.ts
# parser round-trip for darwin/linux/win32 generated argv
# reconciliation pure tests; no host scheduler mutation
```

Rollback point: backend-by-backend adapter commits；真实 install apply 在所有 pure/fixture tests 通过后再开放。

### Child D — Skill manifest and daily operations closure

- [x] 把 bootstrap、asset-ingest、memory-recall、memory-writeback 纳入 required bundle manifest。
- [x] 明确 harness-config 的 global scope、安装/升级路径和依赖关系。
- [x] 修复所有 workbench 内不可达的 docs/reference 路径。
- [x] 将默认 cron 任务改为 versioned skill targets；保留显式 custom prompt escape hatch。
- [x] 建立 harness lifecycle capability matrix，并实现/验证声称 automated 的 hooks。
- [ ] 修复 bootstrap 远程安装审批与 gbrain version compatibility。

> 2026-08-04 交接修正：pending write envelope（producer/apply/ack/retry contract）不属 Child D，已移入 Child E checklist（与 Child C prd Out of Scope「本任务仅保留 APPLY.md 扫描」、父 prd AC11/R7 一致）。Child D skills ownership 由 seed 修订为 managed（专家 review 定案），upgrade 可刷新未修改 skill。

Validation gate:

```bash
# init temp workbench
# compare manifest ↔ materialized skills ↔ AGENTS resolver rows
# verify every referenced file exists
# run harness config generation/validation fixtures without touching user configs
```

Rollback point: skill source和bundle manifest同提交；禁止出现“模板先声明、bundle 后补”的中间状态。

### Child E — Asset ingest recovery and project integration

- [x] 定义 ingest plan/journal/idempotency key。
- [x] 定义 pending write envelope、producer/apply/ack/retry contract（2026-08-04 由 Child D checklist 移入，对齐父 prd AC11/R7）。
- [x] 修正移动、gbrain put、index update 的顺序与补偿。
- [x] 统一 batch log 与 cron verification 路径。
- [x] 将 project ID 用于 asset path、index 和 memory slug。
- [x] 增加 gbrain failure/index failure/interruption/duplicate/version repair tests或可复跑 fixtures（2026-08-04 对账：已由 `application/ingest/journal.test.ts` 故障注入 + `application/pending/apply.test.ts` 覆盖）。

Validation gate:

```bash
python3 skills/asset-ingest/scripts/office-extract.test.py
# ingest fault-injection fixtures
# inbox/filehub/index/gbrain stub state assertions
```

Rollback point:真实文件移动逻辑必须先有 dry-run 与 fixture；不得使用真实用户 filehub 做自动测试。

### Child F — Specs, documentation, CI, final integration

- [x] 填充 `.trellis/spec/backend/` 的真实目录、错误、日志和质量约定。
- [x] 统一 JSpace/workbench/JWorkspace 术语。
- [x] 同步 GOAL、README、模板 AGENTS、PLATFORMS、HEADLESS-OPS。
- [x] 增加 PR/push CI：type-check、unit、asset freshness、init integration。
- [x] 保留 tag release 六平台 build/install matrix，并启用安全的 scheduler argv/reconciliation smoke。
- [ ] 运行全链最终验收并更新父任务 acceptance mapping。

Final validation gate:

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts
git diff --exit-code cli/assets.generated.ts
# temporary workbench full integration flow
```

## Cross-Child Review Gates

- [x] Child A schema/API 经 review 后，B/C/D/E 才可依赖（2026-08-04 review 已达成，见 Child A 交付核对）；后续若变更需回到 parent design 更新。
- [ ] Child B upgrade ownership model经 fixture 验证后，D 才接入 skill upgrades。
- [ ] Child C structured incident/pending locations定稿后，D/E 使用同一契约。
- [ ] 每个 child 完成时运行 trellis-check；最后由父任务做一次跨层 integration review。
- [ ] 不在任何 automated test 中修改真实用户 home harness config、真实 scheduler 或真实 filehub。

## Pre-Start Checklist

- [ ] 用户已审阅并批准本 task 的 Goal、In/Out Scope、Acceptance Criteria、Key Decisions。
- [ ] 批准后创建 child tasks，并为第一个 child 单独完成 PRD/design/implement。
- [ ] 父任务保持 planning，不直接 `task.py start`；只启动拥有下一个可验证交付物的 child。

