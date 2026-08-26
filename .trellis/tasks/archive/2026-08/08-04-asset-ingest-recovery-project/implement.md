# Asset-ingest journal/补偿 + gbrain pending envelope + project 集成 — Implementation Plan

## Execution Strategy

按里程碑顺序实现,每里程碑保持 `tsc` + tests 绿,不触碰真实 filehub/gbrain store。机械核心(journal 状态机、补偿、envelope)在 application 层可注入测试;skill 接线为步骤修正 + CLI 调用。

## Milestone Map

### M1 — Ingest journal 契约 + 状态机 + 补偿

- [x] `core/contracts/ingest.ts`:`IngestJournalV1` + `IngestStep`/`IngestStatus` + decoder(diagnostics 模式)。
- [x] `application/ingest/journal.ts`:repository(读/写/列表)+ `begin`(sha256 hash + 幂等查重 + 暂存副本 + journal=staged)+ 状态推进(gbrain/index/complete,含非法迁移拒绝)+ `fail`(按状态补偿)+ `rollback`。
- [x] `core/contracts/ingest.test.ts` + `application/ingest/journal.test.ts`:round-trip、状态迁移、**故障注入**(gbrain 失败→补偿移除暂存副本、source 留 inbox 无孤儿;index 失败→failedStep=index 可重试;中断→从记录步骤续跑不重做)、幂等(同 hash+relPath committed→duplicate)。
- [x] Validation:`bunx tsc --noEmit && bun test`。

### M2 — `jspace ingest` 命令族 + project 对齐

- [x] `application/ingest/project.ts`:`resolveProjectId(hub, name)`(已注册 id / 未注册派生 fallback + 提示)。
- [x] `application/ingest/use-cases.ts`:ingest begin/gbrain/index/complete/fail/rollback/status/list 返回 CmdResult。
- [x] `cli/commands/registry.ts`:`ingest` 命令族(CommandSpec 声明式);`begin` 用 resolveProjectId。
- [x] 测试:命令接线、use case 返回契约、resolveProjectId(registered/fallback)、journal.projectId 与 hub 不一致 → warning。
- [x] Validation:`bunx tsc --noEmit && bun test`。

### M3 — Pending envelope 契约 + 生产者/applier/ack

- [x] `core/contracts/pending.ts`:`PendingWriteEnvelopeV1` + `EnvelopeStatus` + decoder。
- [x] `application/pending/envelope.ts`:stage(写 `<filehub>/.jspace-logs/<id>.APPLY.json`)/ list / read / update(status/retry)。
- [x] `application/pending/apply.ts`:applier(GbrainDeps 注入)——dedupe(get 已有同内容→applied)/ put / retry(≤3)/ terminal_failed;重复 apply 跳过 applied/acked/terminal_failed。
- [x] `cli/commands/registry.ts`:`pending` 命令族(stage/list/apply/ack)。
- [x] 测试:envelope decode、stage 写 APPLY.json、**重复 apply 幂等**、dedupe no-op、retry→terminal_failed、ack 停止告警。
- [x] Validation:`bunx tsc --noEmit && bun test`。

### M4 — scanner/文案同步 + skill 接线

- [x] `cli/cron.ts findPendingApplies` / `application/workspace/doctor.ts` 过滤 `.APPLY.md`→`.APPLY.json`;`cli/cron.test.ts` fixtures 更新。
- [x] AGENTS.md / headless-ops.md 中 `*.APPLY.md` 文案改 `.APPLY.json`。
- [x] `skills/asset-ingest/SKILL.md` + `references/batch.md`:步骤顺序修正(先暂存→写/暂存 gbrain→index→complete)+ `jspace ingest`/`jspace pending` 接线 + 「失败留 inbox / 无孤儿」措辞对齐机械补偿。
- [x] `skills/memory-writeback/`:锁冲突 → `jspace pending stage` 接线。
- [x] 统一 batch 日志 contract test(skill 写 `<filehub>/.jspace-logs/inbox-batch.md` 与 cron/doctor 读同一路径)。
- [x] Validation:`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M5 — 全链验证 gate(AC-E1~E6)

- [ ] `bunx tsc --noEmit`、`bun test`、`python3 skills/asset-ingest/scripts/office-extract.test.py`(不回退)。
- [ ] 临时 fixture 全链:构造 inbox 文件 → `ingest begin` → 模拟 gbrain put 失败 → `--fail` → 断言 source 留 inbox、无孤儿 → 重试成功 → `--gbrain --index --complete` → 断言 source 移除、journal=committed → 重复 begin 同文件报 duplicate。
- [ ] pending 全链:`pending stage` → `pending apply`(dedupe/put stub)→ 重复 apply 幂等 → retry 到 terminal_failed → `ack`。
- [ ] 运行 `trellis-check`;更新父任务 implement.md Child E checklist + 父任务 acceptance mapping(AC10/AC11 勾选,标注 Child E 落地)。

## Validation Gates

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts
# 临时 fixture: ingest begin→fail 补偿→重试→complete→幂等; pending stage→apply 幂等→retry→ack
```

## Rollback Points

- 每里程碑独立提交;契约(core/contracts)先于 use case 落地。
- M4 scanner `.APPLY.md`→`.APPLY.json` 与 skill 接线同里程碑(无 producer 现存,安全新基线)。
- skill 步骤修正与 journal 命令同步,避免「skill 改顺序但无 CLI 支撑」中间态。

## Follow-up Before `task.py start`

- [ ] `prd.md` / `design.md` / `implement.md` 三件齐备并经用户 review 批准。
- [ ] `implement.jsonl` / `check.jsonl` 至少各一条真实 spec/research 条目(sub-agent 模式才需;inline 仍补齐)。
- [ ] 父任务 checklist:Child E(pending envelope 已由 Child D 移入)在 M5 勾选;父任务 AC10/AC11 映射标注。
