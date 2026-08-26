# Issue #7 P1 — Design

## 现状问题(issue #7 编号 5-9)

| # | 缺陷 | 位置 |
|---|---|---|
| P1.5 | verify.yml 双重验证:check-skills C4 先跑 gen-assets(pipe 吞 stderr),后面 manifest path-exists 检查的是新写出的 manifest 而非 committed;inline regex 与 `asset-integrity.ts` 的 `manifestPaths()` 分叉 | `.github/workflows/verify.yml`、`scripts/check-skills.ts:144` |
| P1.6 | issue #6 根因:源文件被 gitignore 从未进 index,本地 guard 通过(磁盘在),干净 clone CI 才红 | `.gitignore` + gen-assets guard |
| P1.7 | idle 每 turn 自动 `pending apply`(比 Claude/Grok 激进)+ `cron check --quiet` exit code 丢弃(失败面黑洞) | `templates/workbench/.opencode/plugins/jspace.ts` |
| P1.8 | 本地 `bun test` 抓不到「manifest 声明源文件丢失」类问题(依赖 CI inline 检查) | — |
| P1.9 | claude/opencode/pi 的 `session_end: best_effort` 虚报(无真实接线) | `adapters/harness/capabilities.yaml` |

## P1.5 + P1.6 — check-manifest-integrity.ts + verify.yml 重排

### 新脚本 `scripts/check-manifest-integrity.ts`

复用 `manifestPaths()`(P1.5 消除 regex 分叉),对 committed `cli/manifest.generated.ts` 的每个 path 三重检查:

1. **磁盘存在**:`existsSync(join(ROOT, p))` — 替代 verify.yml 的 inline path-exists 检查。
2. **git 跟踪**:`git ls-files --error-unmatch -- "<p>"`(未跟踪 → exit 1)。堵 issue #6 根因:gitignored 源在磁盘时,guard 通过但从未进 index。
3. **不被忽略**:`git check-ignore --no-index -q -- "<p>"`(命中 ignore → exit 0 → 红)。检查 .gitignore 例外策略未把源文件钉死。

失败输出每项具体 path,exit 1。本地与 CI 均可跑(git 命令需仓库上下文)。

### verify.yml 重排(issue 建议顺序)

```
install → manifest-integrity(committed, 在任何 gen-assets 前)
        → gen-assets + git diff(freshness, committed 应 fresh)
        → version / docs / harness-consistency
        → tsc → bun test → reachability → check-skills → python → full-chain
```

关键变化:
- manifest 完整性检查移到 gen-assets **之前**,对 committed manifest 生效。
- 原 inline regex step 删除(被 check-manifest-integrity.ts 取代)。
- 原「Asset freshness」step 保留(gen-assets + git diff),仍在 manifest 检查之后(若 freshness 漂移则红)。

### C4 stdio

`check-skills.ts:144` `execSync("bun run scripts/gen-assets.ts", { stdio: "pipe" })` → `stdio: "inherit"`,让 gen-assets 的 source-integrity guard 错误(具体缺哪个文件)在 CI 可见。

## P1.7 — idle 只提醒不 flush(用户拍板)

### 决策

与 Claude/Grok 一致:staged 写不自动 flush,用户显式触发。idle 只做 **cron 失败可见化**。

### 已核实

- `session.idle` payload = `{ sessionID }`(`@opencode-ai/sdk` EventSessionIdle)。
- `jspace cron check` 非 quiet 输出失败详情,exit != 0 表示有 attention 项。

### plugin 重构

`createEventHandler` deps:`{ spawn, wbRoot }` → `{ injectSessionStart, checkCron }`(idle 不再 fire-and-forget spawn):

```ts
export interface EventDeps {
  injectSessionStart: (sessionID: string) => Promise<void>;
  checkCron: (sessionID: string) => Promise<void>;
}
```

- `session.created` → `injectSessionStart(sessionID)`(P0 不变)。
- `session.idle` → `checkCron(sessionID)`。
- plugin 闭包实现 `checkCron`:跑 `jspace cron check`(非 quiet,8s 超时 + stdin ignore + exit code)→ exit != 0 且 output 非空 → `client.session.prompt({ path: { id: sessionID }, body: { parts: [{ type: "text", text: output }], noReply: true } })` 注入可见提醒;exit == 0 不注入(避免每 turn spam)。
- 移除 `pending apply --quiet` spawn(彻底从 idle 删除,注释同步)。

### 影响

- `cli/init.test.ts:110-111`:`pending apply --quiet` 断言删除,改断言 `cron check` 存在 + 不含 writeback。
- `adapters/harness/opencode-plugin.test.ts`:deps 重构 + idle 断言改为 checkCron(sessionID)。
- `harness-opencode.md`:idle 行更新(只 cron check 提醒)+ 修正 P0 漂移(session.created 注入、spawn guard 说明)。

## P1.8 — manifest-integrity.test.ts

```ts
// bun test 网:committed manifest 源完整性(纯 fs,无 git 依赖)
1. manifestPaths(manifest.generated.ts) 每个 path existsSync
2. Object.keys(ASSETS).sort() == BUNDLE_MANIFEST.files[].path.sort()
3. 每个 manifest file sha256 == sha256Of(ASSETS[path])
```

git 部分(需 git 上下文)留在 check-manifest-integrity.ts(CI 跑),bun test 做纯 fs 网——本地 `bun test` 就能抓住「manifest 声明源丢失」。

## P1.9 — session_end 降级

| harness | 现状 | 改为 | 依据 |
|---|---|---|---|
| claude | best_effort | **manual** | 无 SessionEnd/Stop hook |
| opencode | best_effort | **manual** | idle 禁止 session-end |
| pi | best_effort | **manual** | hook_format: none |
| grok | best_effort | 保持 | ✅ SessionEnd → context session-end |
| cursor | manual | 保持 | 诚实 |

同步 3 个 harness-*.md 生命周期行(写死的 4-grade 表格),重跑 gen-assets 同步 `capabilities.generated.ts`。check-harness-consistency 无 lifecycle 断言,不受影响。

## 兼容性 / 回滚

- verify.yml 纯 CI 配置;check-manifest-integrity.ts 新增脚本,回滚 = revert。
- plugin 重构是 seed 模板改动 → gen-assets 重跑同步 bundle(记忆约束)。回滚 = git revert + gen-assets。
- P1.9 纯声明(yaml + 文档 + generated),无行为面。
- 所有改动经 AC 门禁(tsc / bun test / gen-assets / check-skills / check-harness-consistency)验证。
