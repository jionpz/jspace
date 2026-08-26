# M3 cron MVP(声明式定义 + install + 无头执行)

## Goal

把「定时自动化」从概念变成可用的 MVP:声明式 cron 定义存 `.jspace/cron.json`(调度 + 提示词 + harness),`jspace cron install` 装进 macOS 系统调度(launchd,一 cron 一 plist),`jspace cron run` 无头执行 harness(复用 M2 批量管线),执行日志落 `.jspace/logs/` 并提供**失败可见性**(cron 挂了下次会话能看到)。首批任务:inbox 批量整理(旗舰,驱动 M2 无头批量)。**不引入常驻进程**,符合 GOAL 非目标。本版已**批判性吸收专家评审**(B1-B6/P1-P10 的采纳/调整/拒绝见 Key Decisions 与 Notes)。

## Background(确认事实)

- GOAL M3:声明式定义 + `cron install` + 无头执行;首批任务作用于资产层与记忆层。顺序理由:M2 资产协议先于 cron(已完成)。
- M2 已交付:asset-ingest 批量管线支持无头模式(只第一遍 + 日志落 `.jspace/logs/inbox-batch.md`);`.jspace/` 布局就位(含 `.jspace/logs/` 槽位,gitignore)。
- 专家评审(P4)前置契约 + M3 专项评审(B1 单 plist 无法分发多 cron;B2 无头执行安全/失败判定;B3 提示词=代码;B4 inbox-tidy 软链接;B5 撞车+.processing 卡死;B6 映射分歧;P1 launchd 唤醒补跑;P2 默认任务过早;P9 砍 Linux)。
- 本机证据:claude/codex/pi 均在;claude -p / codex exec 支持无头;macOS launchd(已有 LaunchAgents);crontab 空。
- GOAL 开放问题 #3:无头运维——最低方案 = 执行日志落固定路径 + 下次会话检查。

## Requirements

- **R1 声明式定义**:`.jspace/cron.json`(schema v1):
  ```json
  { "version": 1, "crons": [
    { "id": "inbox-tidy", "schedule": "0 21 * * *", "harness": "claude",
      "prompt": "整理一下 inbox(无头模式:只处理确定性文件,模糊项留清单不提问)", "enabled": true }
  ]}
  ```
  `jspace cron add/list/remove` 管理;schema 校验:version===1、id 合法(复用 findIndex 查重)、schedule 为**受限 5 段 cron 子集**(见 R2)、harness ∈ {claude,codex,pi}、prompt 非空、enabled 布尔。**无 target_domain 字段**(评审 P6:不做声明即死字段)。
- **R2 调度 = macOS launchd,一 cron 一 plist**:
  - `jspace cron install` 遍历 enabled,每个 cron 生成 `~/Library/LaunchAgents/com.jspace.cron.<id>.plist`(`Label: com.jspace.cron.<id>`,`ProgramArguments: [<jspace 全路径>, "cron", "run", "--id", <id>]`,`StartCalendarInterval` 单字典,`EnvironmentVariables` 导出 PATH/HOME,`WorkingDirectory`=工作台);`launchctl load`。
  - **受限 schedule 子集**:每字段仅单值或 `*`;`*` → 省略键(不填 0);列表/区间/步进 → 显式报错;**Day-of-month 与 Day-of-week 同时非 `*` → 显式报错拒绝**(评审 B6:launchd AND/OR 语义分歧,不仲裁,直接拒绝该组合);weekday 收口 0-7。
  - `install` 幂等(先 unload 旧同 id plist);`uninstall` 清理 `com.jspace.cron.*`。
  - **MVP 仅 macOS**;Linux/Windows 调度后端推迟 M5(评审 P9)。
- **R3 `jspace cron run <id>` 无头执行(安全模型,评审 B2/B3)**:
  - cd 工作台 + 导出 PATH/HOME/bun;`spawn(argv)` **数组传参,禁 shell 拼接**(消除注入面);`detached:true` + 超时(默认 30min,可调)`kill(-pid)` **进程组杀**(不留孤儿);`maxBuffer` 高值/流式。
  - `claude -p <prompt>` 带**权限白名单**(允许 Bash/Read/Write + gbrain MCP,**禁 bypassPermissions**);`codex exec` / `pi -p` 类似。
  - **失败判定** = 非 0 退出 || 超时 || exit 0 但无实质输出(标记 suspect 供肉眼复核)。
  - 工作台级 **flock 互斥**(已锁则 skip + 写日志);「同一 id 当日已有成功日志则跳过」幂等护栏。
  - `--dry-run` 只打印将执行的命令。
  - **inbox-tidy 守卫**(评审 B4):run 前检查 `skills/asset-ingest/` 存在(缺则直接写 cron-failed.md);执行后比对 batch 日志 `.jspace/logs/inbox-batch.md` 的 mtime/size(未变化 → suspect);prompt 含路由上下文。
- **R4 失败可见性(评审 P8/P10)**:每次执行写 `.jspace/logs/cron/<id>/<ts>.md`(时间/退出码/输出摘要,截断);失败追加 `.jspace/logs/cron-failed.md`(保留最近 N 条);`jspace cron status [id]`(最近一次运行时间/退出码/成败/日志路径);工作台 `doctor` 输出 cron-failed 摘要;AGENTS.md 加「会话开始检查 cron-failed + cron status」(best-effort,非唯一通道)。
- **R5 首批任务(评审 P2)**:模板 `.jspace/cron.json` 默认**仅 inbox-tidy enabled**(每日 21:00,错峰);weekly-report / memory-consolidate 以 `enabled:false` + 启用条件注释交付(等 M4 记忆精度与产出契约)。
- **R6 诚实声明(评审 P1)**:「错过不保证准点;睡眠错过的调度在**下次唤醒/开机登录后补跑一次**(多次合并为一次);整夜关机不唤醒则跳过;仅用户已登录会话触发。cron 定义视为代码(git 同步),改动需 review」。
- **R7 日志保留(评审 P5)**:每 id 保留最近 N(如 30)份 run 日志;cron-failed.md 保留最近 N 条;run 内自动 prune。
- **R8 plist 漂移(评审 P4)**:add/remove 检测已装对应 plist → 打印「请重跑 install」;doctor 比对 cron.json 与 `com.jspace.cron.*.plist` 不一致告警。
- **R9 回归**:CLI 全命令面、install 生成 plist 正确(plutil -lint)、run --dry-run、tsc/gen-assets/build、doctor 覆盖 cron.json 只读校验。

## Acceptance Criteria

- [ ] AC1 `.jspace/cron.json` 管理(add/list/remove)与 schema 校验(id 查重/schedule 子集/harness/prompt/enabled)。
- [ ] AC2 `install` 生成**每 cron 一个** `com.jspace.cron.<id>.plist`,ProgramArguments 各带正确 `--id`,plutil 合法、launchctl 可加载;`uninstall` 清理全部。
- [ ] AC3 `run <id>` 无头执行(干跑/真实):argv 传参、进程组超时、权限白名单、退出码/输出捕获,日志落 `.jspace/logs/cron/<id>/`;`--dry-run` 只打印。
- [ ] AC4 失败 → cron-failed.md(最近 N 条)+ doctor 摘要 + `cron status` 可查。
- [ ] AC5 inbox-tidy:run 前 asset-ingest 存在性检查 + run 后 batch 日志 mtime/size 比对(suspect 标记)。
- [ ] AC6 真实 e2e 闸门:`cron run inbox-tidy` 在真实工作台跑通(exit 0 + batch 日志追加)后才允许 install/依赖(评审 P3)。
- [ ] AC7 诚实声明措辞(唤醒补跑一次)+「cron 视为代码」说明。
- [ ] AC8 回归:tsc/gen-assets/build;doctor 含 cron.json 校验。

## Key Decisions

- **一 cron 一 plist**(评审 B1,3 视角共识):launchd 每 plist 只承载一个 ProgramArguments,单 plist 多 StartCalendarInterval 会全部触发同一 --id。
- **受限 schedule 子集 + 拒绝 DOM&DOW 并存**(评审 B6):`*` 省略键;列表/步进报错;Day+Weekday 并存显式报错——不仲裁专家 AND/OR 事实分歧。
- **安全执行模型**(评审 B2/B3):argv 数组禁 shell;进程组杀;权限白名单禁 bypass;失败=非0||超时||exit0无输出(suspect)。**提示词确认仪式不做**(私有单用户,argv 已消除注入面;威胁模型写入 AGENTS.md)。
- **inbox-tidy 守卫**(评审 B4):技能存在性 + batch 日志比对,防静默空跑。
- **batch.md `.processing` 改瞬态**(对评审 B5-② 的调整):成功失败都清除标记,失败文件留 `_inbox/` + 原因记日志 → 下次自然重试;比 `--retry-failed` 管道更简单。
- **MVP 仅 macOS**(评审 P9):Linux/Windows 调度推迟 M5。
- **仅 inbox-tidy 启用**(评审 P2):weekly/memory disabled 待 M4。
- **移除 target_domain**(评审 P6):不做声明即死字段。

## Out of Scope

- Linux/Windows 调度后端(M5);通知推送(维持砍);事件驱动/自主代理/常驻进程。
- weekly-report 产出契约、memory-consolidate 启用(等 M4)。
- 多任务队列/并发管理(MVP 用 flock 单机串行)。

## Open Questions

- **无阻塞开放问题**。

## Notes

- 专家评审批判性吸收:采纳 B1/B2/B4/B5①/B6/P1/P2/P3/P4/P5/P7/P8/P9/P10;调整 B3(不做事前确认)、B5②(改瞬态标记根治)、P6(移除字段);拒绝/推迟 Linux/Windows、通知、weekly/memory 契约。
