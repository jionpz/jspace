# P1: CLI 参数 dest + 退出码语义（issue #8 #2 + #9）

## Goal

修复两个 CLI 层确定性缺陷：
- **#2** `domain/resource add --tag` 被静默吞掉：handler 读 `args.tags`，但 `--tag` option 无 `dest`，解析器默认产出 `args.tag` → tags 永远空、exit 0 无任何提示。
- **#9** `skills install` / `harness wire` / `gbrain wire` 的 handler catch 把异常降成 `warnings` 且不设 `exitCode` → 业务失败 exit 0，脚本/CI 误判成功；且 `jspace: error:` 文案进 `lines`（stdout）而非 `errors`（stderr）。

父任务：`08-10-issue8-review-fixes`。

## Background（根因）

### #2（参数静默吞掉）
- `application/commands/command.ts:348`：`keyOf(o) = o.dest ?? o.name.replace(/^--/, "").replace(/-/g, "_")`。`--tag` 无 `dest` → 键 `tag`。
- `cli/commands/domain.ts:20` 与 `cli/commands/resource.ts:23` 的 `--tag` spec 无 `dest`；handler（`domain.ts:28`、`resource.ts:42`）读 `args.tags` → `undefined` → `cleanTags(undefined)` → `[]` → hub 里 tags 永不落盘。对比 `--asset-rel-path` 有 `dest`。
- 影响：`jspace domain add foo --tag work` **exit 0 且成功写入，tags 永远空，无任何提示**。比报错更糟。

### #9（吞异常 + exit 0）
- `cli/main.ts:42-47`：只认 `result.exitCode`（默认 0）打退出码；`errors`/`warnings` 打 stderr。
- `cli/commands/skills.ts:55-57`：catch → `{ lines: [], warnings: [msg] }` → exit 0。
- `cli/commands/harness.ts:60-62`：catch → `{ lines: [], warnings: [msg] }` → exit 0；且 `:65` `!result.ok` 的 `jspace: error:` 进 `lines`。
- `cli/commands/gbrain.ts:68-70`：catch → `{ lines: [], warnings: [msg] }` → exit 0；且 `:86-90` 三个 status error case 的 `jspace: error:` 进 `lines`。
- 触发例：`~/.agents/skills` 写入 EACCES / `~/.claude.json` 为目录导致 read 抛错 → 应 exit 1 + stderr，实际 exit 0 + warning。

## Requirements

1. `domain add --tag <t>...` 与 `resource add --tag <t>...` 的 tags 真正落盘到 hub（可 repeatable、cleanTags 去重语义不变）。
2. `skills install` / `harness wire grok` / `gbrain wire` 三个 handler：
   - 业务/IO 异常 → `exitCode: 1` + 消息进 `errors`（stderr），不再走 `warnings`、不再 exit 0。
   - 现有 `!result.ok` / status error case 的 `jspace: error:` 文案从 `lines`（stdout）迁到 `errors`（stderr）。
   - 参数问题（缺 `--harness`、`--harness` 值不支持）→ exit 2（解析层 ArgError）。
3. 不改变成功路径的输出行（`jspace: ok:` / dry-run 文案保持现状）。

## Acceptance Criteria

- [x] #2：`domain add work --tag alpha --tag beta` 后 `loadHub` 中 `domains[work].tags === ["alpha", "beta"]`；`--tag work --tag work` 去重为 `["work"]`。
- [x] #2：`resource add proj --domain <d> --path <abs> --tag x` 后 hub `resources[proj].tags === ["x"]`。
- [x] #2 回归：改动前（无 dest）三条断言红，改动后绿（已临时还原验证红）。
- [x] #9：三个 handler 注入「writeFile 抛错」的 deps 后返回 `exitCode === 1` 且 `errors` 含消息、`warnings` 为空（success 路径 `errors/warnings` 为空）。
- [x] #9：`harness wire --harness claude`（不支持值）→ ArgError（main.ts 映射 exit 2）。
- [x] 成功路径：`skills install`（dry-run）仍输出 `(dry-run) would install ...`；`gbrain wire`/`harness wire` 的 ok 文案不变。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 503/503 绿；CLI 冒烟（domain/resource --tag 落 hub、harness wire 校验 exit 2）通过。

## Out of Scope（本批不做）

- #9 涉及的其它命令（doctor/inspect/registry）退出码——报告只点名 skills/harness/gbrain 三个同构 handler。
- `gbrain wire`/`harness wire` 的多 harness 统一（#16）→ 归 `08-10-issue8-p2-contracts-doctor`。
