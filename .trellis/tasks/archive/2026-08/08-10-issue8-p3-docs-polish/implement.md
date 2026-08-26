# Implement: 文档漂移 + 打磨（#18 #19 #22 #23 #24 #26 #27）

## 前置

- [x] 本子任务 prd.md + design.md 已评审通过（父任务 `08-10-issue8-review-fixes`）。

## Ordered Checklist

### 文档（#18 全组）
1. `skills/jspace-use/references/harnesses.md`：去"render"误导 + lifecycle 四格对齐 yaml。
2. 根 `AGENTS.md:53` / `templates/filehub/README.md:51` / `skills/asset-ingest/references/gbrain-write.md:42-43`：binding 迁移表述。
3. `skills/jspace-use/references/registry.md:37-44` + `jspace-use/SKILL.md:78,161`：去"未来式"。
4. `AGENTS.md:26,55-56`：去"未上线" → v1.0.11 分发现实。
5. `skills/harness-config/`：认 5 家（补 Grok/OpenCode）。
6. `templates/workbench/README.md:15-19`：补 `.cursor/hooks.json`。
7. `templates/workbench/AGENTS.md:79` + `jspace-use/SKILL.md:135`：pending 路径改 `<filehub>/.jspace-logs`。
8. `README.md:81`：harness wire 现状如实。
9. 改完重跑 `bun run scripts/gen-assets.ts` + `bun run build`；验证 generated 新鲜度。

### 代码打磨
10. **#19** `adapters/fs/workbench-state.ts`：`writeBytesAtomic` 加 fsync + rename 失败清理 tmp。
11. **#22** doctor 人话 info：`--verbose` 才打印 info；bin_missing 只算 enabled cron（`cli/commands/doctor.ts` + `doctor.ts`）。
12. **#23** `application/registry/{domain,resource,project}.ts` list 空 → ok 行。
13. **#24** 错误前缀双层去重 + decode code 人话化。
14. **#26** `HubV4` → `HubV1` + `HUB_SCHEMA_VERSION` 常量（`git grep HubV4` 全量替换）。
15. **#27** `cli/embed.ts` 删 `__DEV_ROOT__` 死代码 + 文档提及；`git grep __DEV_ROOT__` 干净。
16. **#20 确认**：scheduler 测试确认 `%` round-trip（security 批已修）。

### 验证
17. `bunx tsc --noEmit`；`bun test` 全量；`bun run scripts/gen-assets.ts` 新鲜度；`bun run build`（assets 嵌入）；check-harness-consistency / check-manifest-integrity / check-skills。
18. 文档改动后 `git grep` 残留检查（`__DEV_ROOT__`、`HubV4`、`jspace: error: jspace:`、`workspace/${name}` 休眠域旧文案）。

## Validation Commands

```bash
bunx tsc --noEmit
bun test   # 全量
bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts adapters/harness/capabilities.generated.ts
bun run build   # 编译产物 + assets 嵌入
git grep -n "__DEV_ROOT__\|HubV4\|jspace: error: jspace:"   # 应为空/仅预期
```

## Review Gates

- [ ] #18 八处文档与代码一致；改 skills/templates 后 generated 更新 + build 成功。
- [ ] #19/#22/#23/#24/#26/#27 各验证（tsc + 定向 + 全量）。
- [ ] `git grep` 残留检查干净。
- [ ] 延后项（#21/#25/#28/#29/#30）在 prd Notes 记录，未误改代码。

## Rollback Points

- 文档改动无风险（回滚 diff 即可）；改 `templates/workbench/` 或 `skills/` 后若 generated 意外变，revert 一并。
- #26/#27 机械替换，tsc + grep 兜底。
