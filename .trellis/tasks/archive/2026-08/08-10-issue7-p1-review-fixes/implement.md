# Issue #7 P1 — Implement

## 执行顺序(有序清单)

### Step 1 — P1.8 测试网(先做,独立)
- [ ] 1.1 新建 `scripts/manifest-integrity.test.ts`:manifest ⊆ 磁盘、ASSETS ↔ manifest、sha256
- [ ] 1.2 验证:`bun run scripts/manifest-integrity.test.ts`

### Step 2 — P1.9 session_end 降级(独立小改)
- [ ] 2.1 `adapters/harness/capabilities.yaml`:claude/opencode/pi `session_end` → `manual`
- [ ] 2.2 `harness-claude.md` / `harness-opencode.md` / `harness-pi.md` 生命周期行 session-end → manual
- [ ] 2.3 重跑 `bun run scripts/gen-assets.ts`(同步 capabilities.generated.ts)

### Step 3 — P1.5 + P1.6 manifest 完整性 + git 跟踪(新脚本)
- [ ] 3.1 新建 `scripts/check-manifest-integrity.ts`(复用 manifestPaths + 磁盘/跟踪/忽略三检查)
- [ ] 3.2 本地验证 clean 仓库 pass;构造 gitignored 场景确认能红(AC2)
- [ ] 3.3 `.github/workflows/verify.yml` 重排:manifest-integrity 移 gen-assets 前,删 inline regex
- [ ] 3.4 `scripts/check-skills.ts` C4 `stdio: "inherit"`

### Step 4 — P1.7 idle 只提醒不 flush(模板核心改动)
- [ ] 4.1 `templates/workbench/.opencode/plugins/jspace.ts` 重构:`createEventHandler` deps 换 `{ injectSessionStart, checkCron }`;idle 移除 pending apply,改 `jspace cron check` 非 quiet + exit != 0 注入提醒
- [ ] 4.2 `adapters/harness/opencode-plugin.test.ts` 更新:idle → checkCron(sessionID)、不含 pending apply
- [ ] 4.3 `cli/init.test.ts:110-111` 更新(删除 pending apply 断言,保留 cron check + 事件字面量)
- [ ] 4.4 `harness-opencode.md` 更新 idle 行 + 修正 P0 漂移(session.created 注入、spawn guard)
- [ ] 4.5 重跑 `bun run scripts/gen-assets.ts`(plugin 改动嵌入 bundle)

### Step 5 — 全量验证
- [ ] 5.1 `bunx tsc --noEmit`
- [ ] 5.2 `bun test`
- [ ] 5.3 `bun run scripts/check-manifest-integrity.ts`
- [ ] 5.4 `bun run scripts/check-skills.ts`
- [ ] 5.5 `bun run scripts/check-harness-consistency.ts`
- [ ] 5.6 `bun run scripts/gen-assets.ts` 后 `git diff` 确认无残留
- [ ] 5.7 review diff(全局红线:提交前 review diff)

## 验证命令

```bash
bun run scripts/manifest-integrity.test.ts
bun test adapters/harness/opencode-plugin.test.ts cli/init.test.ts
bunx tsc --noEmit
bun test
bun run scripts/check-manifest-integrity.ts
bun run scripts/gen-assets.ts
bun run scripts/check-skills.ts
bun run scripts/check-harness-consistency.ts
```

## Review 门禁

- [ ] 每个 Step 完成即验证该步范围测试
- [ ] Step 5 全量通过后才可 commit
- [ ] commit 前 review diff

## Rollback

- 模板/yaml 改动回滚 = `git revert` + 重跑 `gen-assets.ts`
- CI 脚本/配置改动无运行影响面,直接 revert
