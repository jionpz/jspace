# Design: CLI 参数 dest + 退出码语义（#2 + #9）

## #2 — `--tag` dest 修复

**改动**（两处，各一行）：`cli/commands/domain.ts:20` 与 `cli/commands/resource.ts:23` 的 `--tag` option 加 `dest: "tags"`。

```ts
{ name: "--tag", dest: "tags", takesValue: true, repeatable: true, help: "..." }
```

解析器 `keyOf` 即产出 `args.tags: string[]`（repeatable append），handler 现有的 `args.tags as string[] | undefined` → `cleanTags(...)` 路径直接生效。`--asset-rel-path` 已有 `dest`，本修正是对齐该惯例。

**回归（handler-wiring.test.ts）**：
- `domain add work --tag alpha --tag beta` → `loadHub(wb).domains` 中 `work` 的 `tags === ["alpha", "beta"]`。
- `--tag work --tag work` → `["work"]`（cleanTags 去重）。
- `resource add proj --domain work --path <abs> --tag x` → `resources[proj].tags === ["x"]`。
- 不传 `--tag` → hub 无 tags 字段（`undefined`），与现状一致。

## #9 — 退出码 + errors 语义修复

### 失败形状统一

三个 handler 的 catch 从「降级为 warnings、无 exitCode」改为「`errors` + `exitCode: 1`」：

```ts
} catch (e) {
  return { lines: [], errors: [`skills install: ${e instanceof Error ? e.message : String(e)}`], exitCode: 1 };
}
```

`cli/main.ts` 会把 errors 打到 stderr `jspace: error: ...` 并设 `process.exitCode = 1` —— 与 `fail()` 抛 CliError 的最终输出一致，脚本可正确判定失败。

### stdout 清洗（`jspace: error:` 迁出 lines）

| 位置 | 现状 | 改为 |
|---|---|---|
| `harness.ts:64-66`（`!result.ok`） | `{ lines: ["jspace: error: <reason>"], exitCode: 1 }` | `{ lines: [], errors: [<reason>], exitCode: 1 }` |
| `gbrain.ts:85-90`（no-claude-json / no-gbrain-server / invalid-claude-json） | 同上 | 同上 |
| `harness.ts:103-107`（unsupported harness） | `{ lines: ["jspace: error: ..."], exitCode: 1 }` | 迁到 `errors` + 改 exit 2（见下） |

### 参数问题 → exit 2

`--harness` 值校验是参数问题，应走解析层 ArgError（exit 2）而非 handler 业务分支。给 `harness.ts:96` 的 `--harness` option 加 `validate`：

```ts
{ name: "--harness", takesValue: true, required: true, validate: (v) => (v === "grok" ? null : `unsupported harness for harness wire: ${v} (supported: grok; claude uses jspace gbrain wire)`), help: "harness to wire (grok)" }
```

解析器 `command.ts:413-426` 对 option 值调 `validate`，非空 → `ArgError` → exit 2。handler 里的 `if (harness === "")` 与 unsupported 分支删除（parser 已兜底）。缺 `--harness` 仍由 `required: true` 兜底 exit 2。

### 可测性：handler 注入 deps

skills/harness/gbrain 的 handler 用模块内 `installDeps`/`grokWireDeps`/`wireDeps`（真 fs）。为测 catch 路径（写失败 → exit 1 + errors）而不触碰真实 home（红线：测试不 mutate 真实 home），把 handler 抽出并接受可注入 deps：

- `cli/commands/skills.ts`：`export function installHandler(ctx, args, deps: InstallDeps = installDeps(ctx.dryRun)): CmdResult`；`installSpec.handler = installHandler`。
- `cli/commands/harness.ts`：`export function grokWireHandler(ctx, deps: GrokWireDeps = grokWireDeps(ctx.dryRun)): CmdResult`。
- `cli/commands/gbrain.ts`：`export function wireHandler(ctx, deps: WireDeps = wireDeps(ctx.dryRun)): CmdResult`。

测试用 `writeFile: () => { throw new Error("EACCES") }` 的 deps 调 handler，断言 `exitCode === 1` + `errors[0]` 含消息 + `warnings` 为空；成功路径断言 `errors/warnings` 为空。

## 风险与兼容

- `validate` 使 `harness wire --harness claude` 从 exit 1 变 exit 2——语义正确（参数问题），无既有测试依赖旧行为（已核查 `cli/*.test.ts` 无 harness wire 断言）。
- `jspace: error:` 从 stdout 迁到 stderr：stdout 更干净，面向脚本/CI；人话输出不变（main.ts 前缀一致）。
- handler 抽参数 `deps` 默认值保持现有真实 deps，CommandSpec 接线零行为变化。
- skills install 的成功行（`summarizeInstall`）与 gbrain/harness 的 ok 文案不动。
