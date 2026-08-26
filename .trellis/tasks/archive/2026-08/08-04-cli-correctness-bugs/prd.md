# CLI 正确性 bug:cron split-brain + 二进制 contentHash

## Goal

修架构诊断(2026-08-04)发现的两个 CLI 层正确性 bug。均属代码层,与 sibling 任务 `08-04-skills-medium-model-refactor`(纯 skill/文档)不交叉。可直接 break,无迁移通道(用户决策)。

## Scope

**In scope**:`cli/` + `core/` + `application/` + `adapters/` 的 TS 源码。
**Out of scope**:skills、templates/workbench 正文、记忆/gbrain 上游、新增 CLI 功能。

## Background — 两个正确性 bug(来自通读全部代码的诊断,证据带 file:line)

### Bug A:cron 调度器 split-brain(最严重)
两套 cron 安装实现并存且不一致:

- **新 reconciliation 引擎只接了 dry-run**:`cli/commands/registry.ts:284-321` 里 dry-run 调 `cronInstall(...,true,{apply:()=>[]})`,非 dry-run 直接 `cmdCronInstall()`(走 legacy `cli/cron.ts`)。于是 `application/automation/use-cases.ts:121-125` 的真实 `deps.apply(ops)` 分支**生产不可达**,`apply` 是 stub `()=>[]`(`registry.ts:317`)。
- **taskId 三处不一致**:`application/automation/scheduler.ts:6` 注释说 `com.jspace.cron.<tag>.<id>`(带 workbench tag);darwin 实际 `cli/cron.ts:50,84` plist Label = `com.jspace.cron.${id}.plist`(**不带 tag**);dry-run 组装 `registry.ts:293` 用 `${tag}:${c.id}`。三者永不匹配 → dry-run 的 `planReconciliation` 永远输出「全 create+全 delete」(预览错误)。
- **跨工作台覆盖(真实 bug)**:darwin 上 plist 名只含 cron id,两个工作台都有 `inbox-tidy` 时**互相覆盖 `~/Library/LaunchAgents/com.jspace.cron.inbox-tidy.plist`**。`installedCronIds`(`cli/cron.ts:184-187`)darwin 分支不过滤 root。win32 用 `shortHash(root)`(hash 路径,`cli/cron.ts:199,246`),新模型用 `workbenchTag(workbench_id)`(hash id,`scheduler.ts:30`)——输入都不同。
- **校验门不一致**:`validateSkillTargets` 只在 dry-run 跑(`use-cases.ts:109-112`);真实 install `cmdCronInstall`(`cli/cron.ts:276`)**不做** skill 校验。

### Bug B:二进制资产 contentHash 算错
`application/ingest/journal.ts:143` `sha256Of(readFileSync(plan.source,"utf-8"))` —— 把源文件按 **utf-8 文本**读入再哈希。对 PDF/PPTX/XLSX(filehub 的全部意义)utf-8 解码**有损**(非法字节→U+FFFD),得到的 contentHash**不是文件真实 sha256**,且整文件进内存。jspace 内部 dedupe 自洽(同一有损变换),但语义错误 + 大文件内存风险。

## Requirements

### R1 — 收敛 cron 调度到单一实现(Bug A)
- 以 `application/automation` 为唯一实现;`cli/cron.ts` 的 launchd/crontab/schtasks 三 backend 下沉为 `adapters/scheduler/{darwin,linux,win32}.ts`,实现统一 `inspect/apply` 接口喂给 `planReconciliation`。
- taskId 全平台统一为 `com.jspace.cron.<workbenchTag>.<id>`(darwin 补上 tag),消除跨工作台覆盖 + dry-run 误导。
- 真实 install 也走 `validateSkillTargets`(校验门一致)。

### R2 — 修二进制 contentHash(Bug B)
- `journal.ts:143` 改为对**字节**哈希(`readFileSync(source)` 不带 encoding 得 Buffer,`createHash("sha256").update(buf)`);大文件用 `fs.createReadStream` 流式。

### R3 — 补测试覆盖(诊断发现的盲区)
- `application/automation/execute.ts`(spawn/timeout/lock/suspect/batch-guard)零测试 → 利用现成 `ExecuteDeps` 写注入式单测。
- 真实 install/uninstall(`installDarwinCrons`/`installLinuxCrons`/`installWindowsCrons`)无覆盖 → 至少加 reconcile 的纯函数覆盖(plFromTaskId / install/remove 幂等)。

### R4 — 卫生项(P2-P5,顺手)
- 抽 `application/shared`(或 `core/util`)收敛重复工具:时间戳 helper(×7)、`isFile`(×3)、`shortHash` vs `workbenchTag`(同码不同义,合并并讲清输入)。
- `todaySuccess`(`execute.ts:59-70`)改读结构化 runs 而非 grep prose `"status: ok"`(拆双事实源)。
- `readJournal`/`readEnvelope` 抛 `CliError`/map 成 `fail()`,避免用户错误打 stack。
- 给 `cli/cron.ts` 顶部加注释「我才是真实 install 路径」(直到被 R1 重构掉)。

## Constraints

- **可直接 break**:cron taskId 改名会让已装任务变「陈旧（stale）」——install 时靠 reconcile 的 delete 分支清理(rehearsal gate 先跑一次 `cron install --dry-run` 确认清理计划),无独立迁移通道。不做 hub schema 迁移。
- **不破坏 sibling skill 任务**:本任务动 cli/core/application/adapters TS 源;不动 `skills/`、`templates/workbench/` 正文、`gen-assets` 渲染(那属 skills 任务)。两任务并发时注意 `cli/*.generated.ts` 不在双方改动面交集(均只读)。
- **验证闭环**:`bunx tsc --noEmit` + 全量 `bun test` 通过;跨工作台 name-collision 加单测;二进制哈希加一个 PDF/XLSX fixture 单测。

## Acceptance Criteria

- [ ] AC1:darwin 上两个工作台各装 `inbox-tidy` 后,`~/Library/LaunchAgents/` 下两 plist 互不覆盖(taskId 含 workbenchTag);`cron install --dry-run` 输出与真实 install 计划一致(dry-run 不再永远「全 create+全 delete」)。
- [ ] AC2:`validateSkillTargets` 在真实 install(非仅 dry-run)执行。
- [ ] AC3:`journal.ts` contentHash 对 PDF/XLSX fixture 等于该文件 `shasum -a 256` 值(字节级正确);大文件路径不整文件进内存(流式)。
- [ ] AC4:`automation/execute.ts` 有注入式单测(timeout 分支 / `todaySuccess` 跳过 / 锁占用 / suspect / batch-stale 各一例)。
- [ ] AC5:`bunx tsc --noEmit` + `bun test` 全绿。
- [ ] AC6:统一调度实现后,`cli/cron.ts` legacy install 路径删除或下沉为 adapter(单一实现)。

## Key Decisions(规划留痕)

- **与 skills 任务剥离(2026-08-04)**:两个 CLI bug 是本次架构诊断的重要发现,但属 CI 业务代码,重写面大;另开任务避免拖累 skills 任务的时间盒。两任务可并行(改动面不交叉)。
- **尚需 design(后续补)**:cron 重构涉及 taskId 命名契约、reconcile delete 分支、adapter 接口签名 —— 本 PRD 定范围与 AC,`design.md`/`implement.md` 在真正开工时再写(本任务先立案追踪)。
- 对齐依据:GOAL.md(cron 是「定时」支柱,无头执行靠调度正确)、AGENTS.md(开发工作流:可 break、无兼容负担)、sibling 任务 `08-04-skills-medium-model-refactor`(不交叉)。
