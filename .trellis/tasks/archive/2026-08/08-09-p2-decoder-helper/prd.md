# P2-5 decoder helper 切换剩余 contract

## Goal

`core/contracts/diagnostics.ts` 的共享 decoder helpers(`readEnum/readUuid/readBool/readVersion`)已推广到 cron/run-record/incident/pending,但还有 5 个非 hub contract 手写 version/uuid 校验,issue 上报路径不统一。本任务把这 5 个切到共享 helper,并为 UUID_PATTERN 补注释。

## Requirements

**本任务范围**(5 个文件 + 注释;hub.ts 的 legacy 删除归属 P2-2,见下):

| 文件 | 现状手写 | 切到 |
|---|---|---|
| `core/contracts/ingest.ts:52–54` | `input.version !== 1` | `readVersion(issues, "ingest.version.unsupported", "ingest.version", input.version, [1])` |
| `core/contracts/ingest.ts:78–80` | 内联 `/^[0-9a-f-]{36}$/i` uuid 校验 | `readUuid(issues, "ingest.id.invalid", "ingest.id", input.id)` |
| `core/contracts/local.ts:31–33` | `input.version !== 1` | `readVersion(...)` |
| `core/contracts/upgrade.ts:47–48` | `input.version !== 1` | `readVersion(...)` |
| `core/contracts/distribution.ts:42–43` | `input.version !== 1` | `readVersion(...)` |
| `core/contracts/workbench.ts:35–36` | `input.schema_version !== 1`(字段名已是 schema_version) | `readVersion(issues, ..., input.schema_version, [1])` —— 字段名保持不变 |

- `core/contracts/diagnostics.ts:98` UUID_PATTERN 加注释:「Accepts any UUID shape (v1/v3/v4/v5); variant/magic bits not enforced. Rationale: v4-only 太严,而 jspace 生成的 id 本就是 v4(crypto.randomUUID);接受任何形状的 uuid 可让外部工具自己生成的 ids 也能进 schema。」
- 注意 keep 各 contract 现有 code 前缀(如 `ingest.version.unsupported`)与 issue 消息文本,只换调用方式,不改变已发布语义。
- 未切换 contract 若有 enum 校验(如 ingest status),顺手切 `readEnum`(对照 pending/cron 已用 pattern),保持严格度一致。

**与 P2-2 的分工(避免冲突)**:
- hub.ts 的 legacy `version: "4"` 接受分支 **不动**(它接受字符串,readVersion 无法表达),由 `p2-schema-version` 在统一 `schema_version` 时一并删除。
- 执行顺序:p2-decoder-helper 先做,p2-schema-version 后做(字段名统一与 helper 切换不交织)。

## Acceptance Criteria

- [ ] 5 个非 hub contract 的 version/uuid 校验全部走 `readVersion/readUuid`(workbench 保持 `schema_version` 字段名)
- [ ] 有 enum 校验处切 `readEnum`(如有)
- [ ] UUID_PATTERN 注释已加
- [ ] 现有 contract 测试全部通过(行为不变,只换实现)
- [ ] `bun test` 全绿、`tsc --noEmit` 通过

## Notes

- 纯重构:decode 的成功/失败行为不变,只统一 issue 上报路径。
- hub.ts 不动(归属 P2-2);migrations.ts 不动(归属 P2-2)。
