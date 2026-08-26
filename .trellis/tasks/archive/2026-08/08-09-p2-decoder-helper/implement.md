# P2-5 decoder helper 切换剩余 contract —— implement

## Checklist(按序)

- [ ] 1. `core/contracts/ingest.ts`:
  - `:52-54` `input.version !== 1` → `readVersion(issues, "ingest.version.unsupported", "ingest.version", input.version, [1])`;
  - `:78-80` 内联 uuid 正则 → `readUuid(issues, "ingest.id.invalid", "ingest.id", input.id)`(注意保留原有先 `readRequiredString(id)` 的语义,id 缺失时两者都上报;实现时核对重复上报是否可接受 —— 现有 readRequiredString 已报 id.invalid,加 readUuid 后对「非 uuid 字符串」报同 code,需确认 issue 列表不产生行为差异);
  - import 增加 `readVersion, readUuid`。
- [ ] 2. `core/contracts/local.ts`:`:31-33` → `readVersion(issues, "local.version.unsupported", "local.version", input.version, [1])`;import 增加。
- [ ] 3. `core/contracts/upgrade.ts`:`:47-48` → `readVersion(...)`。
- [ ] 4. `core/contracts/distribution.ts`:`:42-43` → `readVersion(...)`。
- [ ] 5. `core/contracts/workbench.ts`:`:35-36` `input.schema_version !== 1` → `readVersion(issues, "marker.version.unsupported", "marker.schema_version", input.schema_version, [1])`(字段名保持 schema_version)。
- [ ] 6. `core/contracts/diagnostics.ts:98` UUID_PATTERN 上方补注释(见 prd)。
- [ ] 7. 各 contract 现有测试跑一遍确认 decode 成功/失败行为不变(尤其 ingest 的 uuid 校验、workbench 的 schema_version)。
- [ ] 8. 若 `readUuid` 切换后 ingest 测试断言了「非 uuid id」的 issue 数量,按新行为校正(如必要)。
- [ ] 9. `bun test` 全绿、`bunx tsc --noEmit`。

## 验证命令

```bash
bun test core/contracts/ 2>&1 | tail -5
bun test 2>&1 | tail -5
bunx tsc --noEmit
```

## Review gate

- 5 个文件 + workbench 全部走共享 helper,无手写 version/uuid 校验残留。
- issue code/消息与切换前等价(行为不变,只换实现路径)。

## 回滚

- 纯重构,单 commit 可 revert;不涉及字段名(与 P2-2 的边界见 prd,本任务不动 hub.ts/migrations.ts)。
