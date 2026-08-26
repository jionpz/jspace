# P2-2 schema 版本策略统一(路径 A)

## Goal

全库 contract 的版本字段不统一:hub.ts 与 workbench.ts(marker)用 `schema_version: 1`,其余 10 个 contract(cron/local/ingest/pending/run-record/incident/skills/distribution/upgrade/materialized)用 `version: 1`;`core/registry/migrations.ts` 还认 legacy `version` 字符串。按 issue 推荐路径 A(无兼容性负担原则):**全库统一为 `schema_version: number`**。

## Requirements

**字段名统一(10 个 contract,issue 写 9 个,实为 10 个)**:

| 文件 | 现状 |
|---|---|
| cron.ts / local.ts / ingest.ts / pending.ts / run-record.ts / incident.ts / skills.ts / distribution.ts / upgrade.ts / materialized.ts | `version: 1` → `schema_version: 1` |

每个文件同步更新:interface 字段、decoder FIELDS 白名单、`readVersion(...input.version...)` → `readVersion(...input.schema_version...)`、encoder/返回对象字段、相关测试 fixture。

**hub.ts legacy 删除(本任务内,与 P2-5 分工)**:
- `core/contracts/hub.ts:291,299-305` 删除 `version: "4"` 接受分支,只认 `schema_version: 1`;同时 `checkNoUnknownFields` 的 allowed 列表移除 `"version"`。
- `core/contracts/hub.ts` 头部注释更新(去掉 legacy 说明)。

**migrations legacy 删除**:
- `core/registry/migrations.ts:33-36` `docVersion` 删除 legacy `String(doc.version)` 分支,只认 `schema_version`。
- `HUB_SCHEMA_VERSION = "1"` 保持(已是统一数字轴)。

**模板同步**:
- `templates/workbench/.jspace/cron.json:2` 的 `"version": 1` → `"schema_version": 1`(hub.json 已是 `schema_version`)。
- 检查 `templates/` 下其它 state 文件(ingest/pending/run-record/incident/skills/distribution/upgrade/materialized 的 fixture 与示例)同步。
- 改 `templates/workbench/` 后按仓库约定重跑 gen-assets.ts/build 同步嵌入式资产(见仓库记忆)。

**测试清理**:
- `distribution.test.ts:3` 的 legacy 引用清理(如有)。
- 各 contract 测试的 fixtures 改 `schema_version`。
- migrations 测试如认 legacy `version` 需同步改。

## Acceptance Criteria

- [ ] 全库 contract 统一 `schema_version`(10 个改名 + hub/workbench 保持),无 `version: number` contract 残留
- [ ] hub.ts 不再接受 legacy `version: "4"`;migrations.ts `docVersion` 只认 `schema_version`
- [ ] templates/*.jspace/* 的 version 字段全部 `schema_version`;嵌入式资产已重生成
- [ ] 全部 contract/migrations 测试通过;`bun test` 全绿、`tsc --noEmit` 通过
- [ ] commit message 注明破坏性变更:已有用户需 `rm ~/.jspace/state/*` 或手工 rename `version → schema_version`

## Notes

- 破坏性 schema bump,「首次开发无兼容性负担」原则支持;唯一照顾的是已有单机用户(见验收)。
- 执行顺序在 p2-decoder-helper 之后(字段名统一不与 helper 切换交织)。
- 依赖 p2-decoder-helper 已完成(它的 workbench 切 readVersion 保持 `schema_version` 字段名,不与此任务冲突)。
