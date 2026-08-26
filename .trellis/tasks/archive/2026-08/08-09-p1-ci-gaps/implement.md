# P1 CI 缺口 — 执行计划

## 执行顺序

### 1. P1-2 cron status --dir(最小,先做)
1. `cli/commands/cron.ts:149–154` 给 `status` 子命令加 `features: { dir: true }`。
2. 确认 handler 已用 `ctx.root`(CmdContext 统一)。
3. 本地验证:`bun run cli/main.ts cron status --dir <tmp-workbench>` 与 `(cd <tmp-workbench> && bun run cli/main.ts cron status)` 输出一致。

### 2. P1-3 SchedulerEnv 契约瘦身(方向 A)
1. `adapters/scheduler/types.ts` 去掉 `SchedulerEnv.resolvePath`;`inspect`/`uninstallAll` 按需加 `root` 可选参数。
2. `adapters/scheduler/linux.ts:136–144` inspect 实现与签名对齐;删 `env.resolvePath` 相关死码。
3. `adapters/scheduler/win32.ts:105, 131` 不丢弃 root/env(用上或删参数)。
4. 更新 types.ts 注释(去除过期「linux 用 env.resolvePath」描述)。
5. 跑 `bun test adapters/scheduler application/automation/scheduler-service.test.ts`。

### 3. P1-1 verify.yml 补三步
1. 读 `.github/workflows/verify.yml` 现状与 `build.yml` 的 check-skills 步骤(116–117)。
2. 加步骤:`bun run scripts/check-skills.ts`、`python3 skills/asset-ingest/scripts/extract.test.py`。
3. version 一致性:CI 上 `git fetch --unshallow` 后 `bun run scripts/gen-version.ts && git diff --exit-code cli/version.generated.ts`;若 fetch 成本高 → 仅在 tag 构建检查,在注释记录原因。
4. `verify.yml:65` 改 `cron status --dir /tmp/jspace-verify`。

## 验证命令
- `bun test adapters/scheduler application/automation cli/cron.test.ts`
- `bun test`(全仓)+ `bunx tsc --noEmit`
- workflow 语法:`python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/verify.yml'))"`(无 actionlint 时)

## Review Gates
- CI 改动无法本地跑全量 → 提交后观察 PR 的 verify 跑绿;若 actionlint 可用则先本地 lint。
- P1-3 改动后确认 darwin/linux/win32 三平台 scheduler 相关测试都过。
