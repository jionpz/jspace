# Issue #7 P3 — Implement

## 执行顺序(小改先行,大块在后)

### Step 1 — P3.16 manifest JSON(独立小改)
- [ ] 1.1 `scripts/gen-assets.ts` 写 `manifest.generated.ts` 时同步写 `cli/manifest.json`(纯 JSON)
- [ ] 1.2 `scripts/asset-integrity.ts` 新增 `readManifestJson`,`manifestPaths` 标注 legacy
- [ ] 1.3 `gen-assets.ts` stale 检查改 JSON;`check-manifest-integrity.ts` 改 JSON;`manifest-integrity.test.ts` 改 JSON
- [ ] 1.4 verify.yml freshness 清单加 `cli/manifest.json`
- [ ] 1.5 验证:gen-assets 后 `manifest.json` 生成 + 3 检查脚本绿 + 构造含 `path:` 的注释场景 JSON 不受影响

### Step 2 — P3.19 CI timeout/concurrency(独立小改)
- [ ] 2.1 verify.yml + build.yml 各 job 加 `timeout-minutes` + `concurrency`

### Step 3 — P3.18 hook 命令去 bash(模板)
- [ ] 3.1 3 个模板 9 条命令去掉 `2>/dev/null || true`
- [ ] 3.2 `context.ts` 头注释同步
- [ ] 3.3 `harness-claude.md` / `harness-grok.md` / `harness-cursor.md` 同步
- [ ] 3.4 重跑 gen-assets(模板嵌入)
- [ ] 3.5 确认 init.test / opencode-plugin.test 无 bash 字面量断言

### Step 4 — P3.17 代号注释人话化(大块,最后)
- [ ] 4.1 用 Python 扫描生成完整代号清单(文件×行)
- [ ] 4.2 逐文件 Read → Edit 注释(保留决策语义,去不可解码编号)
- [ ] 4.3 `*.test.ts` 测试名/注释同步
- [ ] 4.4 `rg` 验证无残留(保留 D1-D6 中对外可解码的真实现状描述)

### Step 5 — 全量验证 + 提交
- [ ] 5.1 `bunx tsc --noEmit`
- [ ] 5.2 `bun test`
- [ ] 5.3 `bun run scripts/gen-assets.ts` 后 git diff 无残留(含 manifest.json)
- [ ] 5.4 `bun run scripts/check-skills.ts` + `check-harness-consistency.ts` + `check-manifest-integrity.ts`
- [ ] 5.5 review diff(全局红线)
- [ ] 5.6 commit + push + issue 评论 + 归档

## 验证命令

```bash
bun run scripts/gen-assets.ts && python3 -c "import json; json.load(open('cli/manifest.json'))"
bun run scripts/check-manifest-integrity.ts
bun test scripts/manifest-integrity.test.ts scripts/asset-integrity.test.ts
bunx tsc --noEmit
bun test
rg -n "2>/dev/null|\|\| true" templates/  # 期望无输出
rg -n "Child [A-Z]|AC[0-9]+|RD[0-9]+|方案 a|M[0-9]+" core/ application/ adapters/ cli/ scripts/ --glob '*.ts'  # 期望仅保留可解码项
```

## Review 门禁

- [ ] 每个 Step 完成即验证该步范围
- [ ] Step 5 全量通过后才可 commit
- [ ] commit 前 review diff

## Rollback

- 模板/脚本改动回滚 = `git revert` + 重跑 gen-assets(重建 manifest.json)
- 注释/CI 改动回滚 = revert
