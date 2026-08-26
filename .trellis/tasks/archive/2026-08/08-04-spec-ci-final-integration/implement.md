# spec/CI/全链最终验收 — Implementation Plan

## Execution Strategy

按里程碑顺序落地(文档/CI/验收),每里程碑保持 `tsc` + 218 tests 绿。M1-M3 为内容与配置,不新增业务逻辑;M4 是全链验收 + 父 AC 映射更新;M5 全量 gate + 提交。

## Milestone Map

### M1 — spec/backend 填充

- [x] `.trellis/spec/backend/directory-structure.md`:真实目录 + 精确依赖方向(硬不变式 + adapters 底层工具层位置 + 过渡态标注,非理想化链)。
- [x] `.trellis/spec/backend/error-handling.md`:`fail()`、diagnostics 解码模式、`CmdResult` 完整形状(含 errors/warnings)、doctor 分级诊断。
- [x] `.trellis/spec/backend/logging-guidelines.md`:prose=人类 payload(注 lock/backup)、结构化 state=机器 truth、`.jspace-logs` 批日志 + APPLY.json、敏感不落日志。
- [x] `.trellis/spec/backend/quality-guidelines.md`:tsc/bun test/freshness 门、CommandSpec 单一来源、混合 DI、decoder + **contract 版本纪律**、**增量所有权模型**、**安全与红线小节**。
- [x] `.trellis/spec/backend/database-guidelines.md`:N/A(gbrain 外部)+ 指向 quality 版本/所有权。
- [x] `.trellis/spec/backend/index.md`:Overview 改真实指南索引。
- [x] Validation:`bunx tsc --noEmit && bun test`。

### M2 — verify.yml + build.yml 补强(R10/AC13/AC14)

- [x] **build.yml**:`gen-version` 移到 `gen-assets` 之前 + tag 断言(修复 bundle_version 陈旧 bug)。
- [x] **gen-assets 确定性**:`scripts/gen-assets.ts` walk 输出 sort。
- [x] Asset freshness 步加入 `cli/skills.generated.ts`。
- [x] scheduler argv round-trip 冒烟:`bun test application/automation/invocation.test.ts application/automation/scheduler.test.ts adapters/harness/argv.test.ts`。
- [x] init 集成扩展为修正后全链:rm -rf → init → doctor → domain → filehub init --register(不另做 resource add filehub)→ resource add --type project → cron run --dry-run(grep 断言)→ cron install --dry-run(grep 断言)→ cron check → cron status(cd)→ workspace diff → workspace upgrade --dry-run。
- [x] **本地先重放修正后全链通过,再落 CI**。
- [x] Validation:本地重放 verify.yml 各步 + build.yml 顺序逻辑核对。

### M3 — 术语统一 + 文档同步

- [x] 术语 grep 基线 + 漂移清单(可能为空);只改确认误用点。
- [x] 逐文档核对(守护):GOAL 运维节(ingest/pending)、README 快速开始、模板 AGENTS(skill targets/.APPLY.json)、PLATFORMS(lifecycle 矩阵核对)、headless-ops(完整路径);全仓 grep 防 `*.APPLY.md` 回退。
- [x] Validation:`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M4 — 全链最终验收 + 父 AC 映射

- [x] 临时工作台修正后全链逐项跑通(§design 4),收集输出。
- [x] 逐项核对父 prd AC1-AC18:每项 **full/partial/遗留** 三态 + Child A-E 证据锚点;真机面(真实 scheduler apply/第二机 binding/真实 gbrain/harness spawn)标 manual + PLATFORMS 矩阵;project 环节显式处置。
- [x] 产出最终 **release-gate 判定**(release-blocking AC 全过 / 列遗留 P0);对账父 implement.md 陈旧 checklist(如 Child E fault-injection 项翻转附锚点)。
- [x] 更新父 `implement.md` 进度行 + Child F checklist。
- [x] Validation:全链输出 + AC 三态映射核对。

### M5 — 全量 gate + 提交

- [x] `bunx tsc --noEmit`、`bun test`、office-extract、gen-assets freshness(含 skills.generated.ts)。
- [x] 提交(逻辑分组:spec / CI / docs+验收)。
- [x] 运行 `trellis-check`。

## Validation Gates

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts && git diff --exit-code cli/assets.generated.ts cli/manifest.generated.ts cli/skills.generated.ts
# 临时工作台全链(init→doctor→domain/resource→filehub→cron dry-run→install dry-run→check→workspace diff)
```

## Rollback Points

- spec 填充与 CI 补强独立提交;CI 变更(verify.yml)可单独回滚不影响代码。
- 术语/文档同步 grep 收敛,不误改 README 权威约定。
- 父 AC 映射更新是文档操作,可逆;勾选附证据锚点。

## Follow-up Before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md` 三件齐备并经用户 review 批准。
- [x] `implement.jsonl` / `check.jsonl` 至少各一条真实 spec/research 条目。
- [x] 父任务 checklist:Child F 在 M4 勾选;父 AC 映射更新后交用户 review 父任务收尾。
