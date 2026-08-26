# Issue #7 P2 — Implement

## 执行顺序(小改先行,大块在后)

### Step 1 — P2.15 gen-assets skip 统一(独立小改)
- [ ] 1.1 `scripts/gen-assets.ts:56` skip 改 `/\.test\.(ts|py)$/`
- [ ] 1.2 重跑 `bun run scripts/gen-assets.ts`,确认 manifest 40→38(不含 *.test.py)
- [ ] 1.3 `bun run scripts/check-manifest-integrity.ts` 绿

### Step 2 — P2.13 GEN_ASSETS_ALLOW_MISSING 语义(独立小改)
- [ ] 2.1 `scripts/gen-assets.ts` 加 `missingAllowed()` helper(只认 "1"/"true"),guard 改用它
- [ ] 2.2 验证:`GEN_ASSETS_ALLOW_MISSING=0 bun run scripts/gen-assets.ts`(故意删一文件应红)→ 恢复;`=1` 放行

### Step 3 — P2.10 gitignore 统一(独立小改)
- [ ] 3.1 `.gitignore` harness 段重写(见 design):`.grok/` 入忽略、例外改目录树解禁、补 `.cursor/`
- [ ] 3.2 验证:`git check-ignore` 模板 seed 不命中、非模板 harness 目录命中;`check-manifest-integrity` 绿

### Step 4 — P2.11 Cursor hook + envelope(中,涉及 CLI)
- [ ] 4.1 `application/context/envelope.ts` 加 `cursorSessionStartEnvelope`(顶层 additional_context)
- [ ] 4.2 `cli/commands/context.ts` session-start 加 `--envelope <claude|cursor>`
- [ ] 4.3 新增 `templates/workbench/.cursor/hooks.json`(sessionStart → `--envelope cursor`)
- [ ] 4.4 测试:envelope 单测(如有 context 测试)+ `--envelope cursor` 输出断言
- [ ] 4.5 `harness-cursor.md` hook 位置改项目级
- [ ] 4.6 重跑 gen-assets(新模板嵌入)

### Step 5 — P2.14 check-harness-consistency 表驱动(中)
- [ ] 5.1 `scripts/check-harness-consistency.ts` import `getAdapter` + `harnessArgv`
- [ ] 5.2 加断言 7(hookFilePath 模板存在)、8(headless argv 前缀)、9(lifecycle 期望表)
- [ ] 5.3 跑脚本确认 3 新断言过 + 现有 6 组不回归

### Step 6 — P2.12 文档重写(大块,最后)
- [ ] 6.1 根 `AGENTS.md`:CLI/skill/目录/Quality Checks/capabilities 说明更新,删 `__DEV_ROOT__`,Trellis 块不动
- [ ] 6.2 根 `README.md`:目录/命令/门禁更新,删 `__DEV_ROOT__`

### Step 7 — 全量验证 + 提交
- [ ] 7.1 `bunx tsc --noEmit`
- [ ] 7.2 `bun test`
- [ ] 7.3 `bun run scripts/gen-assets.ts` 后 git diff 无残留
- [ ] 7.4 `bun run scripts/check-skills.ts` + `check-harness-consistency.ts` + `check-manifest-integrity.ts`
- [ ] 7.5 review diff(全局红线:提交前 review diff)
- [ ] 7.6 commit + push + issue 评论 + 归档

## 验证命令

```bash
bun run scripts/gen-assets.ts
bun run scripts/check-manifest-integrity.ts
GEN_ASSETS_ALLOW_MISSING=0 bun run scripts/gen-assets.ts   # 语义验证
bunx tsc --noEmit
bun test
bun run scripts/check-skills.ts
bun run scripts/check-harness-consistency.ts
bun run cli/main.ts context session-start --envelope cursor --dir /tmp/x  # envelope 输出
git check-ignore -v templates/workbench/.cursor/hooks.json  # 应无输出(不忽略)
```

## Review 门禁

- [ ] 每个 Step 完成即验证该步范围
- [ ] Step 7 全量通过后才可 commit
- [ ] commit 前 review diff

## Rollback

- 模板/CLI/yaml 改动回滚 = `git revert` + 重跑 gen-assets
- 配置/文档回滚 = revert
