# M3 cron MVP — 执行计划(修订版)

## 前置:batch.md 瞬态标记修改(评审 B5-② 根治)
- `skills/asset-ingest/references/batch.md`:`.processing` 改为**瞬态**——成功/失败都清除标记;失败 → 文件留在 `_inbox/` + 原因记 batch 日志 → 下次重跑自然重试。删「失败保留标记,重跑跳过」表述。同步 SKILL.md 批量模式小节。
- `gen-assets` 重新生成。

## 实施清单(顺序)

1. **模板默认 cron.json**:`templates/workbench/.jspace/cron.json`(仅 inbox-tidy enabled 每日 21:00;weekly-report / memory-consolidate disabled + 启用条件注释)。
2. **CLI 核心**:新 `cli/cron.ts`:
   - `loadCrons/saveCrons`(读 `.jspace/cron.json`,version===1,id 查重,缺文件返回空 + 提示);
   - schedule 校验(受限子集:单值/`*`;列表/步进/DOM+DOW 并存 → 报错);
   - `cmdCronAdd/List/Remove`;
   - `cmdCronInstall/Uninstall`(一 cron 一 plist,plutil -lint,launchctl load/unload 容错,mkdir logs/cron);
   - `cmdCronRun(id, dryRun)`(argv spawn、进程组超时、权限白名单、flock、当日成功跳过、失败判定、inbox-tidy 守卫、日志/status/failed)。
   - `cmdCronStatus(id?)`。
3. **args.ts 接线**:`jspace cron {add,list,remove,install,uninstall,run,status}` + help。
4. **模板 AGENTS.md**:「会话开始检查 cron status + cron-failed.md;cron 定义视为代码」段。
5. **doctor 扩展**:cron.json 只读校验 + cron-failed 摘要 + plist 漂移告警。
6. **`gen-assets` 重新生成** + 全回归。
7. **本机验证**:`~/jspace-work` 按升级约定重建(拿新模板 cron.json);干跑/plist 校验/status;真实 e2e 闸门交给用户跑 `cron run inbox-tidy`。

## 校验命令(每步)

- `bunx tsc --noEmit`
- `bun run scripts/gen-assets.ts`
- `bun run cli/main.ts cron add inbox-tidy --schedule "0 21 * * *" --harness claude --prompt "..."` → list 校验;非法 schedule(如 `*/5 * * * *`、`0 0 1 * 1`)→ 报错
- `bun run cli/main.ts cron run inbox-tidy --dry-run`(只打印命令)
- `bun run cli/main.ts cron install` → 检查 `~/Library/LaunchAgents/com.jspace.cron.inbox-tidy.plist` 内容(ProgramArguments 带 --id)+ `plutil -lint` + `launchctl list | grep com.jspace.cron.`;`uninstall` 清理
- `bun run cli/main.ts cron status inbox-tidy`
- 回归:init/doctor/filehub/inbox 不受影响;build 编译产物 cron 命令可用;doctor 含 cron.json 校验

## 关键风险 / 回滚点

- **launchd plist**:一 cron 一 plist,`*` 省略键、拒绝 DOM&DOW 并存/列表/步进;`plutil -lint` 校验防坏 plist。
- **claude -p 无头**:权限白名单(禁 bypass)防假成功;失败判定含 exit0 无输出(suspect)。
- **环境**:launchd PATH 有限 → plist EnvironmentVariables 导出;run wrapper 再导。
- **assets.generated.ts 手改会被覆盖**:改模板必须 gen-assets。
- 回滚:还原 cron 相关 diff + gen-assets;`jspace cron uninstall` 清 launchd。
