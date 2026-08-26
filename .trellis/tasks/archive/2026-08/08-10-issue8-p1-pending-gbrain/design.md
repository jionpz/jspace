# Design: pending realGbrain 下沉 adapter（#8）

## 目标形态

```
application/pending/{apply,use-cases}.ts  --依赖端口-->  adapters/gbrain/gbrain.ts  --spawnProcess-->  adapters/process/spawn.ts
```

application 不再 import `node:child_process`；进程 I/O 唯一入口是 `adapters/process/spawn.ts`。

## 1. `adapters/process/spawn.ts` 增量扩展

- `SpawnOpts` 加 `input?: string`：写入子进程 stdin 后 `end()`。`stdio` 从 `["ignore","pipe","pipe"]` 变为 `[opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"]`。
- `SpawnResult` 加 `stdout: string` / `stderr: string`：现在 stdout/stderr 各自收集（分 Buffer，各自 cap 1MiB），`output` 仍为合并（既有 cron log 不回归）。

```ts
export interface SpawnResult {
  exit: number;
  output: string;      // stdout+stderr (legacy combined — unchanged)
  stdout: string;      // NEW
  stderr: string;      // NEW
  timedOut: boolean;
}
export interface SpawnOpts {
  cwd: string;
  platform: string;
  timeoutMs: number;
  killGraceMs?: number; // #5
  input?: string;       // NEW: write this to stdin then close
}
```

spawn 后（若 input）：
```ts
if (opts.input !== undefined && child.stdin) {
  child.stdin.write(opts.input);
  child.stdin.end();
}
```

## 2. `adapters/gbrain/gbrain.ts`（新）

```ts
export interface GbrainDeps {
  get: (slug: string) => Promise<{ ok: boolean; content?: string }>;
  put: (slug: string, content: string) => Promise<{ ok: boolean; error?: string }>;
}
export type GbrainRun = (argv: string[], opts: SpawnOpts) => Promise<SpawnResult>;
export const GBRAIN_TIMEOUT_MS = 30_000;

export function realGbrain(run: GbrainRun = spawnProcess, timeoutMs: number = GBRAIN_TIMEOUT_MS): GbrainDeps {
  const base = { cwd: process.cwd(), platform: process.platform, timeoutMs };
  return {
    async get(slug) {
      const r = await run(["gbrain", "get", slug], base);
      return r.exit === 0 && !r.timedOut ? { ok: true, content: r.stdout } : { ok: false };
    },
    async put(slug, content) {
      const r = await run(["gbrain", "put", slug], { ...base, input: content });
      return r.exit === 0 && !r.timedOut
        ? { ok: true }
        : { ok: false, error: `${r.stderr}${r.stdout}`.trim().slice(0, 300) || "gbrain put failed" };
    },
  };
}
```

`run` 可注入（测试 fake run 断言 argv/timeout/input 接线，不真调 gbrain）。`get` 用 `r.stdout`（stderr 不进 content，dedup sha256 不脏）。

## 3. application 侧 async 化

- `apply.ts`：删 `GbrainDeps`/`realGbrain`；`import type { GbrainDeps } from "../../adapters/gbrain/gbrain.ts"`；`applyPending` → `async`，循环内 `await gbrain.get(...)` / `await gbrain.put(...)`。逻辑（幂等/去重/重试/terminal）逐行不变。
- `use-cases.ts`：`pendingApply` → `async`，`const res = await applyPending(fh, gbrain, id)`；默认 `gbrain = realGbrain()`（从 adapters/gbrain import）。
- `cli/commands/pending.ts`：`pending apply` handler → `async` + `await pendingApply(...)`（CommandSpec handler 签名 `CmdResult | Promise<CmdResult>` 已支持）。

## 4. 测试

- `adapters/gbrain/gbrain.test.ts`：fake `run` 返回固定 `SpawnResult`——get ok/content、get fail、get timedOut、put ok、put fail(error 截断)、put 收到 `input`/`timeoutMs`。
- `spawn.test.ts`：stdin round-trip（`sh -c cat` 回显 input）；stdout/stderr 分离（`echo out; echo err >&2`）；#3/#5 既有用例不回归。
- `apply.test.ts`：stub get/put 返回 Promise，`await applyPending(...)`；语义用例原样。
- 冒烟：temp filehub + 无 gbrain 二进制 → `pending apply` exit 1（`{ok:false}` → retryable）不挂死。

## 风险与兼容

- `applyPending`/`pendingApply` 改 async：CLI handler 已支持 Promise；hook 是外部子进程调用，不受影响。
- `spawnProcess` 增字段是纯增量：`output` 语义不变，`exit`/`timedOut` 不变。
- `realGbrain()` 默认 timeout 30s：hook 不再永久卡；gbrain 真慢时最多等 30s。
