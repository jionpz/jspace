# cron failures 命令 — 技术设计

## 边界

**范围内**
- `jspace cron failures [--json]` 新命令（+ 别名 `jspace cron check [--json]`，同一实现）。
- doctor cron 摘要追加 pending APPLY 提示。
- 只读聚合：cron-failed.md + 每 cron 最后运行日志 status + pending gbrain 暂存写（APPLY.md）。

**范围外**
- 不改 `cron run` / `cron status` / `cron add` 等既有行为。
- 不主动通知/推送（本命令是「会话可查的表面」，推送留给 hook/用户触发）。
- 不触碰 gbrain 锁、不写任何文件（纯读）。

## 契约

### CLI
```
jspace cron failures [--json]
jspace cron check [--json]        # 别名
```
- root = cwd 的 workbench（`workbenchRoot()`，同 `cron status`，不设 --dir）。
- 退出码：`needs_attention == 0` → 0；否则 → 1（供 hook/脚本判定）。
- `needs_attention = failures 数 + suspect 数 + pending_applies 数`。
  - `never run` 与 `ok` **不计入**需关注（新装 cron 未跑是正常信息，不报警）。

### 输入（全部只读）
| 数据 | 位置 |
|---|---|
| 失败记录 | `<root>/.jspace/logs/cron-failed.md`（可不存在） |
| 每 cron 状态 | `<root>/.jspace/logs/cron/<id>/<最后>.md` 的 `status:` |
| pending 暂存写 | `<filehub>/.jspace-logs/*.APPLY.md`（filehub 根 = `<root>/hub.json` 的 `type: filehub` resource primary path；未注册则跳过） |

### 输出（人类可读）
```
jspace: cron failures
failures: (0)
pending gbrain writes (APPLY.md): (2)
  <filehub>/.jspace-logs/memory-consolidate-2026-08-03.APPLY.md
cron status:
  inbox-tidy: ok
  weekly-report: never run
  memory-consolidate: failed (exit 1)
needs_attention: 1
```
- 无失败 → `failures: (0)`；无 pending → `pending ...: (0)`。
- cron-failed.md 每行原样列出（时间/id/原因/log 已在行内）。

### 输出（--json，单行）
```json
{"failures":[{"line":"- 2026-08-03 ...","raw":"..."}],"pending_applies":["<abs path>"],"crons":[{"id":"inbox-tidy","status":"ok","log":"<path>"}],"summary":{"failures":0,"suspect":0,"failed":1,"never_run":1,"pending_applies":2,"needs_attention":3}}
```

### doctor 增强
- cmds.ts 的 cron 摘要区，在 `cron-failed.md` 提示后追加：`N pending APPLY.md in <filehub>/.jspace-logs/ (gbrain staged writes)`。

## 数据流

```
jspace cron failures
  → 读 cron-failed.md（缺=空）
  → 枚举 crons（loadCrons）→ 读每 cron 最后日志 status
  → 读 hub.json 定位 filehub → glob *.APPLY.md
  → 聚合 needs_attention
  → 人类/JSON 输出 + 退出码
```

## 实现要点

- `cron.ts` 新增 `export function cmdCronFailures(json: boolean, root?: string): void`；root 缺省 `workbenchRoot()`，测试传临时目录。
- 抽小函数便于单测：`readCronFailed(root): string[]`、`lastStatusFor(root, id): string|null`、`findPendingApplies(root): string[]`（hub.json 解析 filehub primary path，复用 registry 逻辑）。
- `args.ts`：CRON_CHOICES 加 `failures`、`check`；help 补两行；分发 case 调 `cmdCronFailures(!!json)`。
- 复用现有 `loadCrons` / registry 读取，不新增依赖。

## 取舍

- **failures vs check 双名**：`failures` 直观；`check` 语义像健康检查、hook 用它更贴切。同一实现，成本近零。
- **never run 不计需关注**：避免新装 cron 误报；`--json` 里保留 `never_run` 计数供需要时用。
- **纯读不碰锁**：serve 持锁时照常可用（只读文件系统）。
- **不设 --dir**：与 `cron status` 一致（hook 在 cwd=工作台 运行）；测试用 root 参数而非 CLI flag。

## 兼容性 / 回滚

- 新增命令不影响既有 cron 命令；`status` 保留原样。
- 回滚：移除 args.ts 分发 + cron.ts 函数即可。
