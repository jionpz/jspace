# cron rehearsal gate + install 任务记录(真实证据,不入 git)

## 环境

- JWorkspace `~/jspace-work`;cron.json 三任务 enabled(inbox-tidy 每日21:00 / weekly-report 周日21:00 / memory-consolidate 周日22:00),harness=claude。全部 never run(起始)。
- gbrain 无 serve(起始观察);无头 claude 用 Bash + gbrain CLI 兜底。⚠️ weekly-report 实际运行时发现 `gbrain serve`(PID 22006)由发起会话(交互 claude,PID 21992,ttys000)持有 → 锁冲突(见 weekly-report 节)。

## Rehearsal Gate 结果

### inbox-tidy ✅ (2026-08-03T163438)
- `jspace cron run inbox-tidy` → exit 0,`无事可做`(inbox 空)。
- 路由 asset-ingest → 定位 filehub(hub.json primary `/Users/jionpz/filehub`)→ `jspace inbox status --json` count 0 → 写执行日志 `/Users/jionpz/filehub/.jspace-logs/inbox-batch.md`。
- 日志:`~/jspace-work/.jspace/logs/cron/inbox-tidy/2026-08-03T163438.md`。

### weekly-report ✅(2026-08-03T165527,exit 0;gbrain 页受锁暂存)
- 产出 1(filehub 周报 md)✅:`~/filehub/areas/周报/2026-08-03-周报.md`(7.4k,周起始日命名;filehub 根按 hub.json `type:filehub` primary 解析)。
- 产出 2(gbrain reference 页)⚠️ 暂存:`assets/周报/2026-08-03` 内容已备妥并验证(在隔离 GBRAIN_HOME 副本上 put→get→delete 通过),暂存至 `~/filehub/.jspace-logs/weekly-report-2026-08-03.gbrain.md`。
- **锁冲突(环境发现)**:`gbrain serve`(PID 22006)由发起本次 cron 的交互会话(PID 21992,ttys000)持有,PGLite 单写;无头侧 CLI 报「already open through gbrain serve」、MCP 被 ECC health-check 标 unhealthy 阻断。未杀 serve;锁释放后 `gbrain put assets/周报/2026-08-03 < 暂存文件` 即可应用。
- 幂等核对:brain 中无既有 `assets/周报/` 页;同周重跑覆盖同 slug。
- 数据核对:brain 现存 2 个 reference 页(报表模块会议记录 / 机器学习第二章笔记),无 state / consolidate 页。

### memory-consolidate ✅(2026-08-03T180707,exit 0;gbrain 5 页受锁暂存)
- 产出(暂存 `~/filehub/.jspace-logs/`,5 页内容已在隔离 GBRAIN_HOME 副本 put→get→delete 验证):
  - `memory/consolidate/2026-08-03`(note,dated 周快照)→ `memory-consolidate-2026-08-03.gbrain.md`
  - `project/jspace/state` → `memory-consolidate-2026-08-03.state-jspace.md`
  - `project/gbrain/state` → `memory-consolidate-2026-08-03.state-gbrain.md`
  - `project/报表模块/state` → `memory-consolidate-2026-08-03.state-报表模块.md`
  - `project/机器学习/state` → `memory-consolidate-2026-08-03.state-机器学习.md`
- 应用说明+命令:`memory-consolidate-2026-08-03.APPLY.md`(锁释放后 5 条 `gbrain put` 即可;state 固定 slug 覆盖幂等,consolidate 同周重跑覆盖同 slug)。
- 幂等核对:brain 无既有 `memory/consolidate/*`、`project/*/state` 页(weekly-report 已核对)→ 本次两者首建,无重复 slug 风险。
- 事实归纳源:JSpace 开发仓库 GOAL.md/journal-1.md、本周周报、filehub 项目索引(gbrain 页受锁不可读)。
- cc-switch 无本周活动证据,未建页(避免臆造)。

## 🔑 锁根因(2026-08-03 排查)

- **持锁者 = 当前会话自己**:21992 = 当前 claude 会话(本对话所在进程,ttys000,15:56 起);22006(gbrain serve) 是它的 stdio 子进程(本会话 MCP 全家桶之一)。「结束 21992」= 结束当前对话,故无法/不该结束。
- 连锁:gbrain CLI 被锁阻断(报 already open);gbrain MCP 被 ECC health-check hook 阻断(hook 跑 CLI doctor 撞锁)。
- **架构结论(weekly-report 亦已指出)**:交互会话(持 gbrain serve)期间,无头 cron 无法并发写 gbrain(PGLite 单写)。launchd 系统调度跑 cron 时无交互会话 → 锁空闲 → 写入正常。
- **暂存即设计**:gbrain 写契约在无锁窗口落 live;rehearsal 用隔离副本验证内容正确性。

## Install ✅(2026-08-03T1839)

- `jspace cron install` → 3 个 LaunchAgent:`com.jspace.cron.{inbox-tidy,weekly-report,memory-consolidate}.plist` → `~/Library/LaunchAgents/`,launchctl 全部加载。
- `jspace cron status` 三任务 ok(exit 0,各含 rehearsal 日志)。
- `jspace doctor` 0 error 0 warning(cron 未装 warning 消除)。
- 真实调度:launchd 系统触发,无交互会话 → gbrain 锁空闲 → 写契约正常。

## 发现:CLI allowedTools 通配符问题

- `jspace cron run` 生成 `--allowedTools Bash,Read,Write,Edit,gbrain:*`;claude CLI 报「Wildcard tool name "gbrain:*" is not supported in allow rules」。
- 影响:无头 claude 的 gbrain MCP 工具未显式放行;但 Bash 可用 → 走 gbrain CLI 兜底(写入可成,不阻塞)。
- 修复建议:CLI(cli/)把 `gbrain:*` 改为 `mcp__gbrain__*`(若 gbrain 是 MCP server),或去掉(靠 Bash)。**待修项**,另立小任务或随 CLI 维护。

## 收尾确认

- [x] 三任务 rehearsal 全过(inbox-tidy ✅ / weekly-report ✅ / memory-consolidate ✅)。
- [ ] gbrain 页 live 应用(weekly-report `assets/周报/2026-08-03` + memory-consolidate 5 页;锁释放窗口,命令见各自 APPLY/暂存说明)。
- [x] `jspace cron install` 装 launchd。
- [x] notes 落完整证据;CLI 通配符问题记档。
