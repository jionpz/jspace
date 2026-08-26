# Issue #7 P3 — Design

## P3.16 — manifestPaths 改纯 JSON

### 现状问题

`scripts/asset-integrity.ts` 的 `manifestPaths()` 用 `/\bpath:\s*"([^"]+)"/g` 扫**整份** `manifest.generated.ts` 文本。脆弱点:
- 扫整份文本而非 `BUNDLE_MANIFEST.files` 段(header 注释、import 行若含 `path:` 会误匹配)。
- 路径含 `"` 时正则截断错误。
- 注释中出现 `path: "..."` 会误匹配。

### 方案

gen-assets 额外生成**纯 JSON** `cli/manifest.json`(= `BUNDLE_MANIFEST` 对象),检查脚本一律 JSON.parse:

1. **`scripts/gen-assets.ts`**:写 `manifest.generated.ts` 时同时写 `cli/manifest.json`:
```ts
const manifestJson = JSON.stringify({ schema_version: 1, bundle_version: VERSION, files: [...assets.entries()].map(...) }, null, 2);
writeFileSync(join(repoRoot, "cli", "manifest.json"), manifestJson + "\n", "utf-8");
```
(内容与 `.ts` 的 `BUNDLE_MANIFEST` 一致;JSON 不进二进制,只供仓库内检查。)

2. **`scripts/asset-integrity.ts`** 新增:
```ts
/** Read the committed cli/manifest.json (pure JSON — the single parse path for
 *  checks; generated alongside manifest.generated.ts). */
export function readManifestJson(manifestJsonPath: string): { files: { path: string }[] } {
  return JSON.parse(readFileSync(manifestJsonPath, "utf-8")) as { files: { path: string }[] };
}
```
`manifestPaths`(正则)保留但注释标注 legacy(gen-assets 内部 stale 检查改 JSON)。

3. 消费方全部改用 JSON:
- `gen-assets.ts` stale 检查:`readManifestJson("cli/manifest.json")` → paths。
- `check-manifest-integrity.ts`:`readManifestJson`。
- `manifest-integrity.test.ts`:直接从 `cli/manifest.json` JSON.parse(替代正则),保留 TS 嵌入一致性断言。

4. `verify.yml` freshness `git diff --exit-code` 清单加 `cli/manifest.json`。

**改动面**:4 个脚本 + 1 个生成文件 + CI freshness 清单。正则不再用于任何检查路径(消除脆弱性)。

## P3.17 — 代号注释人话化

### 范围

Python 扫描确认 ~25 处注释含内部代号,分两类:
- **跨模块决策代号**:Child D/E(子任务交付)、D1-D6(harness 决策)、T1/T2.5/T3(能力 tier)、F2/F3/F4(功能代号)、方案 a(D2 的分支)。
- **验收/需求代号**:AC1/AC9/AC11、RD5、AC-D4、M7/M8、R2。

### 原则

改写为人话描述,保留决策语义,不引入新的不可解码缩写。示例:
- `(Child D M7/M8)` → `(skill-target cron 编译/校验)`(保留具体含义)
- `(D2/方案 a)` → `(PreCompact 被动提醒分支:只提醒、不自动写 gbrain)`
- `(Child E, AC11)` → `(pending 暂存/应用契约)`
- `(D4: honest boundary + optional extension hint)` → `(诚实边界:只提示安装 pi-mcp-adapter,不自动装)`
- `(F2: this now pulls memory-recall/writeback into the bundle)` → 保留 F2 但补人话或去掉编号
- `(T2.5; plugin-driven)` → `(OpenCode plugin 驱动接线)`

**保留例外**:`harness-cursor.md` 等文档里引用 `D6`(用户拍板的决策)作为真实历史引用——若它出现在 harness 能力边界描述中且对外可解码(如「用户拍板(D6)保留 Cursor」),保留。AC1 若指向真实 CI 断言(verify.yml step 名)保留。逐个判断,以「外部读者能否无引用解码」为准。

### 机械流程

逐文件 Read → Edit 注释 → 不碰逻辑。`*.test.ts` 的测试名与注释同步。最后 `rg` 验证无残留。

## P3.18 — Windows hook 命令去 bash 依赖

### 现状

模板 3 文件 9 条 hook 命令均为 `jspace context ... 2>/dev/null || true`。Windows(PowerShell/cmd)不支持 `2>/dev/null`(cmd 会报错)。

### 方案

hook command 简化为**纯命令**(无 shell 语法):`jspace context session-start` 等。依据:
- CLI 内部已吞错:context handler 全部 try/catch(`failLines` → 空行 + exit 0);`gate` 对非工作台/禁用 hook 静默退出 0。
- stdout 是 host 唯一解析通道,stderr 被 Claude/Grok/Cursor 忽略(`2>/dev/null` 冗余)。
- `|| true` 只防 Command not found;host 对 hook 失败默认非 failClosed(记录错误不阻塞会话)。命令去 shell 语法后任何 shell(spawn 直跑)都执行,无需重定向。

模板改动:
- `.claude/settings.json` 4 条 → `jspace context session-start` / `jspace context turn`。
- `.grok/hooks/jspace.json` 4 条 → `jspace context session-start` / `turn` / `pre-compact` / `session-end`。
- `.cursor/hooks.json` 1 条 → `jspace context session-start --envelope cursor`。

同步:
- `cli/commands/context.ts` 头注释(`2>/dev/null || true` → 纯命令 + CLI 吞错说明)。
- `harness-claude.md` / `harness-grok.md` / `harness-cursor.md` 中 `2>/dev/null || true` 描述同步。
- 确认无测试断言该字面量(P0 时 init.test 只断言 `session.created` 等事件名与 `cron check`,已核对)。

**风险**:去掉 `|| true` 后 jspace 不在 PATH 时 hook command not found——host 记录错误不阻塞(默认)。工作台 init 后 jspace 必在 PATH(安装流程),可接受。

## P3.19 — verify.yml timeout/concurrency

```yaml
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20          # full-chain integration 是耗时大头;超时即红
    concurrency:
      group: verify-${{ github.ref }}
      cancel-in-progress: true   # 新 push 取消旧 PR run
```

同文件 build.yml 的 build/test/release/verify-install jobs 也统一加(一处收尾)。

## 兼容性 / 回滚

- P3.16 生成新文件 `manifest.json` + 消费方改 JSON;回滚 = revert + gen-assets(manifest.json 由 gen-assets 重建)。
- P3.17 纯注释,零行为;回滚 = revert。
- P3.18 模板命令 + 文档;模板改动需重跑 gen-assets(记忆约束);回滚 = revert + gen-assets。
- P3.19 CI 配置纯声明。
- 所有改动经 AC 门禁(tsc / bun test / gen-assets / 3 检查脚本)。
