# workbench ownership 边界:managed/seed/user 落地 + hub/cron 保护 + upgrade 语义

## Goal

设计并落地 init 后工作台的 **ownership 边界**:`.jspace` 机器维护区(升级可直接替换/刷新)与用户预留资产(升级永不触碰)之间划清界限。落地 ownership 三态(`managed`/`seed`/`user`),把 `hub.json`、`cron.json` 从"升级直接替换"的 `managed` 摘出改为 `user` 数据文件;模板文件(`AGENTS.md`/`README.md`/`.claude/settings.json`/`skills`)归 `seed`(未改刷新、改过保留、非阻断);upgrade 按 per-file ownership 决定替换/保留/迁移;README 显式声明升级作用域。

## Background（证据）

- **现状:manifest 全部文件标 `managed`,upgrade 对"本地修改"报 conflict、默认阻断、`--accept-conflicts` 强制覆盖**。`hub.json`/`cron.json` 虽在 `.jspace/` 内且由用户持续增长(加 domain/resource/project、增删 cron),却被当成模板契约管理 → 用户一旦改动,升级要么卡死(不 `--accept-conflicts`)、要么注册表/cron 被空模板覆盖(**数据丢失 footgun**)。
- **ownership 枚举已定义未落地**:`core/contracts/distribution.ts` 有 `managed|seed|user`,但 `manifest.ts:ownershipFor` 恒返回 `"managed"`;`diffBundle` 只对 `seed` 有特殊处理,`user` 行为等同 `managed`。
- **skills 已用 hack 表达"未改刷新、改过保留"**:Child D 把 skills 归 managed,并在 upgrade plan 里用 `!e.rel.startsWith("skills/")` 特判"冲突永不覆盖"。但该 hack 让**被改过的 skill 仍算 conflict 并默认阻断升级**(`conflicts` 计数含 skills)。
- **hub schema 无迁移机制**:`core/contracts/hub.ts` 只接受 version "4",v3 显式拒绝"no implicit migration";注释明确"upgrade belongs to Child B"——本次正是要落地该路径。
- **材料化与升级机制已成熟**:init 只建新工作台(`application/workspace/init.ts`,不重复物化);upgrade 走 `diffBundle` + 备份 journal + 回滚(`application/workspace/workspace.ts`);journal 记录实际哈希以区分"bundle 前移"与"用户修改"。

## Requirements

- **R1 ownership 三态落地**:per-file ownership 由 manifest 表达并驱动 diff/upgrade。`managed`(升级直接替换 + 可强制覆盖,预留)、`seed`(模板:未改刷新、改过保留、删了重建、**不阻断**)、`user`(数据:升级永不覆盖)。
- **R2 hub.json 归 user**:升级永不覆盖、永不因"用户改过"报冲突;缺失时升级重建空注册表(recovery);schema 演进走显式 migration 机制——无可用迁移时**报错并保持文件不动**,绝不静默替换。
- **R3 cron.json 归 user**:升级永不覆盖、**永不重建**(删除 = 用户意图"无 cron",须尊重);新默认 cron 不自动注入现有工作台。
- **R4 模板文件归 seed**:`AGENTS.md`、`README.md`、`.claude/settings.json` 未修改则随升级刷新到新模板(新渲染块/新规则可达),本地修改永久保留且不阻断升级。
- **R5 skills 归 seed**:未修改刷新、改过保留。移除 upgrade 里 `skills/` 路径前缀特判,改为按 ownership 表达(去 hack)。
- **R6 upgrade 冲突策略**:仅 `managed` 冲突默认阻断且 `--accept-conflicts` 可覆盖;`seed`/`user` 的本地修改一律非阻断保留。
- **R7 边界文档**:workbench README 显式声明目录边界与升级作用域(哪些可被升级刷新/替换,哪些用户预留永不触碰);AGENTS.md 简述。
- **R8 回归**:`gen-assets` 再生 bundle;既有 manifest/workspace 测试按新语义更新,新增覆盖。

## Acceptance Criteria

- [ ] `cli/manifest.generated.ts` 归位正确:`hub.json`/`cron.json` 为 `user`,`AGENTS.md`/`README.md`/`.claude/settings.json`/`skills/*` 为 `seed`;`ownershipFor` 单测覆盖映射。
- [ ] 用户给 `hub.json` 加了 domain/resource 后,`jspace workspace upgrade` 默认**不报冲突、不覆盖**,其余文件照常升级;升级后 hub.json 内容原样保留。
- [ ] 用户改过 `cron.json` 后升级不覆盖;删除 `cron.json` 后升级**不重建**。
- [ ] 删除 `hub.json` 后升级重建空注册表(`jspace doctor` 不再报 `hub.missing`)。
- [ ] `AGENTS.md`/`README.md`/`.claude/settings.json`/bundled skill 本地修改:`workspace diff` 显示 `skip`,升级不阻断、不覆盖;未修改时升级刷新到新模板(`update`)。
- [ ] `--accept-conflicts` 仅对 `managed`(预留类)强制覆盖;对 `seed` 修改不覆盖。
- [ ] migration 机制:现 `v4→v4` 恒等通过;构造 `v5` bundle 且无迁移 → upgrade 报"需手动迁移"且**不触碰 hub.json**。
- [ ] 全新 workbench 与旧无 journal 夹具升级均通过;`gen-assets` 再生后 `git diff` 干净;`bun test` 全绿。
- [ ] README「目录边界与升级范围」章节存在且与实现一致。

## Out of Scope

- **实际 hub v4→v5 迁移变换**:现在没有 v5;机制就位后随真实 schema 演进再实现。
- **新默认 cron 自动注入现有工作台**:将来可做显式 `jspace cron seed`(幂等补缺),本任务只保证 cron.json 不被覆盖。
- **强制刷新单个 seed 的逃生舱**(如 `upgrade --force <rel>`):记为后续能力,不在本任务。
- **harness 接线范围扩展**(`.cursor/`、`.pi/` 等平台接线文件):保持现状只打包 Claude 接线。
