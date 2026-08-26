# Design: 安全路径（#3 + #4 + #12 + #15）

## #4 — ingest 源文件边界

### 现状
- `use-cases.ts:40-55` `ingestBegin`：只校验 `target` 在 filehub 下，`source`（`args.file`）不校验（可相对、可任意绝对路径）→ 拷敏感文件进 filehub + journal 存非绝对 source。
- `journal.ts:258-261` `finishCleanup`：`ops.unlink(pending.source)` 无条件删源；`source` 相对则按当时 cwd unlink。
- `journal.ts:295-305` `failIngest`：`ops.unlink(j.target)`（staged 补偿）。

### 修复
**1. begin 源限制 + 绝对化**（`use-cases.ts`）：
```ts
const fh = resolveFilehubRoot(root);
if (!fh) fail(...);
const inboxDir = join(fh, "_inbox");
const sourceAbs = resolve(args.file);
if (!isWithin(sourceAbs, inboxDir)) {
  fail(`source must be inside the filehub inbox (${inboxDir}): ${args.file}`);
}
...
beginIngest(root, { source: sourceAbs, target, relPath, ... }, ops);
```
（`isWithin` from `application/registry/helpers.ts`；`resolve` from node:path。）

**2. unlink 边界守卫**（`use-cases.ts` 新增 root-aware ops，供 advance/fail/rollback 用）：
```ts
function filehubOps(root: string): IngestFileOps {
  const fh = resolveFilehubRoot(root);
  if (!fh) fail(`jspace: no filehub registered for workbench ${root}; run "jspace filehub init" first`);
  return {
    copyFile: copyFileSync,
    unlink: (p) => {
      const abs = isAbsolute(p) ? p : resolve(p);
      if (!isWithin(abs, fh)) fail(`refusing to remove a file outside the filehub: ${p}`);
      unlinkSync(p);
    },
  };
}
```
`ingestAdvance`/`ingestFail`/`ingestRollback` 改用 `filehubOps(root)`（begin 的 copy 仍可用 REAL_OPS 或 filehubOps——copy 目标已校验在 filehub 下）。

**3. 契约层防御**（`core/contracts/ingest.ts` decoder）：
`source`/`target` 要求绝对路径（`isAbsolutePath` from paths.ts），`relPath` 拒绝 `.`/`..` 段。新增 issue code：`ingest.source.absolute` / `ingest.source.traversal` / `ingest.target.absolute` / `ingest.target.traversal` / `ingest.relPath.traversal`。

### 测试（use-cases.test.ts）
- `begin` 源在 `_inbox` 外 → `toThrow(/filehub inbox/)`。
- `begin` 源在 `_inbox` 内 → staged、`readJournals(...).records[0].source` 为绝对路径。
- 手改 journal `source` 指向 filehub 外 → `ingestAdvance --committed` → `toThrow(/outside the filehub/)`（guard 生效，源未被删）。
- decoder：`source`/`target`/`relPath` 含 `..` → decode issues（state.test 或 ingest 契约测试）。

## #3 — Windows cmd 元字符转义

### 现状（`spawn.ts:42-45`）
`quoteIf = (a) => (/\s/.test(a) && !/^"/.test(a) ? \`"${a}"\` : a)`——无空白的 `hello&calc.exe` 不引号；以 `"` 开头的参数（`" & whoami`）不引号 → cmd 元字符活跃 → RCE。

### 修复（cmd 转义）
```ts
function cmdEscapeArg(a: string): string {
  if (!/[\s&|<>^%!"]/.test(a)) return a; // 无特殊字符 → 原样
  return `"${a.replace(/"/g, `""`)}"`;  // 整体加引号（cmd 引号内 &|<>^% 为字面量）+ 内嵌 " 双写
}
```
`win32SpawnTarget` 的 `.cmd` 分支改用 `cmdEscapeArg`。`& | < > ^ %` 在 cmd 双引号内是字面量；`!` 仅延迟展开启用时活跃（默认关）。内嵌 `"` 双写是 cmd 引号串的标准转义。

### 测试（spawn.test.ts）
- `hello&whoami` → tail 含 `"hello&whoami"`。
- `" & whoami` → tail 含 `""" & whoami"`（`"`→`""` 后整体加引号）。
- 含 `>`、`^` 同理。
- 无元字符参数（现有 `.cmd with a spaced prompt`）输出不变。

## #12 — crontab 特殊字符 round-trip + 换行注入

### 现状（`linux.ts`）
- `shq` 正确但 `parseManagedLine` 用 `'([^']*)'` 正则吃到 `'` 前 → `'` 路径不收敛。
- `crontabLine:49` 整行 `%`→`\%`，parse 不还原 → `%` 路径每次 update。
- `shq` 不拒 `\n` → 换行注入拆新 cron 行。

### 修复
**1. 换行注入拒绝**（`crontabLine` 顶部）：
```ts
function rejectControlChars(...vals: string[]): void {
  for (const v of vals) if (/[\n\r\u0000]/.test(v)) {
    fail(`crontab values must not contain newline/CR/NUL: ${JSON.stringify(v)}`);
  }
}
rejectControlChars(root, path, home, jspaceBin, c.id, log);
```

**2. parse 与 shq 对称**（`parseManagedLine` 重写）：
- 用 POSIX 单引号扫描提取 `--dir`/`--id` 的引号串（`'\''` → 字面 `'`），`\%` → `%` 还原。
```ts
function unshq(v: string): string {
  const inner = v.slice(1, -1);
  return inner.replace(/'\\''/g, "'").replace(/\\%/g, "%");
}
function quotedTokenLen(s: string): number {
  if (s[0] !== "'") return -1;
  let i = 1;
  while (i < s.length) {
    if (s[i] === "'" && s[i + 1] === "\\" && s[i + 2] === "'" && s[i + 3] === "'") { i += 4; continue; }
    if (s[i] === "'") return i + 1;
    i += 1;
  }
  return -1;
}
```
`parseManagedLine` 改为：提取 schedule（前 5 字段）→ 定位 `cron run` → 提取 `--dir <quoted>`/`--id <quoted>`（用 quotedTokenLen + unshq）→ taskId 从尾部 `# com.jspace.cron.<tag>.<id>` → tag 匹配后才返回。

### 测试（scheduler.test.ts）
- `crontabLine` 含 `\n` 的 root → `toThrow(/newline|CR|NUL/)`。
- root 含 `'`/`%`/空格 → `crontabLine` → `parseManagedLine` 回读 root/id 与预期一致（round-trip 收敛）。
- 现有 linux round-trip 用例（`parseManagedLine`/`replaceManagedBlock`）不回归。

## #15 — rollback id/rel 路径约束

### 现状（`workspace.ts:148-168`）
`readUpgradeJournal(root, id)` 用 `id` 拼 `.jspace/state/upgrades/<id>/journal.json`（`../../` 逃逸）；`rollbackUpgrade` 对 `step.rel` 直接 `join(root, rel)` 写/删（`..` 逃逸）。

### 修复（`rollbackUpgrade` 入口校验）
```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateRollbackTarget(root: string, id: string, journal: UpgradeJournal): void {
  if (!UUID_RE.test(id)) fail(`invalid rollback id: ${id} (expected a UUID)`);
  const rootAbs = resolve(root);
  for (const step of journal.plan) {
    const issues = portabilityIssues(step.rel);
    if (issues.length) fail(`upgrade journal plan has an unsafe rel path "${step.rel}": ${issues.join("; ")}`);
    if (!isWithin(resolve(rootAbs, step.rel), rootAbs)) fail(`upgrade journal rel escapes the workbench: ${step.rel}`);
  }
}
```
`rollbackUpgrade` 在读 journal 后立即调用。`portabilityIssues` from `core/contracts/paths.ts`，`isWithin` from `application/registry/helpers.ts`。

### 测试（workspace.test.ts）
- `rollbackId: "../../../tmp/pwn"` → `fail(/expected a UUID/)`。
- 构造 plan rel `../../../.ssh/authorized_keys` 的 journal → `fail(/unsafe rel/)` 或 `/escapes/`。
- 现有 `--rollback`（UUID id、正常 rel）用例不回归。

## 风险与兼容

- #4 `_inbox` 限制：asset-ingest 流程本就先落 `_inbox`，不破坏；直接 ingest 外部文件会被拒（报告默认建议）。
- #3 转义改变 .cmd 参数的引号形式；spawn.test 现有断言已核对不受影响。
- #12 parse 重写：monolithic 正则 → 扫描器；现有 parseManagedLine 相关用例需回归确认。
- #15 UUID 校验：现有测试 id 是 `crypto.randomUUID()`，不破坏。
