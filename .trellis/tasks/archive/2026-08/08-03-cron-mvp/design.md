# M3 cron MVP — 技术设计(修订版,批判性吸收评审)

## 架构与边界

```
.jspace/cron.json(声明式定义,git 同步)
  → jspace cron install → 每 cron 一个 macOS launchd LaunchAgent(com.jspace.cron.<id>)
  → launchd 触发 jspace cron run --id <id>
      → cd 工作台 + 导出 PATH/HOME → flock 互斥 → harness 无头进程(claude -p 带权限白名单 / codex exec / pi -p)
      → 捕获退出码/超时/输出 → 写 .jspace/logs/cron/<id>/<ts>.md
      → 失败/suspect → 追加 .jspace/logs/cron-failed.md(最近 N 条)
      → doctor / cron status 输出摘要 → 下次会话可见
```

无常驻进程:每次调度 = 一个一次性 harness 无头进程。inbox-tidy 的 prompt 触发 asset-ingest 批量无头第一遍(M2 复用 + 守卫)。

## 关键设计

### 1. `.jspace/cron.json` schema(v1)
```json
{ "version": 1, "crons": [
  { "id": "inbox-tidy", "schedule": "0 21 * * *", "harness": "claude",
    "prompt": "整理一下 inbox(无头模式:只处理确定性文件,模糊项留清单不提问)", "enabled": true }
] }
```
- 存 `.jspace/cron.json`;`loadCrons/saveCrons` 类似 registry.ts,校验 version===1。
- add/load 查重 id(复用 findIndex);无 target_domain(评审 P6 移除)。
- 缺文件:`loadCrons` 返回空数组 + 提示(老工作台可 `cron add` 自动创建)。

### 2. schedule → launchd(一 cron 一 plist)
- **受限子集**(评审 B6):每字段单值或 `*`;`*` → **省略键**(StartCalendarInterval 只有省略键表示任意,填 0 会静默改语义);列表/区间/步进 → 显式报错;weekday 收口 0-7(0/7 = 周日);**DOM 与 DOW 同时非 `*` → 显式报错拒绝**(launchd AND/OR 语义存在事实分歧,不仲裁,拒绝该组合)。
- 每 enabled cron 生成 `~/Library/LaunchAgents/com.jspace.cron.<id>.plist`:
  - `Label: com.jspace.cron.<id>`
  - `ProgramArguments: [<jspace 全路径>, "cron", "run", "--id", <id>]`(jspace 路径复用 init.ts 的 `isCompiled() ? "jspace" : join(devRoot(), "bin", "jspace")` 分支;harness 二进制 install 时 `which` 解析绝对路径写入 prompt 引用处)
  - `StartCalendarInterval`: 单字典 `{Minute, Hour, Day?, Month?, Weekday?}`(省略键表示任意)
  - `EnvironmentVariables`: `{PATH, HOME}`(可加 BUN_INSTALL)
  - `WorkingDirectory`: `<工作台>`
  - `StandardOutPath/StandardErrorPath`: `.jspace/logs/cron/launchd-<id>.log`
  - `RunAtLoad: false`
- install:先 `mkdirSync(.jspace/logs/cron, {recursive:true})`(launchd 不自动建父目录,评审 P7);旧同 id plist 先 unload;生成后 `plutil -lint` 校验;`launchctl load`。unload 非 0(如 113)容忍(幂等)。
- uninstall:unload + 删 `com.jspace.cron.*` + 清 launchd-<id>.log。

### 3. `jspace cron run <id>`(安全执行模型)
- 校验 cron 存在且 enabled(disabled → 跳过打印提示)。
- 构建:`spawn(argv)` **数组传参**(禁 shell 拼接,消除注入面,评审 B2/B3):
  - claude:`claude -p <prompt> --output-format text` + `--allowedTools` 白名单(Bash、Read、Write、Edit 或 gbrain:*;禁 bypassPermissions)。
  - codex:`codex exec <prompt>`;pi:`pi -p <prompt>`(experimental)。
- 环境:继承 + 显式 PATH/HOME/BUN_INSTALL;`detached:true`;超时(默认 30min,`--timeout`)→ `process.kill(-pid)` **进程组杀**(不留孤儿)。
- **失败判定** = 非 0 || 超时 || exit 0 但无实质输出(标记 suspect 供肉眼复核,不硬判失败);maxBuffer 高值/流式。
- **flock 互斥**:工作台 `.jspace/logs/cron/.lock` 文件锁,已锁 → skip + 写日志(单机单任务,评审 B5-①)。
- **幂等护栏**:同一 id 当日已有成功日志 → 跳过(评审 P1,launchd 补跑与手动重复触发都覆盖)。
- **inbox-tidy 守卫**(评审 B4):
  1. run 前检查 `skills/asset-ingest/` 存在,缺 → 直接写 cron-failed.md;
  2. 执行前记录 batch 日志 `.jspace/logs/inbox-batch.md` 的 mtime+size,执行后比对未变化 → suspect;
  3. prompt 注入路由上下文(如「在工作台根目录,按 AGENTS.md 路由;优先用 asset-ingest 批量模式」)。
- `--dry-run`:只打印将执行的命令与工作目录。

### 4. 失败可见性
- 每次 run 写 `.jspace/logs/cron/<id>/<YYYYMMDD-HHMMSS>.md`:id/时间/命令/退出码/输出摘要(截断 64KB)/成败/suspect 标记。
- 失败或 suspect → 追加 `.jspace/logs/cron-failed.md`(时间 + id + 退出码 + 日志路径);保留最近 N 条。
- `jspace cron status [id]`:最近一次运行时间/退出码/成败/日志路径(评审 P10)。
- 工作台 `doctor`:追加 cron.json 只读校验 + cron-failed 摘要(评审 P8)。
- 工作台 `AGENTS.md`:「会话开始检查 `jspace cron status` 与 `.jspace/logs/cron-failed.md`;cron 定义视为代码(git 同步),改动需 review」(best-effort)。

### 5. 默认模板(评审 P2)
`templates/workbench/.jspace/cron.json`:
- `inbox-tidy` enabled(每日 21:00,错峰);
- `weekly-report` disabled(+启用条件注释:待产出契约——目标项目目录/文件名/slug);
- `memory-consolidate` disabled(+启用条件注释:待 M4 记忆精度/实体 slug 规范)。

### 6. 日志保留(评审 P5)
- 每 id run 日志保留最近 N=30,run 内自动 prune;
- launchd-<id>.log 每次 run 开始时截断;
- cron-failed.md 保留最近 N=30。

### 7. plist 漂移(评审 P4)
- `cron add/remove` 检测 `~/Library/LaunchAgents/com.jspace.cron.<id>.plist` 已存在 → 打印「已安装,请重跑 `jspace cron install`」;
- doctor 比对 cron.json 的 enabled ids 与 LaunchAgents 里的 plist,不一致 → warning。

## 兼容与迁移

- 未分发、本地自用;`.jspace/cron.json` 新文件,不破坏现有 `.jspace/`。
- 老工作台缺 cron.json:loadCrons 空 + 提示;`~/jspace-work` 按「清空重 init」约定重建获取新模板。
- 诚实文档(评审 P1):错过不保证准点;睡眠错过 → 下次唤醒/开机登录补跑一次(多次合并一次);整夜关机不唤醒则跳过;仅用户已登录会话触发。

## 取舍

- **一 cron 一 plist vs 单 plist**:launchd 单 plist 多 StartCalendarInterval 无法分发不同 --id(评审 B1 共识),一 cron 一 plist 委托调度 + 补跑给 launchd。
- **受限 schedule 子集**:接受「复杂表达式不支持」换「不静默错排」(评审 B6);拒绝 DOM&DOW 并存绕开专家语义分歧。
- **argv + 白名单 + 进程组杀**:关闭注入面 + 不留孤儿 + 不越权;「提示词确认仪式」不做(私有单用户)。
- **batch `.processing` 瞬态**:根治失败永久跳过(评审 B5-② 的调整),不引入 --retry-failed 管道。
- **flock 单机串行**:满足「单机单任务」Out of Scope,防 launchd 补跑撞车。

## 操作与回滚

- `jspace cron uninstall` 卸载;cron.json 可随时 edit;日志可清。
- 全部本地文件 + launchctl,可逆;回滚 = 还原 diff + gen-assets + uninstall。
