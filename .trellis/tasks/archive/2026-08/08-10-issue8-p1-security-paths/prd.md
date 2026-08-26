# P1: 安全路径（issue #8 #3 + #4 + #12 + #15）

## Goal

修复四条机械可达的本地安全路径：

- **#4** `ingest begin/complete/fail` 不限制源文件边界：`begin ~/.ssh/id_rsa` 可把敏感文件拷进 filehub（若 filehub 走网盘/Obsidian Sync 则外泄）；`complete` 按 journal 的 `source` 无条件 `unlink` 原文件（相对路径按当时 cwd 删错文件）。
- **#3** Windows `.cmd` 无头执行不转义 cmd 元字符：`.jspace/cron.json` 的 `prompt`（随工作台 git 同步）→ `claude.cmd`/`grok.cmd` → `& | > < ^ %` 可注入，`cmd.exe /d /s /c` 直接执行（**不经过模型**），`prompt = "hello&calc.exe"` 即 RCE。
- **#12** Linux crontab 特殊字符 round-trip 不收敛 + 换行注入：`shq` 不剥离 `\n`（root/PATH/HOME 含换行可拆新 cron 行）；`'` 路径 `shq` 写 `foo'\''bar` 而 `parseManagedLine` 只吃到一半 → 永远 create/update；`%` 写时转 `\%` parse 不还原 → 每次 update。
- **#15** `workspace upgrade --rollback <id>` 的 `id`/`rel` 无路径约束：`--rollback ../../../../tmp/pwn` 逃逸 state 目录读 journal；journal 内 `plan[].rel` 为 `../../../.ssh/authorized_keys` 时可写工作台外。

父任务：`08-10-issue8-review-fixes`。

## Requirements

### #4（ingest 源文件边界）
1. `application/ingest/use-cases.ts` `ingestBegin`：`args.file` `realpath` 后必须落在 `<filehub>/_inbox/` 内（报告建议默认；allowlist 为后续可选扩展）；journal 只存绝对路径。
2. `ingestAdvance`/`ingestFail`/`ingestRollback` 传入的 `IngestFileOps.unlink` 加 filehub 边界守卫（`isWithin(realpath, filehub)` 才 unlink），防手改/损坏 journal 的 `source`/`target` 逃逸。
3. `core/contracts/ingest.ts` `decodeIngestJournal`：`source`/`target`/`relPath` 拒绝 `..`/`.` 段（契约层纵深防御）。

### #3（Windows cmd 注入）
4. `adapters/process/spawn.ts` `win32SpawnTarget`：`.cmd/.bat` 目标的 argv 每个参数做 cmd 转义——含 `& | < > ^ % ! "` 或空白时整体加双引号（cmd 在引号内视这些为字面量），内嵌 `"` 双写（`""`）。
5. 回归：`hello&whoami` → `"hello&whoami"`；`" & whoami` → `""" & whoami"`（内嵌引号双写后整体加引号）。

### #12（crontab 特殊字符 + 换行注入）
6. `adapters/scheduler/linux.ts` `crontabLine`：任一插值值（root/path/home/bin/id/log）含 `\n`/`\r`/NUL → `fail`（拒绝换行注入）。
7. `parseManagedLine` 与 `shq` 对称：用 POSIX 单引号扫描（`'\''` → 字面 `'`）解引号 + `\%` → `%` 还原；含 `'`/`%`/空格的 root 与 id 能 round-trip 收敛（不再每次 update）。

### #15（rollback 路径约束）
8. `application/workspace/workspace.ts` `rollbackUpgrade`：`id` 限 UUID；每个 `step.rel` 过 `portabilityIssues`（禁 `..`/绝对/`\`）+ `isWithin(realpath, root)`；不满足即 `fail`。

## Acceptance Criteria

- [x] #4：`ingest begin` 源在 `_inbox` 外 → `fail(/filehub inbox/)`；源在 `_inbox` 内 → 正常 staged、journal.source 绝对路径（isAbsolute 断言）。
- [x] #4：手改 journal 把 `source` 指向 filehub 外 → `complete` 拒绝 unlink（cleanup-pending、source NOT removed、failureReason 含 "outside the filehub"）。
- [x] #4：`decodeIngestJournal` 对 `source`/`target`/`relPath` 含 `..` → 出 issue（ingest.source.absolute/traversal 等）。
- [x] #3：`win32SpawnTarget` 单测——`hello&whoami` → `"hello&whoami"`、`" & whoami` → `""" & whoami"`、含 `>` 被引号；无元字符参数不变（现有 3 用例保持绿）。
- [x] #12：`crontabLine` 对含 `\n` 的 root/home → `fail(/newline|CR|NUL/)`。
- [x] #12：root 含 `'`/`%`/空格 → `crontabLine` → `parseManagedLine` 回读出完整 root/id（round-trip 收敛），现有 `replaceManagedBlock`/`parseManagedLine` 用例不回归。
- [x] #15：`--rollback` 非 UUID id → `fail(/expected a UUID/)`（在拼 journal 路径前）；journal plan rel 含 `..` → `fail(/unsafe rel/)`。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 520/520 绿；import-boundary / check-harness-consistency / check-manifest-integrity / check-skills 全绿。

## Out of Scope（本批不做）

- #10（filehub 单例契约）→ `08-10-issue8-p2-contracts-doctor`。
- #14（doctor 休眠域）→ `08-10-issue8-p2-contracts-doctor`。
- #16（gbrain wire 统一）→ `08-10-issue8-p2-contracts-doctor`。
