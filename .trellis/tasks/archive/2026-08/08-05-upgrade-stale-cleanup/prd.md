# 升级清理旧官方 skill 残留 — diffBundle 拆 remove/stale + rollback 覆盖

## Goal

旧工作台(v1.0.5 及更早,官方 skill 曾物化在根 `skills/`)升级到新布局后,根 `skills/` 永久残留官方孤儿副本(现状 stale 只报告不删,与「根 skills/ 归用户自建」新规则矛盾)。本任务:升级时**未修改**的旧官方副本随升级清理(remove),**本地修改过**的保留并提示(stale);删除走现有 backup + journal + rollback,用户内容永不自动删。

## Requirements

- **R1 拆分类**:`diffBundle` 的 stale 分支(recorded-but-not-in-bundle)按当前内容是否等于 materialized journal 记录 hash 拆分——
  - 未修改(旧 seed 副本)→ 新 action `remove`(升级会删);
  - 已修改(用户内容)→ 保留现有 `stale`(报告,不删)。
- **R2 升级执行**:`workspaceUpgrade` 的 plan 支持 `remove`——删除文件前先备份(走现有 backup 循环),journal.plan 记录 `{action:"remove", rel}`,失败/回滚可恢复;`rollbackUpgrade` 对 remove 条目 restore 备份(现有逻辑已覆盖:backup 存在则写回)。
- **R3 展示**:`workspace diff` / `dry-run` 显示 `[remove]`(未修改)/ `[stale]`(已修改)区别于旧语义。
- **R4 测试反转**:legacy 测试改为——未修改旧 `skills/` 副本升级后被清理(不再永久残留);新增用例——修改过的旧副本保留并报 `stale`;remove 的 rollback 恢复。
- **R5 语义保护**:`recreateOnMissing` 不受影响(cron.json 删除仍尊重);`user` 数据永不 remove。

## Acceptance Criteria

- [ ] **AC1** `diffBundle` 对「recorded 含 `skills/<name>/SKILL.md` 且内容 == 记录 hash、bundle 已无该 rel」→ 报 `remove`;内容 ≠ 记录 hash → 报 `stale`。
- [ ] **AC2** `workspaceUpgrade` 执行 remove:文件被删、upgrade journal plan 含 `{action:"remove"}`,备份存在;`--rollback` 恢复被删文件。
- [ ] **AC3** dry-run / diff 输出对两类分别显示 `[remove]` / `[stale]`,不误导为「报告保留」。
- [ ] **AC4** legacy 测试反转(workspace.test.ts):未修改旧 `skills/` 升级后不存在;新增「修改过保留 + 报 stale」与「remove rollback 恢复」用例。
- [ ] **AC5** `bun test`、`bunx tsc --noEmit` 全绿;无 `user` 数据被 remove 的回归(现有 hub/cron 保护用例仍绿)。

## Notes

- remove 仅针对 **seed 类、未修改、且 bundle 已不再物料化的旧 rel**;用户数据、修改过的 seed 永不自动删。
- `diffBundle` 已是纯函数(经 deps.readFile),stale 分支读当前内容判断无需改签名。
- 本任务不 bump 版本(随父任务 C3/集成发布)。
- 边界:`remove` 只处理「旧 rel 的遗留物」,不处理 `workspace/` 等用户预留区;也不删除用户自建的根 `skills/<自建>`(它从未被 materialized journal 记录)。
