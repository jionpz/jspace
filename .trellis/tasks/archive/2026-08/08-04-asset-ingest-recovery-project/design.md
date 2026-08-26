# Asset-ingest journal/补偿 + gbrain pending envelope + project 集成 — Technical Design

## 1. Design Objective

把 asset-ingest 从「移动→写 gbrain→登记 index 的 prose 纪律」收敛为 **typed ingest journal + 机械补偿 + idempotency**,把 gbrain 锁冲突的 pending write 收敛为 **typed pending envelope + 机械 applier**,并把 project ID 对齐 asset path / index / slug。

1. **Ingest journal**:每份文件一个 `IngestJournalV1`,记录 plan(source/target/slug/projectId/indexEntry/contentHash)+ 步骤状态机;`jspace ingest` 命令驱动机械步骤(暂存副本、推进、提交移除 source、失败补偿),skill 只做语义决策与 gbrain 正文。
2. **Pending envelope**:`PendingWriteEnvelopeV1` + `jspace pending` 命令族(producer stage / applier apply / ack / retry / terminal-failure);锁冲突时暂存,锁空闲时机械应用,重复 apply 幂等。
3. **顺序修正(F4)**:先暂存目标(不丢 source)→ 写/暂存 gbrain → 更新 index → 提交(移除 source)。任一步失败有明确补偿,无孤儿。
4. **project 对齐(R2)**:asset path / index / gbrain slug 用同一 project ID;未注册显式 fallback + 提示。

不增加常驻运行时;不触碰真实 filehub / gbrain store;所有机械逻辑可注入测试。

## 2. Baseline(confirmed,行号 2026-08-04 实测)

| 事实 | 证据 |
| --- | --- |
| **F4**:skill 先移动(步骤2)再写 gbrain(步骤3);put 失败 → 文件已在目标、无页 → 孤儿;「失败留 inbox」无机械补偿 | `skills/asset-ingest/SKILL.md:30-39`;`references/batch.md:24` |
| 批量 `.processing` 是瞬态锁,无 per-file journal | `references/batch.md:26-28` |
| pending APPLY **只有 scanner,无 producer**:cron/doctor 扫 `<filehub>/.jspace-logs/*.APPLY.md`,无任何命令写它 | `cli/cron.ts:389-397`;`application/workspace/doctor.ts:76-80` |
| asset-ingest 对 serve 锁仅「按提示处理」;memory-writeback 无锁暂存路径 | `skills/asset-ingest/SKILL.md:19`;`skills/memory-writeback/SKILL.md` |
| 无 `jspace ingest` / `jspace pending` 命令;`inbox status` 只读 | `cli/commands/registry.ts` |
| project id 已有 typed 契约 + inspect drift,但 skill 用自由命名 | `core/contracts/hub.ts`;`references/filing.md:21-23,52-55` |
| batch 日志已统一 `<filehub>/.jspace-logs/inbox-batch.md`(skill 写、cron 读);Child C 已闭合 cron 侧 | `references/batch.md:55`;`cli/cron.ts:127` |
| 父设计 §10:journaled sequence(validate→stage target→write/stage gbrain→update index→commit/remove source→complete) | `.trellis/tasks/08-03-*/design.md` §10 |
| 现有 runs/incidents 状态在 `.jspace/state/`(gitignored);prose 日志保留为人类 payload | `application/automation/{runs,incidents}.ts` |

## 3. Target Architecture

```text
core/contracts/
  ingest.ts        # IngestJournalV1 + decoder(plan + 步骤状态机)
  pending.ts       # PendingWriteEnvelopeV1 + decoder
application/ingest/
  journal.ts       # journal 仓库(读/写/推进/补偿)+ 幂等(content hash 查重)
  project.ts       # resolveProjectId(hub) —— 已注册 id / 派生 fallback
application/pending/
  envelope.ts      # 仓库:stage/list/read/update(status/retry)
  apply.ts         # applier:dedupe(gbrain get)→ put → applied;retry → terminal_failed(gbrain 注入)
cli/commands/registry.ts   # ingest + pending 命令族(CommandSpec 声明式)
cli/ingest.ts? → application/ingest use cases
cli/pending.ts?  → application/pending use cases
skills/asset-ingest/{SKILL.md,references/batch.md}  # 步骤顺序修正 + journal 接线
skills/memory-writeback/                             # 锁冲突时调 jspace pending stage
```

状态位置:
- **ingest journal**:`.jspace/state/ingest/<id>.json`(workbench state,gitignored,机器 truth)。
- **pending envelope**:`<filehub>/.jspace-logs/<id>.APPLY.json`(与现有 scanner 位置一致;内容由 `.APPLY.md` 改 JSON 契约)。
- **batch 日志**:`<filehub>/.jspace-logs/inbox-batch.md`(唯一,F3 已闭合,contract test 钉住)。

依赖方向不变:`core/contracts` 无副作用;`application/*` 消费注入依赖;`cli/*` 接线。

## 4. IngestJournal 契约(core/contracts/ingest.ts)

```ts
export type IngestStep = "staged" | "gbrain" | "index" | "committed";
export type IngestStatus = IngestStep | "failed";

export interface IngestJournalV1 {
  version: 1;
  id: string;            // uuid
  source: string;        // inbox 文件绝对路径
  target: string;        // 暂存目标绝对路径(filehub 内)
  relPath: string;       // 相对 filehub 根(换机可移植指针)
  slug: string;          // gbrain slug assets/<projectId>/<semantic>
  projectId: string;     // resolveProjectId 结果
  contentHash: string;   // idempotency key(sha256 of source)
  status: IngestStatus;  // 最高已完成步骤;failed 时记录失败点
  failedStep?: IngestStep;
  failureReason?: string;
  indexEntry?: string;   // 计划写入 index.md 的一行
  createdAt: string;
  updatedAt: string;
}
```

decoder 用 diagnostics 模式(strict unknown-field)。`status` 反映已机械完成的最高步骤:`staged`(副本已建)→ `gbrain`(页已写/已暂存)→ `index`(index 已更新)→ `committed`(source 已移除)。

## 5. Ingest 状态机与补偿(application/ingest/journal.ts)

```ts
/** 机械步骤;注入 fs 以便故障注入测试。 */
export interface IngestDeps {
  copyFile: (src: string, dst: string) => void;   // begin: 暂存副本
  unlink: (p: string) => void;                     // 补偿/提交
  exists: (p: string) => boolean;
  readFile: (p: string) => string;
  now: () => string;
}
```

`jspace ingest begin <file> --target <path> --slug <slug> --project <id> [--index <line>]`:

1. `contentHash = sha256(source)`;查 journal:已存在 `committed` 且同 hash+relPath → 报告 duplicate(幂等跳过)。
2. `copyFile(source, target)`(暂存;source 保留在 inbox)。
3. 写 journal(status=staged)。

`jspace ingest <id> --gbrain|--index|--complete`:
- `--gbrain`:status=gbrain(前提 status==staged)。
- `--index`:status=index(前提 status==gbrain)。
- `--complete`:`unlink(source)`(移除 inbox 源),status=committed(前提 status==index)。

`jspace ingest <id> --fail <reason>`:按当前 status 补偿:

| 失败时 status | 补偿 | 结果 |
| --- | --- | --- |
| staged(gbrain put 失败)| `unlink(target)`(移除暂存副本)→ source 留在 inbox,无孤儿 | status=failed,可重试 |
| gbrain(页已写,index 失败)| 无破坏性补偿;记录 failedStep=index | status=failed,index 可重试补写 |
| index(提交前中断)| 无破坏性补偿;source 仍在 inbox | status=index(中断续跑从 gbrain 后继续)|

`jspace ingest <id> --rollback`:显式放弃 → 按 status 撤销(未 committed 则 `unlink(target)`;若 source 已在 inbox 保留则无事)。

**中断续跑**(batch 下一轮):对 `status != committed && != failed` 的 journal:source 在 inbox → 从记录步骤继续;source 缺失且未 committed → rollback 恢复。**已完成步骤不重做**(幂等)。

## 6. PendingWriteEnvelope 契约(core/contracts/pending.ts)

```ts
export type EnvelopeStatus = "staged" | "applied" | "acked" | "terminal_failed";

export interface PendingWriteEnvelopeV1 {
  version: 1;
  id: string;            // uuid
  idempotencyKey: string;// sha256(content)(重复 apply 判重)
  producer: string;      // asset-ingest | memory-writeback
  slug: string;          // 目标 gbrain slug
  content: string;       // 完整页 markdown(frontmatter + body)
  status: EnvelopeStatus;
  retryCount: number;
  createdAt: string;
  appliedAt?: string;
  error?: string;
}
```

- 文件位置:`<filehub>/.jspace-logs/<id>.APPLY.json`(JSON 内容 = 契约;现有 scanner `*.APPLY.md` 过滤改为 `*.APPLY.json`)。

## 7. Pending 生产者 / applier / ack(application/pending/)

```ts
export interface GbrainDeps {         // 注入,测试用 stub
  get: (slug: string) => { ok: boolean; content?: string };
  put: (slug: string, content: string) => { ok: boolean; error?: string };
}
```

- **producer**(`jspace pending stage <slug> --content <file> --producer <name>`):写 `<filehub>/.jspace-logs/<id>.APPLY.json`,status=staged,idempotencyKey=sha256(content)。skill 在 gbrain 锁冲突时调用。
- **applier**(`jspace pending apply [<id>]`):对 staged envelope:
  1. dedupe:`gbrain.get(slug)` 已存在且内容一致 → 直接 applied(幂等,不重复写)。
  2. 否则 `gbrain.put(slug, content)` → 成功 applied;失败 retryCount++、`error` 记录;`retryCount >= MAX(3)` → terminal_failed。
  3. **重复 apply**:`applied`/`acked`/`terminal_failed` 的 envelope 跳过(幂等)。
- **ack**(`jspace pending ack <id>`):terminal_failed → acked(证据保留,不再告警)。`cron check`/doctor 继续列出 pending(未 applied/acked)但 acked 不再算 actionable。
- **retry**:`apply` 重跑自然重试 staged(含失败过的,retryCount 递增)。

## 8. Project ID 对齐(application/ingest/project.ts)

- `resolveProjectId(hub, name)`:`hub.json` 中 `type: project` resource 的 id(name 精确/别名匹配)→ 返回已注册 id;未找到 → 派生稳定 id(slugify name)+ 返回 `{ id, registered: false }`,调用方提示「project 未注册,用派生 id,建议 jspace project add 注册」。
- `jspace ingest begin` 用 `resolveProjectId` 结果写 journal.projectId;skill 用同一 id 构造 target path(`projects/<id>/`)、slug(`assets/<id>/<semantic>`)、index 登记行。
- doctor/inspect:journal.projectId 与 hub 注册不一致 → 结构化 warning。

## 9. CLI 命令族(cli/commands/registry.ts,CommandSpec 声明式)

`jspace ingest`:

| 命令 | 动作 |
| --- | --- |
| `ingest begin <file> --target <path> --slug <slug> --project <id> [--index <line>]` | 查重 → 暂存副本 → journal(staged),输出 journal id |
| `ingest <id> --gbrain` / `--index` | 推进状态(前提状态正确) |
| `ingest <id> --complete` | 移除 source → committed |
| `ingest <id> --fail <reason>` | 按状态补偿 → failed |
| `ingest <id> --rollback` | 显式放弃(撤销暂存副本) |
| `ingest <id> --status` / `ingest --list [--json]` | 报告/列出 journal |

`jspace pending`:

| 命令 | 动作 |
| --- | --- |
| `pending stage <slug> --content <file> --producer <name>` | 写 APPLY.json 信封 |
| `pending list [--json]` | 列 pending(含 status/retry) |
| `pending apply [<id>]` | 机械应用(dedupe → put → applied;retry → terminal_failed) |
| `pending ack <id>` | terminal_failed → acked |

- 全部经 `application/*` use cases 返回 CmdResult;`--dry-run`/`--json` 遵循既有契约(读命令稳定 JSON)。
- 现有 scanner(`findPendingApplies` / doctor)过滤改为 `.APPLY.json`,cron/doctor 文案同步(AGENTS.md/headless-ops.md 中 `*.APPLY.md` 引用改 `.APPLY.json`)。

## 10. Skill 接线(步骤顺序修正,F4 / RE3)

`skills/asset-ingest/SKILL.md` + `references/batch.md` 步骤修正为:

1. **识别 + 查重**(语义;含 journal 级幂等:`jspace ingest begin` 前查重)。
2. **`jspace ingest begin <file> --target <path> --slug <slug> --project <id>`** → jspace 暂存副本 + journal(staged);**source 留在 inbox**。
3. **写 gbrain 页**(语义正文):成功 → `jspace ingest <id> --gbrain`;serve 持锁 → **`jspace pending stage <slug> --content <file>`**(暂存 envelope,不失败)。
4. **更新 index** → `jspace ingest <id> --index`。
5. **`jspace ingest <id> --complete`** → jspace 移除 inbox source。
6. **任一步失败** → `jspace ingest <id> --fail <reason>`(机械补偿:gbrain 前失败移除暂存副本,sourcess 留 inbox)。
7. **锁空闲时**:`jspace pending apply`(或下次会话)应用暂存 envelope。

`skills/memory-writeback/`:写回时 gbrain 锁冲突 → `jspace pending stage`(共用 envelope)。

## 11. Testing Strategy

| Area | Tests |
| --- | --- |
| journal 契约 | decode round-trip、unknown-field、状态合法迁移 |
| 状态机 | begin→gbrain→index→complete;非法迁移拒绝;complete 移除 source |
| **故障注入** | gbrain put 失败(staged)→ 补偿移除暂存副本、source 留 inbox、无孤儿;index 失败 → failedStep=index、可重试;中断 → 从记录步骤续跑不重做 |
| 幂等 | 同 contentHash+relPath committed → begin 报 duplicate 跳过 |
| pending 契约 | decode round-trip、status 迁移 |
| envelope 生产者 | stage 写 APPLY.json;内容 = 契约 |
| **envelope 幂等** | 重复 apply 不重复写页;applied/acked 跳过;dedupe(gbrain get 已有同内容 → applied no-op) |
| retry/terminal | put 失败 retryCount++ → ≥3 terminal_failed;ack → acked 停止告警 |
| project | resolveProjectId 已注册 id / 未注册 fallback+提示 |
| CLI | 命令 spec 接线;use case 返回 CmdResult;--dry-run/--json 契约 |
| batch 日志统一 | contract test:skill 写 `<filehub>/.jspace-logs/inbox-batch.md` 与 cron/doctor 读同一路径(文案引用一致) |

现有 173 测试保持通过;`cli/cron.test.ts` 的 `findPendingApplies` 用例随 `.APPLY.json` 过滤更新。

## 12. Risks & Rollout

- **APPLY 扩展名变更**:`.APPLY.md`→`.APPLY.json` 波及 cron.ts/doctor.ts/cron.test.ts/registry.ts/AGENTS.md/headless-ops.md;无 producer 现存,属安全新基线;文案同步用 grep 收敛。
- **skill 接线纪律**:journal 是机械 truth,但 skill 是语义执行者;步骤漏调(如忘了 `--complete`)→ source 残留 inbox,可经 `ingest --list` + 下一轮续跑/rollback 收敛(不静默丢失)。
- **gbrain 锁竞态**:`pending apply` 与持锁会话并发 → apply 失败按 retry/terminal 处理;不绕过锁。
- **project 命名漂移**:派生 fallback 可能与其他项目冲突 → resolveProjectId 用 hub 注册为准 + 提示注册;inspect 报告不一致。
- **范围控制**:CLI 命令族 ~10 个,但每个是薄 use case 薄封装;机械核心(journal 状态机 + 补偿 + envelope)在 application 层可测。
- **Rollout**:M1 journal 契约+状态机+补偿 → M2 CLI ingest + project → M3 pending 契约+envelope+applier → M4 skill 接线 + scanner/文案同步 → M5 全链 gate。每里程碑 tsc + tests 绿;不触碰真实 filehub/gbrain。
