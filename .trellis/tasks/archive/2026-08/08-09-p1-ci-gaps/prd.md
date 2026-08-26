# P1: PR CI 缺口补全(P1-1 ~ P1-3)

## Goal

verify.yml 目前只做 gen-assets + 三个 generated.ts diff,漏了 skill 检查 / python 回归 / version 同步;`cron status` 漏 `--dir`;SchedulerEnv 契约注释与实现漂移。把 PR 质量门补齐,让断链 / 契约漂移在 PR 期就红,而不是等 tag 构建或运行时。

## Requirements

### P1-1 verify.yml 补三步校验

- **位置**: `.github/workflows/verify.yml:36–39`(现有 gen-assets + diff)。
- **补**:
  1. `bun run scripts/check-skills.ts`(C1–C4 skill 检查,含 `templates/workbench/AGENTS.md` reachability——目前只在 tag 向 `build.yml:116–117` 跑)。
  2. `python3 skills/asset-ingest/scripts/extract.test.py`(分层路由 / markitdown 回退回归)。
  3. `cli/version.generated.ts` vs `scripts/gen-version.ts` 一致性 —— 注意 CI 上 `git describe` 受 fetch-depth 限制,考虑 `git fetch --unshallow` 或仅在 tag 构建检查;若不可行则记录原因。
- **验收**: PR CI(非 tag)也执行这三步。

### P1-2 `cron status` 补 `--dir`

- **位置**: `cli/commands/cron.ts:149–154`。
- 现状:同文件 `failures`/`ack`/`list`/`enable`/`disable`/`install`/`uninstall` 都有 `features: { dir: true }`,唯独 `status` 没有;parse 只从叶子 spec 收集 `--dir`。`verify.yml:65` 被迫 `cd` 进工作台。
- **修复**:`status` 加 `features: { dir: true }`,handler 用 `ctx.root`(已统一 CmdContext)。`verify.yml:65` 从 `(cd /tmp/jspace-verify && ... cron status)` 改为 `... cron status --dir /tmp/jspace-verify`。

### P1-3 SchedulerEnv 契约注释 / 实现统一

- **位置**: `adapters/scheduler/types.ts:42–43, 62`、`adapters/scheduler/linux.ts:3–4, 136–144`、`adapters/scheduler/win32.ts:105, 131`。
- 现状:`SchedulerEnv.resolvePath` 对 linux 是死字段,注释是过期谎言;win32 的 inspect/uninstallAll 丢弃 root/env。
- **修复(方向 A,接口瘦身)**:从 `SchedulerEnv` 去掉 `resolvePath`;给 `inspect`/`uninstallAll` 加 `root` 可选参数(有 adapter 需要时);保证「参数 = 实际使用」。同步更新 types.ts 注释与各 adapter 实现。
- **注意**:P2-1 会进一步重构 scheduler 端口(内容编译下沉 adapter),本项先做契约瘦身,不与 P2-1 冲突(先 P1-3 后 P2-1)。

## Acceptance Criteria

- [ ] `.github/workflows/verify.yml` 含 check-skills / extract.test.py / version 一致性三步(或记录 fetch-depth 限制的替代方案)。
- [ ] `cli/commands/cron.ts` status 支持 `--dir`;`cron status --dir <workbench>` 与 `(cd <workbench> && cron status)` 输出一致。
- [ ] `verify.yml:65` 使用 `--dir` 形式。
- [ ] `adapters/scheduler/types.ts` 无 `resolvePath` 死字段;`inspect`/`uninstallAll` 签名与实现一致;注释无过期内容。
- [ ] `bun test adapters/scheduler application/automation/scheduler-service.test.ts cli/cron.test.ts` 全绿。
- [ ] `bunx tsc --noEmit` 通过。

## Notes

- 本批次改动触及 CI 配置与 scheduler 契约,不动 application 层行为。
- P1-3 与 P2-1 都动 scheduler;P1-3 先行(瘦身),P2-1 后行(重构),避免在同一批次改同一文件。
