# P2-2 schema 版本策略统一(路径 A)—— implement

## Checklist(按序,先 contracts 再写侧再模板再测试)

- [ ] 1. **10 个 contract 改名**(core/contracts/{cron,local,ingest,pending,run-record,incident,skills,distribution,upgrade,materialized}.ts):
  - interface 字段 `version: 1 → schema_version: 1`
  - decoder FIELDS 白名单 `"version" → "schema_version"`
  - `readVersion(..., input.version, ...)` → `input.schema_version`
  - `success({ version: 1, ... })` → `success({ schema_version: 1, ... })`
  - issue code 前缀与 path 键保留不动
- [ ] 2. **写侧字面量**(见 design 清单 B):10 处 `version: 1 → schema_version: 1`(ingest/journal.ts、workspace/state.ts、workspace/init.ts、workspace/workspace.ts ×2、workspace/journal.ts、automation/incidents.ts ×2、automation/runs.ts、automation/execute.ts、pending/envelope.ts、automation/definitions.ts)。
- [ ] 3. **hub.ts legacy 删除**(design 清单 C):allowed 列表移除 `"version"`;删 `version: "4"` 分支改 `readVersion`;头部注释更新。
- [ ] 4. **migrations.ts**(design 清单 D):`docVersion` 删 legacy `String(doc.version)` 分支。
- [ ] 5. **templates**:`templates/workbench/.jspace/cron.json` `"version" → "schema_version"`;核查其它模板 state 文件。
- [ ] 6. **gen-assets**:`scripts/gen-assets.ts` 输出模板字段改名;`bun run scripts/gen-assets.ts` 重新生成 `cli/manifest.generated.ts` / `cli/skills.generated.ts`;确认 generated 文件 diff 只剩 version 字段。
- [ ] 7. **测试 fixtures**:各 contract 测试 + migrations 测试 + `distribution.test.ts:3` 清理。
- [ ] 8. **验证**:`bun test` 全绿、`bunx tsc --noEmit`;grep 断言无残留 `version` contract 字段。
- [ ] 9. 检查本机真实工作台 `~/jspace-work` 是否被破坏性变更影响(如有 state 文件,验收时评估;测试环境用临时目录)。
- [ ] 10. commit message 注明破坏性变更与用户迁移路径。

## 验证命令

```bash
bun test 2>&1 | tail -5
bunx tsc --noEmit
grep -rn "version: 1\b" core/contracts/ application/  # 期望无 contract 版本命中(区分语义 version 字段)
grep -rn "version\": 1\|\"version\": 1" templates/    # 期望无
git diff --stat                                        # 审查改动面
```

## Review gate

- diff 逐文件确认:每个 contract 的 interface/FIELDS/readVersion/success 四处一致。
- generated 文件只应因 gen-assets 重跑而变化,无手写 diff。
- 破坏性说明进入 commit body。

## 回滚

- 单 commit 可整体 revert;schema 是纯内部状态文件,无外部 API。
- 若中途发现字段名依赖过深,先回滚到「仅 hub/migrations 清理、version 字段保留」的中间态(路径 B 语义)再评估。
