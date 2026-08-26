# Issue #7 P1: CI 校验体系 + idle 语义 + session_end 评级

## Goal

修复专家 review(issue #7)的 P1 批次 5 项(issue 编号 5-9),让 CI 防御网与防护网对齐、OpenCode idle 语义与 Claude 一致、session_end 评级诚实。

## Requirements

### R1 — CI 校验重排 + 复用 manifestPaths(P1.5)

- **R1.1** 新建 `scripts/check-manifest-integrity.ts`,复用 `scripts/asset-integrity.ts` 的 `manifestPaths()`,替代 verify.yml 的 inline regex(消除分叉)。
- **R1.2** `.github/workflows/verify.yml` 重排:install → **manifest 完整性检查(对 committed manifest,在 gen-assets 之前)** → gen-assets + git diff(freshness)→ version/harness/docs → tsc → test → python → full-chain。
- **R1.3** `scripts/check-skills.ts` C4 的 gen-assets 调用改 `stdio: "inherit"`(guard 失败时详细错误可见,而非含糊的 `Command failed`)。

### R2 — git 跟踪检查(P1.6,issue #6 根因)

- **R2.1** `check-manifest-integrity.ts` 对每个 manifest path 执行:`git ls-files --error-unmatch`(必须被跟踪)+ `git check-ignore --no-index`(必须不被忽略)。
- **R2.2** CI 在任何 gen-assets 之前跑该检查(对 committed manifest),本地同样可跑。

### R3 — OpenCode idle 语义:只提醒不 flush(用户拍板;P1.7)

- **R3.1** `templates/workbench/.opencode/plugins/jspace.ts`:`session.idle` 分支**移除自动 `pending apply`**,改为跑 `jspace cron check`(非 quiet),exit != 0 时把输出经 `client.session.prompt noReply` 注入为可见提醒(`session.idle` payload = `{ sessionID }`,已核实)。
- **R3.2** 与 Claude/Grok 一致:staged 写不自动 flush,由用户显式触发。D3 纪律不变(永不自动 writeback)。
- **R3.3** `createEventHandler` deps 重构:`spawn` 移除,idle 不再 fire-and-forget。
- **R3.4** `cli/init.test.ts:110-111` 断言同步更新(不再含 `pending apply --quiet`)。
- **R3.5** `skills/jspace-use/references/harness-opencode.md` 更新 idle 行为 + 修正 P0 造成的文档漂移(session.created 现在是注入,spawn 有 guard)。

### R4 — 测试网扩展(P1.8)

- **R4.1** 新建 `scripts/manifest-integrity.test.ts`(bun test):manifest ⊆ 磁盘、ASSETS keys == manifest paths、sha256 一致。

### R5 — session_end 评级降级(P1.9)

- **R5.1** `adapters/harness/capabilities.yaml`:claude / opencode / pi 的 `session_end` `best_effort` → `manual`(grok 保留 best_effort——有真实 SessionEnd 接线;cursor 已 manual)。
- **R5.2** 同步 `harness-claude.md` / `harness-opencode.md` / `harness-pi.md` 生命周期表格行。
- **R5.3** 重跑 `gen-assets` 同步 `capabilities.generated.ts` 与嵌入的 plugin。

## Acceptance Criteria

- [ ] AC1 `scripts/check-manifest-integrity.ts` 在 clean 仓库跑 pass(所有 path 存在 + 跟踪 + 不被忽略)
- [ ] AC2 构造一个 gitignored 源文件场景,`check-manifest-integrity.ts` 能红(未跟踪/被忽略被抓住)
- [ ] AC3 `bun run scripts/manifest-integrity.test.ts` 通过(manifest ⊆ 磁盘、ASSETS ↔ manifest、sha256)
- [ ] AC4 plugin 单测:`session.idle` 调 checkCron(sessionID)、**不含** pending apply、不自动 writeback
- [ ] AC5 verify.yml 顺序:manifest 完整性检查在 gen-assets 之前;inline regex 检查已移除
- [ ] AC6 capabilities.yaml + 3 个 harness 文档 session_end 一致(manual),grok 保持 best_effort
- [ ] AC7 `bunx tsc --noEmit` + `bun test` 全过
- [ ] AC8 `bun run scripts/gen-assets.ts` 后 git diff 无残留(模板/yaml 已同步)
- [ ] AC9 `bun run scripts/check-skills.ts` + `scripts/check-harness-consistency.ts` 通过

## Out of Scope

- P2 批次(issue #7 编号 10-15):gitignore 例外策略、Cursor hook、AGENTS/README 重写、GEN_ASSETS_ALLOW_MISSING、check-harness-consistency 表驱动、test.py skip
- P3 批次(16-19)
- P0 已完成项(#4 release.needs 已在 P0 落地)
