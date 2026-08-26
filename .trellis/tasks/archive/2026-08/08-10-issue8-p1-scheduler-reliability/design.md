# Design: 调度可靠性三件套（#5 + #6 + #7）

## #6 — inbox 批次守卫默认方向写反

### 现状（`execute.ts:232-236`）
```ts
let batchChanged = true;
if (isInboxTask && batchLog !== null && isFile(batchLog)) {   // 条件为假 → 整段跳过
  const st = statSync(batchLog);
  batchChanged = st.mtimeMs !== batchBefore.mtime || st.size !== batchBefore.size;
}
```
`batchChanged` 初始 `true`（默认安全方向写反）。`batchLog === null`（无 filehub）或文件缺失时跳过 → 保持 true → `failed = ... || (isInboxTask && !batchChanged)` 为假 → 记 ok。

### 修复
```ts
let batchChanged = true;
if (isInboxTask) {
  if (batchLog !== null && isFile(batchLog)) {
    const st = statSync(batchLog);
    batchChanged = st.mtimeMs !== batchBefore.mtime || st.size !== batchBefore.size;
  } else {
    batchChanged = false; // 无 filehub 或 batch 日志从未出现 → batch-stale，不假成功
  }
}
```
失败分支（`openOrUpdate(..., "batch-stale", ...)` + 行含 `batch-stale`）已有，无需改。exitCode 语义不变（batch-stale → exit 0）。

### 测试（execute.test.ts）
| 用例 | filehubRoot | batch 文件 | harness | 期望 |
|---|---|---|---|---|
| 无 filehub | `() => null` | — | fakeHarness | `batch-stale` |
| filehub 但文件未出现 | `() => fh`（临时目录） | 无 | fakeHarness | `batch-stale` |
| 文件存在但未更新 | `() => fh` | 预置 | fakeHarness（不碰） | `batch-stale` |
| 文件被更新（正控制） | `() => fh` | 预置 | 追加 batch 的 fake harness | `ok` |

正控制 fake harness：`#!/bin/sh\necho ran >> '<batchLog>'\nexit 0`（路径在测试内拼好再写脚本）。

## #7 — acquireLock 毒锁

### 现状（`lock.ts:38-69`）
`openSync("wx")` 成功 → `writeSync` 抛 ENOSPC/EIO → `finally` close → 外层 catch **一律当作 EEXIST** → stat 到自建 0 字节锁（age≈0）→ 返回 null。毒锁留盘 staleMs（默认 1h）全员 skip。

### 修复（区分 EEXIST 与其它 errno）
```ts
function isEexist(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "EEXIST" || (typeof err?.message === "string" && err.message.includes("EEXIST"));
}
```
- `created` 标志跟踪 `openSync` 是否成功。
- catch 分支：
  - **非 EEXIST**：若 `created`（锁文件是我们建的）→ `unlinkSync(path)` 清毒锁 → **重抛**（暴露真实错误，调用方 `cronRun` 的 try/finally 会释放 —— 但此时没拿到 lock，无需 release；`fail()` 传播）。
  - **EEXIST**：保持原 stale 检查路径。
- `fd` 在 finally 中 best-effort close。

### 测试（lock.test.ts）
- 新用例：fakeFs 覆写 `writeSync` 抛 `code:"ENOSPC"` → `acquireLock` **toThrow**（非 null）且 `fs.files` 为空（毒锁被 unlink）。
- 现有 EEXIST 用例（`new Error("EEXIST")` 仅 message）经 `isEexist` message 兜底仍绿；顺手把 fakeFs 的 EEXIST 改为 `code` 属性（可选）。

## #5 — spawn 超时 SIGTERM → SIGKILL + timedOut 标志

### 现状（`spawn.ts:75-91`）
- timer 只 SIGTERM（POSIX）/ taskkill（win32）；SIGKILL 仅在 kill 抛错时兜底。忽略 SIGTERM 的 harness → `await child.on("exit")` 永不结束。
- `timedOut = Date.now() - started > opts.timeoutMs`：墙钟比较，恰在超时后正常退出会被误标。

### 修复
```ts
const SIGKILL_GRACE_MS = 3000;
export interface SpawnOpts { ...; /** SIGTERM → SIGKILL 宽限期（测试可注入小值）。 */ killGraceMs?: number; }

let killed = false;
let killTimer: ReturnType<typeof setTimeout> | undefined;
const timer = setTimeout(() => {
  killed = true;
  if (opts.platform === "win32") {
    try { spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]); } catch { /* ignore */ }
  } else {
    try {
      process.kill(-child.pid!, "SIGTERM");
      killTimer = setTimeout(() => {          // 宽限期后仍存活 → SIGKILL
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
      }, opts.killGraceMs ?? SIGKILL_GRACE_MS);
    } catch {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }   // pid 已死等 → 直接强杀
    }
  }
}, opts.timeoutMs);
...
clearTimeout(timer);
if (killTimer !== undefined) clearTimeout(killTimer);
const timedOut = killed;   // 仅 timer 回调置位，无墙钟竞态
```

### 测试（spawn.test.ts，POSIX 限定）
- 忽略 SIGTERM：`#!/bin/sh\ntrap '' TERM\nwhile true; do sleep 1; done`，`timeoutMs: 200` + `killGraceMs: 150` → `timedOut === true`、`exit !== 0`、总耗时 < ~1s（SIGKILL 生效）。
- 正常快速退出：`exit 0` 立即 → `timedOut === false`、`exit === 0`。
- win32 分支跳过（`process.platform === "win32"` 时 return）。

### 风险
- `killGraceMs` 只影响超时终止路径；execute.test 既有 `sleep 30`（吃 SIGTERM）用例走默认 3s 宽限但 sleep 立即响应 SIGTERM → 不拖慢。
- `timedOut` 从墙钟改 flag：语义更准（timer 真的触发过），既有 timeout 用例仍绿。
