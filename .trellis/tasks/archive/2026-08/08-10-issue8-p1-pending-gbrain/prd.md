# P1: pending realGbrain 下沉 adapter（issue #8 #8）

## Goal

修复 `pending apply` 的 `realGbrain` 裸 `spawnSync`（`application/pending/apply.ts:80-94`）：无超时、无输出上限、绕开 `adapters/process/spawn.ts`（自称"进程 I/O 唯一入口"）。gbrain 锁住或 hung 时，OpenCode `session.idle` hook 跑 `pending apply --quiet` 会**永久卡住**。修复：`realGbrain()` 下沉到 `adapters/gbrain/`，复用 `spawnProcess`（timeout + 1MiB cap + stdin），application 只依赖 `GbrainDeps` 端口。

父任务：`08-10-issue8-review-fixes`。

## Background（现状）

- `application/pending/apply.ts:81-94` `realGbrain()`：`spawnSync("gbrain", ["get", slug])` / `spawnSync("gbrain", ["put", slug], { input: content })`——同步、无 timeout、输出无 cap。gbrain 挂起 → hook 永久卡。
- cron 路径（`adapters/process/spawn.ts`）已有：timeout SIGTERM→SIGKILL、1MiB 输出 cap、async 非阻塞。
- `spawnProcess` 目前 `stdio: ["ignore","pipe","pipe"]`（无 stdin），`SpawnResult.output` 为 stdout+stderr 合并——gbrain `put` 需 stdin 喂内容、`get` 需纯 stdout 内容（dedup 用 sha256 比对，stderr 混入会破坏）。

## Requirements

1. 新增 `adapters/gbrain/gbrain.ts`：
   - `GbrainDeps` 端口（`get`/`put` 返回 Promise）——接口从 `application/pending/apply.ts` 移到这里（application 只依赖端口）。
   - `realGbrain(run = spawnProcess, timeoutMs = 30s)`：`get` 用 stdout、`put` 用 stdin（`input`）、均 1MiB cap + timeout；`timedOut`/exit≠0 → `{ok:false}`。
   - `run` 可注入（测试用 fake run 验证接线，不真调 gbrain）。
2. `adapters/process/spawn.ts` 扩展（向后兼容，纯增量）：
   - `SpawnOpts.input?: string`（写 stdin 后 close）。
   - `SpawnResult` 增 `stdout`/`stderr` 字段（`output` 保持合并不变，既有调用不回归）。
3. `application/pending/apply.ts`：删本地 `GbrainDeps`/`realGbrain`；`applyPending` 改 async（await get/put）；从 `adapters/gbrain/gbrain.ts` 引 type。
4. `application/pending/use-cases.ts`：`pendingApply` 改 async（`await applyPending`）；默认 `gbrain = realGbrain()`（来自 adapters/gbrain）。
5. `cli/commands/pending.ts`：`pending apply` handler 改 async 并 `await pendingApply(...)`（CommandSpec handler 已支持 Promise）。

## Acceptance Criteria

- [x] `adapters/gbrain/gbrain.test.ts`（新，6 用例）：fake run——`get` exit0+stdout → `{ok:true,content}`；exit1 / timedOut → `{ok:false}`；`put` exit0 → `{ok:true}`、exit1 → `{ok:false,error}`；`put` 的 run 收到 `input: content` 与 timeoutMs；`get` 不传 stdin。
- [x] `spawn.test.ts`：stdin round-trip（`sh -c cat` 回显 input）；stdout/stderr 分离（`echo out; echo err >&2` → stdout="out\n"、stderr="err\n"）；既有用例（含 #3/#5 新用例）不回归。
- [x] `apply.test.ts`（stub 改 Promise + await）+ `use-cases.test.ts`（async）：全部用例绿，幂等/去重/重试/terminal 语义不变。
- [x] CLI 冒烟：temp filehub + 真实 gbrain（`~/.bun/bin/gbrain`）→ `pending stage` + `pending apply` 走真实 spawnProcess 路径 applied 成功、~2s 不挂死。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 528/528 绿；import-boundary 环守卫 + 三个一致性脚本全绿。

## Out of Scope（本批不做）

- #16（gbrain wire 多 harness 统一）→ `08-10-issue8-p2-contracts-doctor`。
- gbrain CLI 本身的 serve 锁/并发语义——仍是外部系统，不改。
