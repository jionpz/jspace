# Design — CLI 正确性 bug:cron split-brain + 二进制 contentHash

> 技术设计。对齐 `prd.md` 的 R1–R4;不含逐步执行清单(见 `implement.md`)。

## 1. 现状与目标

### Bug A — cron 调度 split-brain
**现状**:两套 cron 安装实现并存且不一致。

| 面 | 实现 | 状态 |
|---|---|---|
| dry-run 预览 | `application/automation/use-cases.ts` `cronInstall(dryRun=true)` + `scheduler.ts` `planReconciliation`(纯) | ✅ 新引擎,但 `apply` 是 stub |
| 真实 install | `cli/cron.ts` `cmdCronInstall()` → `installDarwin/Linux/WindowsCrons`(legacy) | ⚠️ 生产实际走这条 |

**三处身份不一致**(`prd.md` Bug A 已列):新引擎注释 `com.jspace.cron.<tag>.<id>`(带 tag)、darwin 实际 `com.jspace.cron.<id>`(不带 tag)、dry-run 组装 `${tag}:${c.id}`。三者永不匹配 → dry-run 永远输出「全 create+全 delete」。

**跨工作台覆盖**:darwin plist 名只含 cron id,两个工作台都有 `inbox-tidy` 时互相覆盖 `~/Library/LaunchAgents/com.jspace.cron.inbox-tidy.plist`。`installedCronIds`(cli/cron.ts:184)darwin 分支不过滤 root。

**校验门不一致**:`validateSkillTargets` 只在 dry-run 跑;真实 `cmdCronInstall` 不做 skill 校验。

**目标**:`application/automation` 为唯一实现;三平台 backend 下沉为 `adapters/scheduler/*` 实现统一 `inspect/apply`;taskId 全平台统一 `com.jspace.cron.<workbenchTag>.<id>`;真实 install 也走 `validateSkillTargets`。

### Bug B — 二进制 contentHash
**现状**:`application/ingest/journal.ts:143` `sha256Of(readFileSync(plan.source, "utf-8"))` —— 按 utf-8 文本读入再哈希。PDF/PPTX/XLSX 有损(非法字节→U+FFFD),hash 非真实 sha256,且整文件进内存。

**目标**:对**字节**哈希(不带 encoding 得 Buffer);大文件流式。

## 2. 适配器接口(新引擎唯一实现)

`adapters/scheduler/` 新增三平台适配器,统一暴露:

```ts
export interface SchedulerAdapter {
  readonly platform: "darwin" | "linux" | "win32";
  /** list installed tasks scoped to this workbench tag; returns InstalledTask[] */
  inspect(tag: string): InstalledTask[];
  /** apply a single op; returns a human line for the report */
  apply(op: SchedulerOp, root: string, jspaceBin: string): string;
  /** platform guards used by dry-run/status */
  health?(): { ok: boolean; message: string };
}
```

- **identity 契约**:taskId 全平台 = `com.jspace.cron.<workbenchTag>.<id>`。darwin `plistPath`/Label 补 `<tag>`;linux crontab 注释行含 taskId;win32 schtasks 任务名含 tag(win32 现用 `shortHash(root)`,hash 的是路径 → 改用 `workbenchTag(workbench_id)`,统一输入)。
- **inspect**:darwin 扫 `~/Library/LaunchAgents/com.jspace.cron.<tag>.*.plist`;linux 读 crontab 里 managed block;win32 查 schtasks。**只收本 tag 的任务**(修跨工作台串扰)。
- **apply**:create/update = 写 plist/替换 crontab block/`schtasks /Create`;delete = 删 plist/移除 block/`schtasks /Delete`。
- **`workbenchTag` 收归单一**:`cli/cron.ts` 的 `shortHash`(hash 路径)删除,统一用 `scheduler.ts` 的 `workbenchTag`(hash `workbench_id`)。

## 3. 收敛路径

1. **抽 adapter**:把 `cli/cron.ts` 的 `installDarwin/Linux/WindowsCrons`、`uninstallDarwin/Linux/Windows`、`installedCronIds`、`plistPath` 等 backend 逻辑搬到 `adapters/scheduler/{darwin,linux,win32}.ts`,实现 `inspect/apply`。
2. **接新引擎**:`registry.ts` cron install 的 dry-run 分支和非 dry-run 分支统一走 `cronInstall()`(新引擎),真实路径也注入 `inspect/apply` + `validateSkillTargets`。legacy `cmdCronInstall`/`cmdCronUninstall` 删除。
3. **taskId 统一**:dry-run 的 `taskId: \`${tag}:${c.id}\`` 改为 `com.jspace.cron.${tag}.${c.id}`;darwin plist Label/路径同步。`planReconciliation` 的匹配不变(按 taskId)。
4. **跨工作台修**:`inspect` 只收本 tag 任务 → 两工作台各装各的,不互覆。
5. **校验门一致**:非 dry-run 也走 `validateSkillTargets`(deps 注入)。

## 4. Bug B 修复设计

```ts
// journal.ts beginIngest
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

function sha256File(p: string): string {
  const h = createHash("sha256");
  const fd = openSync(p, "r");
  try {
    const buf = new Uint8Array(65536);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return h.digest("hex");
}
```
- 字节级(不带 encoding),不整文件进内存。
- `contentHash` 语义从"utf-8 文本 hash"改为"文件字节 sha256"——对 dedupe 无行为破坏(只影响新 journal 的 hash 值;旧 committed journal 的 hash 是旧算法,但 dedupe 只查 committed 且按 source+content 双查,兼容)。
- 复用 `sha256Of`?——它在 `application/workspace/manifest.ts`,是字符串 hash(读文件做字符串)。**不复用**:`sha256Of(v)` 输入是 string。新增字节版 helper,放 `application/shared` 或就地实现。

## 5. 测试策略

| 层 | 覆盖 |
|---|---|
| adapter 纯函数 | `plistPath`/Label 含 tag、crontab managed block 增删、schtasksArgs 含 taskName 带 tag(已有 `cli/cron.test.ts` 纯函数,迁移到 adapter 测试) |
| reconciliation | taskId 匹配/update/delete;跨工作台两 tag 任务并存不互删(新增) |
| execute 注入 | timeout/`todaySuccess`/锁占用/suspect/batch-stale(新增,用 `ExecuteDeps`) |
| journal hash | 字节级 = `shasum -a 256`(新增 fixture:PDF/XLSX 各一) |
| 回归 | `bunx tsc --noEmit` + 全量 `bun test` |

## 6. 兼容与回滚

- **可直接 break**(用户决策):taskId 改名会让已装任务变 stale——install 时 reconcile 的 delete 分支天然兜(旧名任务 → delete);提供一次性 `cron uninstall && cron install` 迁移说明。
- **回滚点**:S0 基线 commit;每 adapter 独立可回退。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| adapter 下沉破坏现装任务 | install 前 rehearsal gate(`cron install --dry-run` 看清理计划);跨工作台测试 |
| `sha256File` 与现有 `sha256Of` 混淆 | 命名 `sha256File`(字节),`sha256Of`(字符串)注释互指 |
| execute.ts 零测试补测波动 | 用现成 `ExecuteDeps` 注入,spawn 包一层 stub |
