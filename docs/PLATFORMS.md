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

> 构建/发布与一键安装已在 CI 自动验证(`.github/workflows/build.yml`:三平台矩阵构建 + `verify-install` 作业)。本矩阵用于本地开发期人工冒烟与 CI 断言口径;真机调度行为(macOS launchd / Linux crontab / Windows schtasks)仍按本矩阵人工复核。

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

## 一键安装验证矩阵

安装脚本 `install/install.sh`(macOS/Linux)与 `install/install.ps1`(Windows)经 `build.yml` 的 `verify-install` 作业在三平台真机闭环(打 tag 发版时触发):

| 场景 | 断言 |
|---|---|
| 全新安装 | `jspace --version` 输出 `jspace <VERSION>`(绝对路径自检) |
| 幂等重装 | 二次安装 exit 0,rc/PATH 不重复追加 |
| 卸载 | POSIX:二进制移除、rc 标记块剥离;Windows:二进制移除、用户 PATH 条目精确移除 |
| 校验拒绝(本机负向) | 篡改二进制或 checksums → exit≠0、无残留 |
| 下载失败(本机负向) | 404/断网 → exit≠0、无残留、无半成品 |

本地开发期验证(需已有 release,或用 `JSPACE_BASE_URL` 指向本地模拟):
```bash
curl -fsSL <raw>/install/install.sh -o /tmp/jspace-install.sh && bash /tmp/jspace-install.sh
"$BIN_DIR/jspace" --version      # BIN_DIR=${XDG_BIN_HOME:-$HOME/.local/bin}
```

边界与约定:
- **glibc 边界**:release 仅提供 glibc 构建;musl 系统(Alpine 等)安装脚本明确报错并列出支持发行版。
- **架构探测**:macOS Rosetta(`sysctl -n sysctl.proc_translated`=1)强制 arm64;Windows ARM64 主机上 x64 模拟安装时提示。
- **符号链接 rc**(dotfiles 用户):脚本解析真实路径再写;解析失败则跳过自动注入并打印手动指令。
- **版本钉定**:`JSPACE_VERSION=<tag>` 安装指定版本(默认 `latest`);`JSPACE_BASE_URL` 可覆盖下载源(本地 e2e 逃生门)。
- **卸载语义**:只剥离 rc 标记块、绝不整文件回滚;「安装后改 rc 再卸载」保留用户编辑;Windows PATH 按条目精确删除。

## 跨平台脚本陷阱速查(2026-08-03 实测沉淀)

> 写跨平台 shell/PowerShell 安装脚本时先查这张表,全是真实踩过的坑。

| 陷阱 | 现象 | 正确写法 |
|---|---|---|
| `grep -Fx "<asset>"` 匹配 checksums | `-x` 要求整行等于资产名,而每行是 `hash  asset`,**恒失配** → 每次安装误报校验失败 | `awk -v a="$asset" '{f=$2; sub(/^\*/,"",f); if(f==a) print $1}'` |
| `${X:-~/.local/bin}` 参数展开默认值 | 参数展开默认值**不做 tilde 展开**,输出字面 `~/.local/bin`,装进字面 `~` 相对目录 | `${X:-$HOME/.local/bin}` |
| macOS BSD `readlink` 无 `-f` | macOS≤14 报 `illegal option`;macOS15 起有 | 探测 `readlink -f` 成功则用,失败回退 `perl -MCwd -e 'print Cwd::abs_path($ARGV[0])'` |
| macOS 校验工具 | 无 `sha256sum`(旧版);只有 `shasum -a 256` | `command -v sha256sum || shasum -a 256`,取首字段转小写比对 |
| `shasum`/`sha256sum` 输出格式 | `hash  file`(双空格);GNU `-b` 加 `*` 前缀;Get-FileHash 输出大写 hex | 一律取第一个空白分隔字段 + 转小写,不做整行比对 |
| `curl|bash` 管道退出码 | 管道退出码取**末命令**,curl 失败时 bash 收空 stdin exit 0 | 两段式 `curl -fsSL -o && bash`(也符合治理红线) |
| PATH 写入只对后续进程生效 | 当前会话/CI 非交互 step 读不到新 PATH,裸命令必 command not found | 自检用绝对路径;CI step 显式 `export PATH` |
| `irm url \| iex` 无法传参 | 管道进 iex 的脚本没有 `$args`,`-Uninstall` 绑定不上;落盘带 MOTW 被 RemoteSigned 拦截 | 卸载双触发:`-File install.ps1 -Uninstall` + `$env:JSPACE_UNINSTALL` |
| PS5.1 TLS/进度条 | 默认 TLS1.0 连不上 GitHub;iwr 进度条拖慢一个数量级 | `SecurityProtocol -bor Tls12` + `$ProgressPreference='SilentlyContinue'` + `-UseBasicParsing` |
| `SetEnvironmentVariable('Path','User')` | 不改当前进程;写入字面 `%VAR%` 永不展开;setx 有 1024 字符截断 | 用 `$env:LOCALAPPDATA` 展开成绝对路径;读/写都限定 User 作用域;按 `;` 去重 |
| Rosetta/模拟架构误判 | `uname -m`/PROCESSOR_ARCHITECTURE 在模拟下报错架构 | macOS 查 `sysctl -n sysctl.proc_translated`;Windows 查 `PROCESSOR_ARCHITEW6432`+`PROCESSOR_IDENTIFIER` |
| musl vs glibc | 发行二进制仅 glibc,Alpine 直接跑崩 | 安装脚本探测 musl 并明确报错列出支持发行版 |

