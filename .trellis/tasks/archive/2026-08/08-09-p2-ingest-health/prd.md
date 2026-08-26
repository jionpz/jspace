# P2-6 ingest journal issues 接入健康面

## Goal

`readJournals()` 已返回 `{records, issues}`,但只有 records 被消费、ingest 的 decode issues 被丢弃,导致手改 `.jspace/state/ingest/` 下 journal 文件损坏、或 ingest 中断未留 incident 时健康面静默。与 pending 的「decode 失败转发」原则不对称,需对称接入所有健康面。

## Requirements

ingest journal 存放于 workbench root 的 `CONFIG_DIR/state/ingest`(`application/ingest/journal.ts:28`),`readJournals(root)` 直接返回 issues —— 各健康面对 workbench root 调用即可(不需要经过 manifest.ts)。

接入 4 处(pending 的对称面):

1. **doctor**:`application/diagnostics/doctor.ts` 加 `checkIngest(reads)` 子函数,把 `readJournals(root)` 的 issues 转成 `RegistryDiagnostic`,severity=warning、code=`ingest.journal_decode`、path=`ingest.<issue.path>` —— 参照 `checkPending` 的 `filehub.pending_decode`。
2. **context**:`application/context/collect.ts` 加 `ingestDamaged: number` 字段(对照 `pendingDamaged`),并加 `deps.readIngestIssues`(注入以便单测);SessionStart hook 上下文据此可加一行提示。
3. **cron check**:`application/automation/status.ts` 的 `cronFailures` 把 ingest issues 聚合进 `stateIssues`(damaged_state),计数进 `needsAttention`。可新增独立的 `ingest_damaged` 或并入现有 damaged_state(实现时选一,保持与 run/incident/pending 同构)。
4. **use-cases**:`application/ingest/use-cases.ts:139` `ingestList` 保持展示 records 语义;若 issues 存在,在 JSON 输出补 `issues` 字段(可选,不改变现有 text 输出)。

回归测试(与 pending 的 `.APPLY.json` 测试对称):往 `.jspace/state/ingest/` 塞一个 malformed JSON 的 journal 文件,断言 doctor / context / cron check 三处都 report。

## Acceptance Criteria

- [ ] doctor 报告 ingest journal decode issues(code=ingest.journal_decode,warning)
- [ ] collect.ts 的 WorkbenchState 含 `ingestDamaged`,通过注入 deps 可测
- [ ] cron check 的 damaged_state 聚合 ingest issues,needs_attention 计数包含它
- [ ] 回归测试:malformed ingest journal → doctor/context/cron check 三处 report(与 pending 测试对称)
- [ ] `bun test` 全绿、`tsc --noEmit` 通过

## Notes

- 不改变 readJournals / decode 逻辑本身,只消费已存在的 issues。
- ingest 的 root 语义是 workbench root(非 filehub root),与 pending 不同 —— 接入时用对参数。
