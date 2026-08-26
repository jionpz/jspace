# spec/CI/全链最终验收 — Technical Design

## 1. Design Objective

闭合父任务发布级质量门:把 `.trellis/spec/backend/` 从模板变成真实约定(供未来子代理/成员对齐),补强既有 CI 为 R10 要求的全链质量门,统一术语并同步文档,最后从 clean checkout 跑全链验收并更新父任务 AC1-AC18 映射。**不新增业务功能,不触碰真实环境。**

## 2. Baseline

| 事实 | 证据 |
| --- | --- |
| spec/backend 6 文件全模板 | `.trellis/spec/backend/*.md` |
| verify.yml 质量门存在,缺 skills.generated.ts freshness + scheduler smoke + 全链 | `.github/workflows/verify.yml` |
| build.yml 6 平台矩阵已发布可用 | `.github/workflows/build.yml` |
| 术语约定在 README 已定义,散落需审计 | `README.md:6-10` + grep |
| 父 AC1-AC18 未勾选;Child A-E 已交付 | 父 `prd.md` §7 |

## 3. spec/backend 内容大纲(以真实代码为准)

每个文件用实际模块/函数作为示例,不用理想化模板:

### 3.1 directory-structure.md

```
core/contracts/   # 纯 decoder(side-effect-free,strict unknown-field,diagnostics 模式)
core/registry/    # effective 合并 + inspect 分级诊断(invalid/unbound/missing/drift)
adapters/         # 底层工具层:fs/workbench-state、harness/argv(被 application 与 cli 共同消费)
application/      # use cases(消费 adapters + 注入端口,返回 CmdResult;非测试不 import cli)
  commands/command.ts   # CommandSpec 框架 + CmdResult
  workspace/ automation/ registry/ ingest/ pending/
cli/              # CommandSpec 树(cli/commands/registry.ts)+ main + generated assets + legacy cron/update
scripts/          # gen-assets/gen-version/build-all(构建期)
skills/ + skills-manifest.json   # workbench skills(manifest 是打包真相源)
templates/        # workbench/filehub 模板(embedded)
```

**依赖方向(硬不变式,非线性链)**:
- `core` 不 import application/adapters/cli。
- `application` 非测试不 import `cli`(generated manifest/journal/readFile 由 cli 注入)。
- `adapters` 只 import `core` + `application/errors`(`adapters/harness/argv.ts:5` 反依赖 errors 是唯一例外)。
- `adapters` 是**底层工具层**,被 application 与 cli 共同消费,不在"cli 之上"。

**过渡态(如实标注)**:platform scheduler install(launchd/crontab/schtasks)与 update 仍走 `cli/cron.ts` / `cli/update.ts` legacy(`cli/commands/registry.ts` 委托 `cmdCron*`);纯 reconciliation 在 `application/automation/scheduler.ts`(workbenchTag + planReconciliation)。`adapters/` 目前无 scheduler adapter(目标态,非现状)。

### 3.2 error-handling.md

- `fail(msg)`(application/errors.ts)抛出错误 → CLI 以非 0 退出并给修复动作(如 `jspace: error: ...`)。
- 契约解码:diagnostics 模式(`isRecord`/`checkNoUnknownFields`/`readRequiredString`/`IssueCollector`),返回 `DecodeResult`;错误码分层(`<file>.<field>.<kind>`,如 `ingest.status.invalid`)。
- `CmdResult` 完整形状:`{ exitCode?, lines, errors?, warnings?, data? }`(errors/warnings 是 stderr 通道,doctor/upgrade 靠它们);doctor/cron-check 用 exitCode 1 表不健康。
- doctor 结构化诊断分级:`severity`(error/warning)+ `code` + `path` + `message`,区分 invalid/unbound/missing/drift,不折叠为同一种错误。
- 运行时状态(ingest journal / incident / pending envelope)是机器 truth;prose 仅人类 payload。

### 3.3 logging-guidelines.md

- 机器状态进 `.jspace/state/`(gitignored,结构化 JSON):`runs/`、`incidents/`、`ingest/`、`upgrades/`、`materialized.json`。
- 人类日志进 `.jspace/logs/cron/<id>/`(prose payload;注:同目录还放 lock(`cron.<id>.lock`)/backup 等运维文件,只有 `state/` 是机器 truth 的唯一归属)。
- filehub 侧:`<filehub>/.jspace-logs/inbox-batch.md`(批执行日志,skill 写、cron 读同一处)+ `<filehub>/.jspace-logs/<id>.APPLY.json`(pending envelope)。
- 敏感信息(密钥/token/provider credential)不落日志/状态/诊断输出(R8)。

### 3.4 quality-guidelines.md

- 门:`bunx tsc --noEmit`、`bun test`、`gen-assets && git diff --exit-code cli/*.generated.ts`(含 skills.generated.ts)。
- CommandSpec 单一来源(name/options/help/handler),不重复 choices/help/switch。
- **混合 DI**:selected ports 注入(generated manifest/journal/readFile/skill context/clock)+ filesystem 经 `adapters/fs` 直接 import;`application` 非测试不 import `cli`。
- decoder 严格 unknown-field;新契约先 typed decoder + round-trip 测试;**contract 版本演进纪律**(每契约带 `version`/`schema_version` + 严格 `*.version.unsupported` 拒绝;内部 schema 变化显式 bump,不静默)。
- **增量所有权模型**(父 R4/AC5 支柱):`ownershipFor`/`AssetOwnership`(现全 managed)、diff 动作 create/no-op/update/conflict/skip/stale、`materialized.json` 作 last-applied base、upgrade plan+journal+rollback(`state/upgrades/<id>`)。
- **安全与红线**(R8):密钥/token/provider credential 不落日志与诊断;bootstrap 不默认执行 `curl|bash`/`irm|iex`(§11:临时文件下载+用户确认);自动化测试不碰真实 home config/scheduler/gbrain store/filehub。
- 测试不碰真实环境:临时 fixture + 注入 stub(ingest/pending 的 fs/gbrain);scheduler 只 plan/rehearsal。

### 3.5 database-guidelines.md

- 标注 **N/A**:JSpace 无本地 DB;gbrain 是外部系统(PGLite 在其进程内),JSpace 只做身份/调用纪律/journal/补偿/pending 恢复。结构化 JSON state 即持久层,版本/所有权约定见 quality-guidelines。

### 3.6 index.md

- Overview 改为真实指南索引,移除「To fill」;表格 status 全绿。

## 4. CI 补强(verify.yml + build.yml)

**build.yml 修复(P1)**:`gen-version` 移到 `gen-assets` **之前** + 构建期断言 `version.generated.ts == tag`。当前顺序 gen-assets 先读提交版 version(如 1.0.2),tag 构建的 `BUNDLE_MANIFEST.bundle_version` 陈旧(v1.0.3 已发货该 bug)。

**gen-assets 确定性(P2)**:`scripts/gen-assets.ts` walk 输出先 sort,防跨文件系统(APFS vs ext4)readdir 顺序差异导致 freshness 假失败/不可复现。

**verify.yml 修改**:

```yaml
- name: Asset freshness (all generated assets)
  run: |
    bun run scripts/gen-assets.ts
    git diff --exit-code -- cli/assets.generated.ts cli/manifest.generated.ts cli/skills.generated.ts

- name: Scheduler argv round-trip + reconciliation smoke (pure)
  run: bun test application/automation/invocation.test.ts application/automation/scheduler.test.ts adapters/harness/argv.test.ts

- name: Full-chain integration (temp workbench, no real env)
  run: |
    rm -rf /tmp/jspace-verify /tmp/jspace-fh
    bun run cli/main.ts init /tmp/jspace-verify
    bun run cli/main.ts doctor --dir /tmp/jspace-verify
    bun run cli/main.ts domain add files --dir /tmp/jspace-verify
    # filehub init --register 自带建域+注册 type=filehub+绑定;勿另做 resource add filehub
    bun run cli/main.ts filehub init /tmp/jspace-fh --register --dir /tmp/jspace-verify
    bun run cli/main.ts resource add acme --domain files --type project --path /tmp/jspace-fh/projects/acme --dir /tmp/jspace-verify
    bun run cli/main.ts cron run inbox-tidy --dir /tmp/jspace-verify --dry-run | grep "dry-run: would run"      # rehearsal: skill-target validate + argv;防静默空跑
    bun run cli/main.ts cron install --dir /tmp/jspace-verify --dry-run | grep "would apply"                    # reconciliation plan
    bun run cli/main.ts cron check --dir /tmp/jspace-verify
    (cd /tmp/jspace-verify && bun run /path/to/cli/main.ts cron status)   # status 不认 --dir,改 cd
    bun run cli/main.ts workspace diff --dir /tmp/jspace-verify
    bun run cli/main.ts workspace upgrade --dir /tmp/jspace-verify --dry-run
```

- freshness 加入 `skills.generated.ts`(Child D 新增)。
- scheduler smoke = `invocation.test.ts`(三平台 argv round-trip 经真实 parser)+ `scheduler.test.ts`(reconciliation create/update/delete/隔离)+ `argv.test.ts`;不 apply 真实 scheduler。
- 全链:去掉与 `filehub init --register` 冲突的 `resource add filehub`(binding `filehub-path` 双写冲突,实锤);project 环节用 `resource add --type project` 承载(无独立 project 命令);补 `workspace upgrade --dry-run`;`cron status` 因不认 `--dir` 改 `cd`;每步 grep 输出断言防"disabled/空跑"假绿。
- 已知限制:verify-install 仅覆盖 3/6 平台(arm/intel 分支无 install 冒烟),标注为已接受。

## 5. 术语统一 + 文档同步

- **术语**(以 README 为权威):JSpace=开发仓库(本 repo);JWorkspace=`jspace init` 生成的工作目录;「工作台/workbench」= JWorkspace 正式命名。**grep 基线 + 漂移清单**(可能为空——实测 JWorkspace 仅出现在 README 定义处,其余为一致正确用法);只改确认误用点,不虚构修正、不为改而改。
- **文档同步(守护性质)**:产品侧 `.APPLY.md` 残留已为零(Child E 已同步);核对以下文档覆盖新契约,防止未来回退:
  - `GOAL.md` 运维节:`jspace ingest`/`jspace pending`、ingest journal 恢复。
  - `README.md` 快速开始:ingest 命令族。
  - 模板 `AGENTS.md`:skill targets(inbox-tidy)、`.APPLY.json`。
  - `docs/PLATFORMS.md`:lifecycle 矩阵(已有 §M4,核对)+ 三平台 scheduler plan 冒烟。
  - `skills/jspace-bootstrap/references/headless-ops.md`(完整路径):ingest journal 恢复、pending apply/ack。
  - 全仓 grep 防 `*.APPLY.md` 回退(守护断言)。

## 6. 全链最终验收 + AC 映射

- 以 verify.yml(本身 clean checkout)为机械证据,本地另跑一次修正后全链(§4)收集各步输出。
- 逐项核对父 prd AC1-AC18,每项三态:**full**(Child A-E 证据锚点 file:line/测试/commit)/ **partial**(如 AC6/7/12/15 的真机面——真实 scheduler apply、第二机 binding AC18、真实 gbrain、真实 harness spawn 标 manual + PLATFORMS 矩阵)/ **遗留**(如 AC14 的 project 无独立命令,以 resource add --type project 覆盖或显式列遗留)。
- 产出:父 `prd.md` §7 勾选(带状态)+ 父 `implement.md` 进度行收尾 + **最终 release-gate 判定**(所有 release-blocking AC 通过 / 列出遗留 P0)。
- 对账父 implement.md 陈旧 checklist(如 Child E fault-injection 项已有测试但未勾选 → 翻转附锚点)。

## 7. Validation

```bash
bunx tsc --noEmit
bun test                 # 218 保持
bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts
python3 skills/asset-ingest/scripts/office-extract.test.py
# 本地临时工作台全链(§4 步骤)逐项通过
```

## 8. Risks & Rollout

- **spec 内容漂移**:内容写真实代码;以 spec 修订为准(Child F 是最后一次对齐窗口)。
- **CI 冒烟误触真实环境**:全链只在 `/tmp` 临时工作台;cron 只用 dry-run/rehearsal;显式不调用真实 scheduler/home/gbrain。注:本地 mac 跑 `cron install --dry-run` 会只读扫描真实 `~/Library/LaunchAgents`(CI 是 ubuntu 不受影响)。
- **全链步骤兼容性**:链步骤间有隐式依赖(binding、资源 id、模板 cron.json 内容),**必须先本地重放修正后链再落 CI**;每步 grep 输出断言防"disabled/空跑"假绿。
- **build.yml 版本顺序**:修复为 gen-version 先于 gen-assets + tag 断言,防止 tag 二进制 bundle_version 陈旧(已发货 bug)。
- **gen-assets 确定性**:walk 输出 sort,防 freshness 假失败。
- **术语改动面**:grep 基线 + 漂移清单(可能为空),只改误用点;模板改动触发 gen-assets 再生成已含于 M3 门。
- **AC 映射主观性**:full/partial/遗留 三态 + 证据锚点 + release-gate 判定,交用户 review。
- **Rollout**:M1 spec/backend 填充 → M2 verify.yml+build.yml 补强 → M3 术语+文档同步 → M4 全链验收+AC 映射 → M5 全量 gate + 提交。
