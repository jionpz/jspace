# P2-6 ingest journal issues 接入健康面 —— implement

## Checklist(按序)

- [ ] 1. `application/diagnostics/doctor.ts`:`import { readJournals } from "../ingest/journal.ts"`;新增 `checkIngest(root: string): RegistryDiagnostic[]`,把 `readJournals(root).issues` 映射为 `{ severity: "warning", code: "ingest.journal_decode", path: "ingest." + issue.path, message: "ingest journal unreadable: " + issue.message }`;在 `doctorWorkbench` 的 diags 数组加入 `...checkIngest(root)`。
- [ ] 2. `application/context/collect.ts`:
  - `WorkbenchState` 加 `ingestDamaged: number`;
  - `CollectDeps` 加 `readIngestIssues: (root: string) => { issues: ContractIssue[] }`(或 `readJournals` 类型,返回 `{records, issues}`,实现时只取 issues);
  - `realDeps.readIngestIssues = (root) => readJournals(root)`(import from ../ingest/journal.ts);
  - `collectWorkbenchState` 初始化 `ingestDamaged: 0`,在 filehub 段之外新增一个 try 块 `state.ingestDamaged = deps.readIngestIssues(root).issues.length`;
  - 同步更新 `collect.test.ts` 的 deps stub(补 `readIngestIssues`)。
- [ ] 3. `application/automation/status.ts`:`import { readJournals } from "../ingest/journal.ts"`;`cronFailures` 里 `const ingestIssues = readJournals(root).issues;`,`stateIssues = [...runIssues, ...incidentIssues, ...pending.issues, ...ingestIssues]`。`ingestDamaged` 可并入现有 `damaged_state`(不改 data 形状)。
- [ ] 4. `application/ingest/use-cases.ts:139`:`ingestList` JSON 分支输出 `{ journals, issues }`(若 `readJournals(root).issues.length > 0`);text 分支不变。
- [ ] 5. 回归测试:新增用例往临时 workbench 的 `.jspace/state/ingest/` 写一个 malformed JSON(如 `bad.json` 内容非对象),断言:
  - doctor `doctorWorkbench(root, stubDeps).data.diagnostics` 含 code=ingest.journal_decode;
  - collect `collectWorkbenchState(root, deps)` 的 `ingestDamaged === 1`;
  - cron check `cronFailures(root)` 的 `data.summary.damaged_state ≥ 1` 且 `needs_attention` 含它。
  - 参照现有 pending `.APPLY.json` 损坏测试的写法位置(doctor.test.ts / collect.test.ts / status.test.ts)。
- [ ] 6. `bun test` 全绿、`bunx tsc --noEmit`。

## 验证命令

```bash
bun test 2>&1 | tail -5
bunx tsc --noEmit
```

## Review gate

- 三处健康面(doctor/context/status)都消费同一 `readJournals(root).issues`,无重复读取逻辑分歧。
- ingest root 用 workbench root(非 filehub root)—— review 时重点核对参数。

## 回滚

- 纯新增健康面报告,不触碰 readJournals/decode;单 commit 可 revert。
