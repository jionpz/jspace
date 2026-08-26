# P2-2 schema 版本策略统一(路径 A)—— design

## 背景

contract 版本字段不统一:hub.ts / workbench.ts(marker)用 `schema_version: 1`,其余 10 个 contract 用 `version: 1`;`core/registry/migrations.ts` 的 `docVersion` 仍认 legacy `version` 字符串。issue #3 推荐路径 A:按「首次开发无兼容性负担」原则全库统一为 `schema_version: number`。

本任务 = **破坏性 schema bump**,一次性改名 + 删 legacy 路径,不留兼容分支。

## 受影响清单(全文 grep 核实)

### A. 10 个 contract(interface + decoder)

| 文件 | 现状 | 改法 |
|---|---|---|
| `core/contracts/cron.ts:47,120` | `version: 1` | interface `schema_version: 1`;FIELDS 白名单 `"version"→"schema_version"`;`readVersion(..., input.schema_version, ...)`;`success({ schema_version: 1, ... })` |
| `core/contracts/local.ts:18,31,55` | 同 | 同 |
| `core/contracts/ingest.ts:25,52,83` | 同 | 同 |
| `core/contracts/pending.ts:28,52,71` | 同 | 同 |
| `core/contracts/run-record.ts:23,45,58` | 同 | 同 |
| `core/contracts/incident.ts:26,48,65` | 同 | 同 |
| `core/contracts/skills.ts:33,47,53` | 同 | 同 |
| `core/contracts/distribution.ts:26,42,78` | 同 | 同 |
| `core/contracts/upgrade.ts:31,47,73` | 同 | 同 |
| `core/contracts/materialized.ts:16,30,46` | 同 | 同 |

统一规则:interface 字段名、FIELDS 白名单、`readVersion` 读取键、`success`/encoder 返回对象 —— 全部 `version → schema_version`。issue code 前缀不变(如 `cron.version.unsupported` 保留,path 键 `"cron.version"` 保留)。

### B. 写侧(application 层 writer 字面量)

| 位置 | 写哪个 contract | 改法 |
|---|---|---|
| `application/ingest/journal.ts:161` | ingest | `version: 1 → schema_version: 1` |
| `application/workspace/state.ts:50` | local | 同 |
| `application/workspace/init.ts:98` | local | 同 |
| `application/workspace/workspace.ts:123,245` | upgrade journal | 同 |
| `application/workspace/journal.ts:41` | materialized | 同 |
| `application/automation/incidents.ts:39,58` | incident | 同 |
| `application/automation/runs.ts:24` | run-record | 同 |
| `application/automation/execute.ts:159` | run-record | 同 |
| `application/pending/envelope.ts:58` | pending | 同 |
| `application/automation/definitions.ts:25` | cron(空回退) | 同 |

### C. hub.ts legacy 删除(`core/contracts/hub.ts`)

- `checkNoUnknownFields` allowed 列表(`:291`):移除 `"version"`,只留 `["schema_version","domains","resources","projects"]`。
- `:299-305` 删除 legacy 分支:只认 `schema_version`,`readVersion(issues, "hub.version.unsupported", "hub.schema_version", input.schema_version, [1])`。
- 头部注释(`:4-9`)删除 legacy 说明,改为「hub 使用统一 numeric `schema_version`」。

### D. migrations legacy 删除(`core/registry/migrations.ts`)

- `docVersion`(`:33-36`):删除 `String(doc.version)` 分支,只认 `schema_version`。
- `HUB_SCHEMA_VERSION = "1"` 保持;MIGRATIONS 表空表保持。

### E. templates 同步

- `templates/workbench/.jspace/cron.json:2`:`"version" → "schema_version"`。
- 核查 `templates/` 下其它 `.jspace/` state 文件(ingest/pending/run-record/incident/upgrade/materialized 若有示例),同步。

### F. generated assets(嵌入式资产,源头在 templates)

- `scripts/gen-assets.ts` 输出的 `cli/manifest.generated.ts:5` / `cli/skills.generated.ts:5` 的 `version` 字段随 contract 改名;重跑 `bun run scripts/gen-assets.ts` 重新生成(仓库记忆:改 templates 后必须重跑)。
- `cli/manifest.generated.ts` 的 `version: 1` 是 DistributionManifestV1 实例、`skills.generated.ts` 的 `"version": 1` 是 SkillsManifestV1 实例 —— 均改为 `schema_version`。

### G. 测试 fixtures

- 各 `core/contracts/*.test.ts` 的 version fixture → `schema_version`(cron/local/ingest/pending/run-record/incident/skills/distribution/upgrade/materialized)。
- `core/registry/migrations*` 测试(若认 legacy `version` 字符串)同步。
- `distribution.test.ts:3` 的 legacy 引用清理。

## 迁移 / 兼容

- 破坏性:已有 `.jspace/state/*` 与 `.jspace-logs` 记录的 `version` 字段将 decode 失败。按 issue,已有用户需 `rm ~/.jspace/state/*`(或手工 rename `version → schema_version`)。本机主工作台 `~/jspace-work` 在验收时确认是否需要重建。
- 模板(hub.json 已是 schema_version)与 M5 之后产物不冲突。

## 验证

- `bun test` 全绿、`tsc --noEmit`。
- grep 断言无残留:`grep -rn "version: 1\b" core/contracts/ application/` 期望仅剩与 `schema_version` 无关的命中;`grep -rn "\"version\"" templates/` 期望仅 hub/cron 已是 schema_version。
- gen-assets 重跑后 diff 无手写痕迹。
