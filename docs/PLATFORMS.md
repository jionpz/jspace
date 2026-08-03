# JSpace 跨平台支持矩阵

JSpace **必须支持 macOS / Linux / Windows 三平台**。本文档记录各平台的调度后端、已知差异、手动验证矩阵,以及 CI 解锁后的通过标准。

## 平台调度后端

| 平台 | `jspace cron install` 后端 | 补跑语义 | 运行上下文 |
|---|---|---|---|
| macOS | launchd(一 cron 一 plist,`~/Library/LaunchAgents/com.jspace.cron.<id>.plist`) | 睡眠错过 → **下次唤醒补跑一次**(多次合并一次);整夜关机不唤醒则跳过 | 仅用户已登录会话 |
| Linux | crontab(注释块 `# jspace crons (managed)`…`# end jspace`) | **无补跑**(错过即跳过) | 登录用户,环境最小(PATH/HOME 由 install 烘焙) |
| Windows | Task Scheduler(`schtasks`,任务名 `JSpaceCron_<wb-id>_<id>`) | **无补跑** | **默认仅登录时运行**(登出不触发);`/it` 交互令牌 |

> **调度语义差异诚实声明**:三个平台对「错过的时间点」行为不同——macOS 会唤醒补跑,Linux/Windows 直接跳过。这是各系统调度器的固有差异,cron 定义(`.jspace/cron.json`)是平台无关的,同一份定义在三平台行为可能不同。失败都会写 `.jspace/logs/cron-failed.md`,下次会话可见。

## Windows 支持的调度子集

MVP 只支持能映射到 Task Scheduler 的 **DAILY / WEEKLY**:

| cron 例子 | 语义 | schtasks |
|---|---|---|
| `0 21 * * *` | 每天 21:00 | `/sc DAILY /st 21:00` |
| `0 21 * * 0` | 每周日 21:00 | `/sc WEEKLY /d SUN /st 21:00` |
| `0 21 * * 7` | 每周日 21:00(dow 7=周日) | `/sc WEEKLY /d SUN /st 21:00` |

不支持的调度(MONTHLY、dom 定值、month 定值、列表/步进)→ `cron add`/`install` 在 Windows 上**显式报错**(`isWindowsInstallable` 前置校验),不静默。

## 手动验证矩阵(每平台)

> 真机验证受 GitHub CI 计费锁阻塞,当前交付「逻辑正确 + 纯函数单测 + 本机(macOS)实测」。CI 解锁后按本矩阵自动化。

```bash
# 0. 构建当前平台二进制
bun run build            # -> bin/jspace (win: bin/jspace.exe)

# 1. 生成 + 校验工作台
bin/jspace init ~/ws-test
bin/jspace doctor --dir ~/ws-test      # 期望:0 error;cron 相关 warning 见断言表

# 2. 文件中心
bin/jspace filehub init ~/fh-test --register
bin/jspace inbox status                # 期望:empty

# 3. cron 全链
bin/jspace cron list                   # 期望:3 默认任务,inbox-tidy enabled
bin/jspace cron run inbox-tidy --dry-run   # 期望:打印将执行的命令
bin/jspace cron install                # 期望:调度器可见对应任务(见各平台)
bin/jspace cron status inbox-tidy      # 期望:never run
bin/jspace cron uninstall              # 期望:任务移除
```

### Windows 额外两步(登录/登出边界,M5)
1. **登录态实测**:`cron install` 后,`schtasks /query /tn JSpaceCron_<wb-id>_inbox-tidy` 应存在;等待/触发一次 `cron run`。
2. **登出态**:登出后任务**不会触发**(Task Scheduler 默认仅登录运行)——这是文档明示的产品边界,不视为 bug。

### Linux 额外用例(无 cron 服务,M5)
- 最小发行版/容器无 crontab 或未启动 crond:`jspace cron install` 应 **fail-fast 报错**;`doctor` 报「crontab 命令缺失 / cron 守护进程未运行」warning。

## doctor 断言表(CI 解锁后判通过标准,M6)

| 场景 | 平台 | `doctor` 期望输出 |
|---|---|---|
| 无 cron 定义 | 全部 | 无 cron 相关 warning |
| cron enabled 但未 install | 全部 | warning `cron <id> enabled but not installed` |
| 已 install | macOS | 无「enabled but not installed」warning;无 stale 告警 |
| 已 install | Linux | 无「enabled but not installed」;无 stale;crontab/cron 服务存在 → 无服务 warning |
| 已 install | Windows | 无「enabled but not installed」;无 stale;`schtasks /query` 存在 |
| cron 已删但调度器残留 | 全部 | warning `stale scheduled task com.jspace.cron.<id>` |
| cron-failed.md 有记录 | 全部 | warning `N failed cron run(s)` |
| Linux 无 crontab/无 crond | Linux | warning `crontab command not found` / `cron daemon not running` |
| 非法 schedule | 全部 | warning `cron <id>: invalid schedule` |

## CI 解锁后 cron 冒烟(占位)

`.github/workflows/build.yml` 已预留 cron 冒烟(注释 `if: false`):解锁后启用 `cron add → install → status → uninstall`,三平台 runner 全链 exit 0 + 按上表断言 doctor。

## 纯函数单测(本机可跑,无需真机)

`bun test cli/cron.test.ts` 覆盖:`crontabBlock`(单引号引用/`%` 转义/1000 字符)、`replaceManagedBlock`(空输入/替换保留用户行/移除/标记异常)、`schtasksArgs`(DAILY/WEEKLY/dow 归一/不支持→null)、`isWindowsInstallable`、`jspaceBinary`(win32 探测)、`parseSchedule`(子集/拒绝)。对抗用例:路径含空格/单引号/`%`、dow=7、month 定值。
