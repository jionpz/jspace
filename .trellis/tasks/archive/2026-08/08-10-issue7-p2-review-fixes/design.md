# Issue #7 P2 — Design

## P2.10 — gitignore 例外策略统一

### 现状问题

`.gitignore:30-49`:`pi/ .omp/ .omc/ .omo/ .codex/ .claude/ .agents/ .opencode/ .cursor/` 忽略所有 harness 配置目录;例外只钉死 `.claude/` + `.opencode/` 两个目录 + 两个单文件。问题:①`.grok/` 未被忽略(与其余不一致);②例外钉死单文件(`.claude/settings.json`、`.opencode/plugins/jspace.ts`),新增 seed 文件会再踩坑;③`.cursor/` 忽略但无模板例外(P2.11 要补模板)。

### 方案

```
# Harness / platform config (Trellis-managed, regenerable)
.pi/ .omp/ .omc/ .omo/ .codex/ .claude/ .agents/ .opencode/ .grok/ .cursor/

# workbench template ships real assets under harness config dirs — seed
# templates must be committed (issue #6: the .opencode plugin was lost to
# gitignore). Add `!templates/workbench/.<harness>/` when shipping a new seed.
!templates/workbench/.claude/
!templates/workbench/.claude/**
!templates/workbench/.opencode/
!templates/workbench/.opencode/**
!templates/workbench/.grok/
!templates/workbench/.grok/**
!templates/workbench/.cursor/
!templates/workbench/.cursor/**
```

- 目录级 `!` 重新包含后,`/**` 显式解禁其下所有内容(防御性,替代「目录包含后自动可跟踪」的隐式行为)。
- `.agents/` 无模板 seed(shared projection 由 init/upgrade 物化,gen-assets walk 只遍历存在的目录),保持忽略;未来加 seed 再加例外。
- 防再次丢失由 P1.6 的 `check-manifest-integrity.ts`(git 跟踪 + 不被忽略)兜底,不需新增 CI。

## P2.11 — Cursor hook 补模板 + envelope

### 调研结论(已核实 cursor.com/docs/hooks)

- Cursor 从**项目级 `<root>/.cursor/hooks.json`**(check into VCS)、用户级 `~/.cursor/hooks.json`、Enterprise/Team 多个层级加载 hooks;项目级是 VCS-managed 的首选。
- `sessionStart` 事件输出 JSON:`{"env": {...}, "additional_context": "..."}`,`additional_context` = "Additional context to add to the conversation's initial system context"。
- 所以 `cursorAdapter.hookFilePath` 返回 `<wb>/.cursor/hooks.json`(项目级)**正确**;`harness-cursor.md` 写用户级是**错的**(改为项目级 seed,用户级列为备选)。

### 实现

1. `application/context/envelope.ts` 加 Cursor 格式(顶层 additional_context,与 Claude/Grok 的 `hookSpecificOutput` 不同——文件注释已预留 "Cursor top-level additional_context" platform branch):
```ts
export function cursorSessionStartEnvelope(context: string): string {
  return JSON.stringify({ additional_context: context });
}
```
2. `cli/commands/context.ts` session-start 加 `--envelope <claude|cursor>`(默认 claude;`--plain` 保留):
```ts
handler: (ctx, args) => {
  ...
  const env = args.envelope;
  const out = env === "cursor" ? cursorSessionStartEnvelope(text)
             : plain(args) ? text : sessionStartEnvelope(text);
  return { lines: [out] };
}
```
3. 模板 `templates/workbench/.cursor/hooks.json`:
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "jspace context session-start --envelope cursor 2>/dev/null || true", "timeout": 10 }
    ]
  }
}
```
4. `harness-cursor.md` 更新 hook 位置(项目级 seed + 用户级备选)。

## P2.13 — GEN_ASSETS_ALLOW_MISSING 语义

`scripts/gen-assets.ts:76` 现状 `if (!process.env.GEN_ASSETS_ALLOW_MISSING)`:JS 中 `"0"` / `"false"` 是 truthy → `!truthy` = false → 放行删除。修复为只认 `"1"` / `"true"`:

```ts
/** Only "1"/"true" enable the missing-source bypass; "0"/"false"/unset stay
 *  strict (issue #7 P2.13 — JS truthiness would otherwise let "false" through). */
function missingAllowed(): boolean {
  const v = process.env.GEN_ASSETS_ALLOW_MISSING;
  return v === "1" || v === "true";
}
...
if (!missingAllowed()) { ... guard ... }
```

文档化进 AGENTS.md Quality Checks(P2.12 一并做)。

## P2.14 — check-harness-consistency 表驱动扩展

保留现有 6 组断言(harness-docs / cron-enum / adapters / field-value / skill-refs / support lists),新增 3 组(表驱动:期望表 × 遍历 harness,真实调用 adapter/argv):

### 7. hookFilePath 模板存在
```ts
import { getAdapter } from "../adapters/harness/index.ts";
for (const h of Object.keys(caps.harnesses)) {
  const a = getAdapter(h);
  if (!a.hookFilePath) continue;
  const p = a.hookFilePath(join(ROOT, "templates/workbench"));
  check(`7.${h}-hookfile`, existsSync(p), `${h} hookFilePath template exists (${p})`);
}
```
(cursor 现在有模板 → 通过;未来新增 harness 漏模板 → 红。)

### 8. headless argv ↔ capabilities 前缀
```ts
import { harnessArgv } from "../adapters/harness/argv.ts";
for (const [h, cap] of Object.entries(caps.harnesses)) {
  if (!cap.headless || cap.headless.length === 0) continue;
  const argv = harnessArgv(h, "p", "darwin", "/bin/x");
  const expected = ["/bin/x", ...cap.headless.slice(1)];
  check(`8.${h}-headless-argv`, JSON.stringify(argv.slice(0, expected.length)) === JSON.stringify(expected),
    `headlessArgv prefix == capabilities.headless.slice(1)`);
}
```
(P0 统一消费 `headless.slice(1)` 后恒真——把声明与实现锁定。)

### 9. lifecycle 与真实接线
```ts
const EXPECTED = {
  session_end: { grok: "best_effort" },           // grok 模板有 SessionEnd;其余 manual
  session_start: { claude: "best_effort", grok: "best_effort", opencode: "best_effort", pi: "best_effort", cursor: "best_effort" },
  fallback: { all: "manual" },
  crash_recovery: { claude: "best_effort", grok: "best_effort", opencode: "best_effort", pi: "best_effort", codex: "best_effort", cursor: "manual" },
};
```
逐 harness 断言 capabilities.lifecycle 匹配(默认值:期望表未列出的 harness-dimension → manual)。这固化 P1.9 的降级并防未来虚报。

## P2.15 — gen-assets skip 规则

`scripts/gen-assets.ts:56` 现状跳过 `*.test.ts`,但嵌入 2 个 `*.test.py`(extract.test.py / office-extract.test.py,manifest 38/40)。verify.yml 的 python 步骤在**仓库路径**跑(`python3 skills/asset-ingest/scripts/...`),不走 bundle——skip 无影响。统一:

```ts
if (/\.test\.(ts|py)$/.test(name)) continue; // test files never embed (TS unit + python self-tests)
```

manifest 40 → 38;`check-manifest-integrity` / `manifest-integrity.test.ts` 自动适应(基于 manifest 内容)。

## P2.12 — 文档重写(AGENTS.md / README.md)

### AGENTS.md 更新点

- 目录结构:`cli/` 扩为 `cli/ core/ application/ adapters/ scripts/ templates/ skills/ types/`(按现有结构)。
- CLI 能力:`init`/`doctor` 扩为完整命令面(context/cron/domain/gbrain/harness/ingest/pending/project/registry/resource/skills/workspace + init/doctor)。
- skills:`jspace-use`/`asset-ingest` 扩为 4 个(+ memory-recall/memory-writeback)。
- `__DEV_ROOT__` 描述删除 → 改为:模板去个人化,由 `scripts/gen-assets.ts` 嵌入二进制,init/upgrade 物化。
- 补:capabilities.yaml 单一事实源(adapters/harness/)、多 harness 投影(.claude/.grok/.opencode/.agents/.cursor)、防漂移脚本(check-skills/check-harness-consistency/check-manifest-integrity/gen-assets freshness)。
- Quality Checks:补 `bun test` / `bun run scripts/gen-assets.ts`(改动后重跑)/ `check-skills` / `check-harness-consistency` / `check-manifest-integrity`;补 GEN_ASSETS_ALLOW_MISSING 说明(故意删文件才用,CI 不设置)。
- `<!-- TRELLIS:START -->` 块保持不动。

### README.md 更新点

- 目录结构补 `adapters/`(harness/scheduler/process/fs)、`core/`(contracts/registry/shared)、`application/`(领域用例)、`scripts/`(gen/check)。
- 常用命令补 `context`(hook 注入)/ `harness`(wire)/ `gbrain`(wire/skillsDir)/ `skills`(install)/ `domain`/`resource`/`project`。
- 删除 `__DEV_ROOT__` 过时描述。
- 补质量门禁:PR/push 跑 verify(tsc/bun test/资产完整性/一致性/全链)。

## 兼容性 / 回滚

- P2.10/13/15 是配置/脚本小改,回滚 = revert。
- P2.11 新增 CLI 选项 `--envelope`(向后兼容,默认 claude)+ 新模板;回滚 = revert + gen-assets。
- P2.14 新增断言只读;新增 harness 或真实接线变化需同步期望表(这正是检查意图)。
- P2.12 文档无运行影响。
- 所有改动经 AC 门禁(tsc / bun test / gen-assets / check-manifest-integrity / check-skills / check-harness-consistency)验证;模板/yaml 改动后重跑 gen-assets(记忆约束)。
