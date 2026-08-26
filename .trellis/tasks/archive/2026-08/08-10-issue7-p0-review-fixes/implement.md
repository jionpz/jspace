# Issue #7 P0 — Implement

## 执行顺序（有序清单）

### Step 1 — P0.2 headless argv 统一（先做，独立小改）
- [ ] 1.1 改 5 个 adapter：`adapters/harness/{claude,grok,pi,codex,opencode}.ts` 的 `headlessArgv` 消费 `capability.headless.slice(1)`（opencode 补 `run`）
- [ ] 1.2 更新 `adapters/harness/argv.test.ts:40` opencode 断言 → `["/bin/opencode", "run", "do it"]`
- [ ] 1.3 验证：`bun test adapters/harness/argv.test.ts adapters/harness/registry.test.ts adapters/harness/grok.test.ts`（其余 harness 断言不回归）

### Step 2 — P0.3 compacting 防护（模板文件）
- [ ] 2.1 改 `templates/workbench/.opencode/plugins/jspace.ts:65-78`：加 `AbortSignal.timeout(8000)` + `stdin: "ignore"` + `proc.exited` 退出码检查，失败返回 `""`
- [ ] 2.2 测试补超时 / 非零退出路径：`adapters/harness/opencode-plugin.test.ts`（mock runner 挂起/失败 → 返回 `""`）

### Step 3 — P0.1 session.created 真注入（模板文件，核心改动）
- [ ] 3.1 重构 `templates/workbench/.opencode/plugins/jspace.ts`：
  - `createEventHandler` 签名改为 `(inject: InjectFn, wbRoot)`，`session.created` 分支调 `inject(event.properties.sessionID)`
  - 真实 `InjectFn`：`runSessionStart()`（防护版）→ 文本非空则 `client.session.prompt({ path: sessionID, body: { parts: [{ type: "text", text }], noReply: true } })`
  - 静默 try/catch；更新文件头注释（真注入，注明「UserMessage 可见」语义差异）
- [ ] 3.2 `opencode-plugin.test.ts` 补：mock inject，断言 session.created → 以正确 sessionID 调用、文本为空不调用；idle / compacting 分支不回归
- [ ] 3.3 `capabilities.yaml` opencode `sessions` 注释更新为真实注入通道

### Step 4 — P0.4 CI 门禁
- [ ] 4.1 `.github/workflows/build.yml`：`release.needs: [build, test]`

### Step 5 — 资产同步 + 全量验证
- [ ] 5.1 `bun run scripts/gen-assets.ts`（模板改动必须重跑，嵌入 bundle；记忆约束）
- [ ] 5.2 `bunx tsc --noEmit`
- [ ] 5.3 `bun test`
- [ ] 5.4 `bun run scripts/check-skills.ts`
- [ ] 5.5 `bun run scripts/check-harness-consistency.ts`
- [ ] 5.6 `git diff` 确认 gen-assets 无残留（模板 ↔ bundle 一致）

## 验证命令

```bash
bun test adapters/harness/argv.test.ts adapters/harness/registry.test.ts adapters/harness/grok.test.ts adapters/harness/opencode-plugin.test.ts
bunx tsc --noEmit
bun test
bun run scripts/gen-assets.ts
bun run scripts/check-skills.ts
bun run scripts/check-harness-consistency.ts
```

## Review 门禁

- [ ] 每个 Step 完成即验证该步范围测试
- [ ] Step 5 全量通过后才可 commit
- [ ] commit 前 review diff（全局红线：提交前 review diff）

## Rollback

- 模板改动回滚 = `git revert` + 重跑 `gen-assets.ts`
- CI 文件改动无运行影响面，直接 revert 即可
