# issue4 applyBatch 直测 + 版本报错指引 — 设计

> 依赖 child2(linux-apply-port)先完成:本设计的 seam 改动在 `linux.ts` 已删 `apply()` 之后进行。

## 5. linux applyBatch 直测 — 注入 seam

### 现状

`linux.ts` 的 `readCrontab()` / `writeCrontab()` 是模块私有函数,直接 `spawnSync("crontab", ...)`。
`scheduler.test.ts` 现有 linux 测试全部是纯函数级(`crontabBlock` / `replaceManagedBlock` / `parseManagedLine`),
不触真实 crontab;真实 `linuxAdapter.applyBatch` 无直接测试。

### 注入设计(最小 seam,不改 SchedulerAdapter 接口)

linuxAdapter 增加**可选** `io` 字段(接口之外的附加属性,类型用交叉类型):

```ts
/** crontab 读写 IO。生产默认走 spawnSync crontab;测试注入此 seam,不触真实 crontab。 */
export interface CrontabIO {
  readCrontab(): string;
  writeCrontab(content: string): void;
}

const defaultIO: CrontabIO = {
  readCrontab() { /* 原函数体,含 status 分支与 fail */ },
  writeCrontab(content) { /* 原函数体 */ },
};

export const linuxAdapter: SchedulerAdapter & { io?: CrontabIO } = { ... };
```

所有读写 crontab 的方法(`inspect` 读 / `applyBatch` 读写 / `uninstallAll` 读写)统一取
`const io = linuxAdapter.io ?? defaultIO` 后走 io。生产行为零变化;测试时临时替换 `linuxAdapter.io`
(用 try/finally 还原),无需触碰真实 crontab。

> 注:对象字面量方法内引用 `linuxAdapter.io` 是模块级 const 的运行时取值,定义后方法调用前已初始化,安全。

### 两个用例(scheduler.test.ts)

复用现有 `mkCron` 等 helper 与 `CRON_BLOCK_START/END` 常量:

1. **空 enabled 清块**:现有 crontab = 系统行 + tagA 块(2 个 cron) + tagB 块;
   `applyBatch(ops, enabled=[], tagA, root, env)` → 写回不含 tagA 的 marker 行/块;
   tagB 块与系统行原样保留。断言:`written` 不含 `CRON_BLOCK_START("tagA")`,含 `CRON_BLOCK_END("tagB")` 与系统行。
2. **非空 enabled 整块重建**:现有块只有 cron-a;`applyBatch(ops, enabled=[a, b], tagA, root, env)`
   → 块含 a+b 两行、marker 完整;再跑一次(幂等)结果不变。

## 6. 旧版本契约字段报错 — 修复指引

### 问题

schema 统一到 `schema_version`(issue #3 P2-2)后,旧格式状态文件(`version: "4"` 的 hub.json /
`version: 1` 的 cron.json 等)被 decoder 判 damaged,报错只有 `must be one of 1`,不给修复路径。
维持"无兼容性负担"原则,只加文案,不引入迁移通道。

### version issue 的 code 规律(已核实)

所有 decoder 统一走 `readVersion`(`core/contracts/diagnostics.ts:137`),issue code 形如
`<contract>.version.unsupported`:

- hub: `hub.version.unsupported` / local: `local.version.unsupported` / marker: `marker.version.unsupported`
- cron: `cron.version.unsupported` / ingest / skills / workbench / state 同构

→ 以 `.version.unsupported` 结尾即可覆盖所有旧格式场景。

### 改动点

1. **`core/contracts/diagnostics.ts`**:导出修复指引常量(单一事实源,两处共用):

   ```ts
   export const SCHEMA_VERSION_REPAIR_HINT =
     "state file was written by a pre-schema_version jspace; regenerate with `jspace init <dir> --force` " +
     "(destructive — review first) or edit `version: ...` → `schema_version: 1` by hand";
   ```

2. **`core/registry/inspect.ts` `asErrors`**(marker/hub/local 三处 decoder error 的统一出口,line 32–34):
   对 `code.endsWith(".version.unsupported")` 的 issue,`message` 追加 `" — " + SCHEMA_VERSION_REPAIR_HINT`。

3. **`application/automation/definitions.ts` `loadCrons`**(line 33–34):
   `fail(decoded.issues.map(...))` 中,对 `code.endsWith(".version.unsupported")` 的 issue 同样追加 hint。

### 单测

`definitions.test.ts` 新增:写旧格式 `cron.json`(`{ version: 1, crons: [] }`)到临时 workbench,
`loadCrons` 抛错,`expect(() => loadCrons(root)).toThrow(/init|schema_version/)`。

### 现有测试影响(已核实安全)

- version 断言均为 `expectIssue(...code...)`(查 code 不查 message)或 `toContain("must be one of 1")`,
  追加 hint 不破坏。
- `doctor.test.ts` 的 message 断言为 `toContain`,安全。

## 验证

- `bun test`(新增 3 用例 + 全量回归)
- `tsc` 通过
- `check-skills` 不回归(如相关)
