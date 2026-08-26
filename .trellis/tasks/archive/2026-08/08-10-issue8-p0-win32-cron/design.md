# Design: Win32 cron 任务名错位（#1）

## 问题定位

`adapters/scheduler/win32.ts` 内存在两个任务名来源：

```ts
// buildContent（120-125）
const tn = taskIdFor(tag, cron.id);              // com.jspace.cron.<tag>.<id>  ← 错
const args = schtasksArgs(cron, env.jspaceBinary, root, tn);

// identity（114-118）
return { logicalId: taskIdFor(tag, cron.id), taskId: `JSpaceCron_${tag}_${cronId}` };  // ← 对
```

`taskIdFor` 是 POSIX 身份（`types.ts:86-88`），Win32 的 schtasks `/tn` 不能含 `.` 前缀约定（schtasks 允许点，但 inspect 前缀过滤是 `JSpaceCron_${tag}_`，两侧必须一致）。`queryTasks`（`win32.ts:10-18`）与 `uninstallAll` 均按 `JSpaceCron_${tag}_` 前缀识别 → 点形式任务成为孤儿。

## 修复方案（单一事实源）

在 `win32.ts` 加模块级助手，让 `identity` 与 `buildContent` 共用同一格式：

```ts
/** Win32 schtasks real task-name handle (also the inspect/queryTasks prefix). */
function win32TaskName(tag: string, cronId: string): string {
  return `JSpaceCron_${tag}_${cronId}`;
}
```

- `identity()` 返回 `{ logicalId: taskIdFor(tag, cronId), taskId: win32TaskName(tag, cronId) }`。
- `buildContent()` 的 `const tn = win32TaskName(tag, cron.id);`。
- `inspect()` 的 `cronId` 切分可复用 `win32TaskName(tag, "").length` 取代字面量 `"JSpaceCron_${tag}_".length`（可选，低风险），`queryTasks` 前缀同理——保持不手写第二处拼接即可，非必须。

**为什么不直接 `this.identity(...)`**：`win32Adapter` 是对象字面量，`buildContent` 不使用 `this`；加模块级纯函数比 `win32Adapter.identity(...)` 自引用更简单、无 TDZ 风险、便于单测。

## 回归测试设计

所有测试为纯单元测试（CI 跑 ubuntu-latest，不真调 schtasks）。

### T1: adapter 回归（`adapters/scheduler/scheduler.test.ts`）
新增用例：对 DAILY + WEEKLY 各一 cron，`JSON.parse(win32Adapter.buildContent(cron, tag, root, env))` 断言：
- argv 中 `/tn` 后一位 === `win32Adapter.identity(tag, cron.id).taskId`；
- 该值以 `JSpaceCron_${tag}_` 开头（保证 inspect/uninstall 前缀能命中）。

```ts
function tnOf(content: string): string {
  const argv = JSON.parse(content) as string[];
  return argv[argv.indexOf("/tn") + 1];
}
```

### T2: 改造现有收敛测（`scheduler.test.ts:267-279`）
把 `const content = JSON.stringify(schtasksArgs(...))` 改为 `const content = win32Adapter.buildContent(cron, tag, "C:\\wb", { jspaceBinary: "C:\\bin\\jspace.exe", home: "C:\\Users\\u", path: "C:\\bin" })`，其余断言不变。→ 绿测开始真实走 `buildContent`，本缺陷即被该测覆盖（当前代码下 `/tn` 会是点形式，`inspect` 前缀命中失败 → 收敛测若补 inspect 前缀校验即红）。

### T3: service↔adapter 一致性（`application/automation/scheduler.test.ts` 或新增）
调 `buildDesired(crons, tag, root, env, win32Adapter)`，对每个 desired 断言 `JSON.parse(desired.content)` 的 `/tn` === `desired.taskId`。闭合 `scheduler-service`（desired 侧）与 adapter（content 侧）的契约。

### 手动验证（不进 CI）
Windows 真机：`jspace cron install` → `jspace cron status`（inspect 非空、无重复 create）→ `jspace cron uninstall`（任务清空）。本地无 Windows 时记为待办。

## 风险与兼容

- 修改仅影响 win32 `buildContent` 产出的 `/tn` 值；`parseOpContent`/`parseSchtasksXml` 契约不变。
- 已有错误命名的孤儿任务：修复后 `inspect` 仍查不到旧点形式任务，用户需手动 `schtasks /delete /tn com.jspace.cron.<tag>.<id> /f` 一次（或首次 `cron install` 仍 create 新正确名任务、旧任务残留，属一次性迁移）；在 prd Notes 记录该一次性迁移提示。
- darwin/linux 零影响（`taskIdFor`/`posixIdentity` 不动）。
