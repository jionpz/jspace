# JSpace 跨平台支持矩阵

JSpace **必须支持 macOS / Linux / Windows 三平台**。本文档记录各平台的调度后端、已知差异、手动验证矩阵,以及 CI 解锁后的通过标准。

## 平台调度后端

| 平台 | `jspace cron install` 后端 | 补跑语义 | 运行上下文 |
|---|---|---|---|
| macOS | launchd(一 cron 一 plist,`~/Library/LaunchAgents/com.jspace.cron.<tag>.<id>.plist`) | 睡眠错过 → **下次唤醒补跑一次**(多次合并一次);整夜关机不唤醒则跳过 | 仅用户已登录会话 |
| Linux | crontab(注释块 `# jspace crons <tag> (managed) DO NOT EDIT`…`# end jspace <tag>`,tag 见 §Scheduler 任务隔离) | **无补跑**(错过即跳过) | 登录用户,环境最小(PATH/HOME 由 install 烘焙) |
| Windows | Task Scheduler(`schtasks`,任务名 `JSpaceCron_<wb-id>_<id>`) | **无补跑** | **默认仅登录时运行**(登出不触发);`/it` 交互令牌 |

> **调度语义差异诚实声明**:三个平台对「错过的时间点」行为不同——macOS 会唤醒补跑,Linux/Windows 直接跳过。这是各系统调度器的固有差异,cron 定义(`.jspace/cron.json`)是平台无关的,同一份定义在三平台行为可能不同。失败都会打开结构化 incident(`.jspace/state/incidents/`),`cron failures` 在下个会话可见;成功 retry 自动 resolve,`cron ack` 保留证据但停止告警。

## 运行状态与 incidents（结构化，M3）

- 每次 run 写 `.jspace/state/runs/<cron>/<run-id>.json`（exit/status/timedOut/outputLog/batchChanged）；prose 日志保留在 `.jspace/logs/cron/<id>/` 作为人类 payload。
- failed/suspect/batch-stale run 打开或更新 incident（keyed by cron + failure class）；成功 retry 自动 resolve。
- `cron ack [id]`：open → acknowledged（证据保留，不再告警）；`cron check` 仅对 open（未 ack）incident 或 actionable pending write 返回非 0。

## Harness 能力矩阵（M4，cron argv）

`jspace cron run` 调 headless harness。各 harness 的 argv 由 `adapters/harness/`（capabilities.yaml 驱动，P1 数据化）组装；能力分级（automated = 有 `adapters/harness/*.test.ts` 单测证据）：

| harness | argv | 状态 | 备注 |
|---|---|---|---|
| claude | `-p <prompt> --output-format text --allowedTools Bash,Read,Write,Edit,mcp__gbrain__*` | automated | argv 形状 + 白名单有单测（`adapters/harness/argv.test.ts`）；无头执行需本机 `claude` 可用 |
| grok | `-p <prompt> --output-format json --allow Bash(*)` | best-effort | argv 组装有单测（`adapters/harness/grok.test.ts`）；无头执行需本机 `grok`，CI 未全链验证 |
| opencode | `run <prompt>`（positional） | best-effort | argv 组装有单测；无头 cron 可靠性未在 CI 验证 |
| codex | `exec <prompt>` | best-effort | argv 已实现，未在 CI 全链验证 |
| pi | `-p <prompt>` | best-effort | argv 已实现，未在 CI 全链验证 |

> cron 是无头 unattended 执行：`--allowedTools` 白名单、绝不 bypassPermissions。cursor 无 headless CLI（IDE-only 会话 harness），永不进 cron。
>
> **工具降权（`--tools` / cron.json `tools`）**：仅 claude/grok 支持（`supports_tool_restriction`）；opencode/pi/codex 设 `tools` 时 `cron add`/`cron run` 非 0 退出；doctor 对存量配置报 `cron.tools_unsupported_harness` warning（不自动改 cron.json）。
>
> **无头子进程 env（B6）**：`cronSpawnEnv(platform, harness)` 按 capabilities 声明的 per-harness 白名单放行（如 claude 仅 `ANTHROPIC_*` + `GBRAIN_*` + 基础 env）；默认**不含**跨厂商 API key 与 `NODE_OPTIONS`。claude 代理需保留 `ANTHROPIC_BASE_URL` 等——已在 `ANTHROPIC_*` 前缀内。
>
> **支持集** = 五个会话 harness（Claude Code / Grok Build / OpenCode / Pi / Cursor）+ Codex（cron 兼容）。

## Harness lifecycle 能力矩阵（M4，会话生命周期）

会话级能力（session-start / session-end / fallback / crash recovery）的**权威矩阵**在 `skills/jspace-use/references/harnesses.md`（capabilities.yaml render + 逐 harness 接线 `harness-<name>.md`），分级语义 automated / best-effort / manual / unsupported 并注明验证方法；本文档不复制整表以避免漂移。要点：lifecycle 当前无 automated 格（hook 真实触发是 harness 运行时行为，未在 CI 全链验证），产品措辞只在 automated 处使用「自动」。

## Scheduler 任务隔离（M5）

reconciliation（`cron install --dry-run` 可预演）用 `workbenchTag(marker.workbench_id)` 派生稳定短 tag 隔离各工作台任务，避免两工作台同名 cron 互覆盖。launchd plist 名 / crontab 标记 / schtasks 任务名的 tag 注入与按 tag 卸载已在 scheduler adapters 落地（2026-08-05 cron 收敛，`adapters/scheduler/{darwin,linux,win32}.ts`）；doctor 的已装任务判定亦走 tag-scoped inspect。真机调度行为仍按本矩阵人工复核。

## Windows 支持的调度子集

MVP 只支持能映射到 Task Scheduler 的 **DAILY / WEEKLY**:

| cron 例子 | 语义 | schtasks |
|---|---|---|
| `0 21 * * *` | 每天 21:00 | `/sc DAILY /st 21:00` |
| `0 21 * * 0` | 每周日 21:00 | `/sc WEEKLY /d SUN /st 21:00` |
| `0 21 * * 7` | 每周日 21:00(dow 7=周日) | `/sc WEEKLY /d SUN /st 21:00` |

不支持的调度(MONTHLY、dom 定值、month 定值、列表/步进)→ `cron add`/`install` 在 Windows 上**显式报错**(`isWindowsInstallable` 前置校验),不静默。

## 手动验证矩阵(每平台)

> 构建/发布与一键安装已在 CI 自动验证(`.github/workflows/build.yml`:三平台矩阵构建 + `verify-install` 作业)。**Linux crontab 与 Windows schtasks 的调度 CRUD(写入/读回/卸载)自 2026-08-26 起也由 CI 真实执行**(见下方「CI cron 冒烟」)。本矩阵仍是本地开发期人工冒烟与 CI 断言口径;**真实触发**(等到时间点被拉起)与 macOS launchd 的真机安装仍按本矩阵人工复核。

### 构建 target 兼容性(发布二进制与本地构建一致)

- x64 目标使用 `-baseline`(不要求 AVX 的兼容构建):`bun-linux-x64-baseline`、`bun-darwin-x64-baseline`。
- **Windows x64 例外**:GitHub Windows runner 上 baseline bun runtime 下载被持续阻断,因此发布/CI 的 Windows x64 二进制用**非 baseline** `bun-windows-x64`(需 AVX2)。`scripts/build-all.ts`、`package.json build:win` 与 CI 矩阵保持一致(单一权威,AC9),本地 `bun run build:all` 产出的 `bin/jspace-windows-x64.exe` 与 Release 资产同 target。
- arm64 目标(`bun-*-arm64`)无需 baseline 区分。
- **AVX-less 机器的护栏**:因为 Windows x64 发布产物需要 AVX2,`jspace update` 与 `install.ps1` 都在替换前跑一次 `--version` 自检,跑不起来就丢弃下载、保留现有二进制(见下方「一键安装验证矩阵」的边界与约定)。这是「未获 AVX-less 硬件」那条台账行的替代关闭条件。


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
bin/jspace cron list                   # 期望:4 默认任务,全部默认 disabled(模板默认;需 jspace cron enable <id> 后 cron install;启用后 doctor 才报未安装)
bin/jspace cron run inbox-tidy --dry-run   # 期望:打印将执行的命令
bin/jspace cron install                # 期望:调度器可见对应任务(见各平台)
bin/jspace cron status inbox-tidy      # 期望:never run
bin/jspace cron uninstall              # 期望:任务移除
```

### Windows 额外两步(登录/登出边界,M5)
1. **登录态实测**:`cron install` 后,`schtasks /query /tn JSpaceCron_<wb-id>_inbox-tidy` 应存在;等待/触发一次 `cron run`。
2. **登出态**:登出后任务**不会触发**(Task Scheduler 默认仅登录运行)——这是文档明示的产品边界,不视为 bug。

### Linux 额外用例(无 cron 服务 / 沙盒隔离,M5 + issue #10)
- 最小发行版/容器无 crontab 或未启动 crond:`jspace cron install` 应 **fail-fast 报错**;`doctor` 报「crontab 命令缺失 / cron 守护进程未运行」warning。
- **沙盒 / PID+UID 隔离**(Codex sandbox、`bwrap --unshare-pid` 容器):宿主 cron daemon 与 crontab 对 doctor 不可见,`pgrep` 查不到进程、`crontab -l` 读不到宿主条目。doctor 经 `/proc/self/status` 的 `NSpid:` 字段(≥2 值 = 嵌套 namespace)识别,将状态降级为 **info**(`cron.daemon_unverifiable` / `cron.crontab_unverifiable`),不报 warning、不误导"未安装"——真机状态需在宿主上确认。

## doctor 断言表(判通过标准,M6)

> 标 **[CI]** 的行自 2026-08-26 起由 CI cron 冒烟在 Linux/Windows runner 上真实断言(见下方「CI cron 冒烟」):install 前必有 `cron.not_installed`、install 后必无、孤儿任务必有 `cron.stale_task`、真机上绝不出现 `*_unverifiable`。其余行仍是人工复核口径。

| 场景 | 平台 | `doctor` 期望输出 |
|---|---|---|
| 无 cron 定义 | 全部 | 无 cron 相关 warning |
| cron enabled 但未 install **[CI]** | 全部 | warning `cron <id> enabled but not installed` |
| 已 install | macOS | 无「enabled but not installed」warning;无 stale 告警 |
| 已 install **[CI]** | Linux | 无「enabled but not installed」;无 stale;crontab/cron 服务存在 → 无服务 warning |
| 已 install **[CI]** | Windows | 无「enabled but not installed」;无 stale;`schtasks /query` 存在 |
| cron 已删但调度器残留 **[CI]** | 全部 | warning `stale scheduled task <id>` |
| 存在 open cron incident | 全部 | warning `cron.open_incidents`（`N open cron incident(s)`） |
| Linux 无 crontab 命令 | Linux | warning `crontab command not found on this system` |
| Linux 有 crontab 命令但用户无 crontab(`crontab -l` status 1) | Linux | warning `no crontab installed for this user` |
| Linux 无 crond(命令在、进程未跑) | Linux | warning `cron daemon not running; scheduled tasks won't fire until it starts` |
| Linux 沙盒/namespace 隔离(宿主状态不可见) | Linux | info `cron.daemon_unverifiable` / `cron.crontab_unverifiable`(不报 warning) |
| 非法 schedule | 全部 | warning `cron.file_unreadable`（schedule 已在 decode 层校验，手改 cron.json 使文件不可读） |

## 真机验证台账（执行后回写，2026-08-26 建）

> 本台账跟踪「手动验证矩阵」在**真机**上的执行状态。每项执行后回写：日期 + 证据（输出 / 日志路径 / 截图）。
>
> **两类关闭条件**：① 调度 **CRUD**（写入 / 读回 / 卸载）可由 CI 在 hosted runner 上真实执行 —— 已解锁，见下节；② **真实触发**（等到时间点被 crond / launchd / Task Scheduler 拉起）、**沙盒 namespace 降级**、**AVX-less 硬件**这三类在 CI 与本仓库开发环境都构造不出，只能人工真机复核，或按此处显式记录的**替代关闭条件**关闭。

| 平台 | 用例（见验证矩阵） | 状态 | 证据 |
|---|---|---|---|
| Linux | crontab `install → status → uninstall` 全链（无补跑语义：错过即跳过） | **CRUD 已验证**（2026-08-26）；补跑语义仍未验证 | 本机（Ubuntu 24.04 容器 + cron 3.0pl1，`/proc/self/status` 的 `NSpid:` 单值即非嵌套 namespace）按 `build.yml`「Cron CRUD smoke (Linux crontab)」脚本**原样**执行通过（编译产物 `bun-linux-x64-baseline`，commit 702a61b）：install 后 `crontab -l` 含受管块与 smoke-test 行 → `cron status` 为 `never run` → doctor 不再报 `cron.not_installed` → 二次 install 为 no-op → `cron remove` 后 doctor 报 `cron.stale_task` → uninstall 后受管块消失。同一脚本已进 CI（linux 两格矩阵）。「错过即跳过」需真实错过一个时间点，**仍未验证** |
| Linux | 无 crontab 命令 / 无 crond → `cron install` fail-fast + doctor warning | **已验证**（2026-08-26） | 本机临时移除 `/usr/bin/crontab`：`doctor` 报 warning `crontab command not found on this system` 且 **exit 0**（健康检查不抛）；`cron install` **exit 1**，文案 `crontab command not available (…ENOENT); install the cron package first (…)`（本次复核发现原文案是无信息量的 `crontab -l failed (status undefined)`，已硬化为 `adapters/scheduler/linux.ts` 的 `crontabUnavailable`）。无 crond：cron 已安装但守护进程未启动 → doctor 报 warning `cron daemon not running…` |
| Linux | 沙盒 / PID+UID namespace 隔离 → doctor info 降级（`cron.daemon_unverifiable` 等，不报 warning） | 未验证 | 构造不出：本仓库开发环境 `NSpid:` 单值（非嵌套），GitHub runner 禁止非特权 user namespace（`verify.yml` 尾注实测）。仅单测覆盖（`pidNamespaceIsolated` + `health()` 三态分支）。**非降级侧**（真机绝不得报 `*_unverifiable`）已在 `verify.yml` 与本次 CI cron 冒烟中断言。真机复核建议 WSL2 + Codex sandbox |
| Windows | schtasks `install` → `/query` 存在 → 触发一次 `cron run` | **注册/读回已进 CI 断言**；真实触发仍未验证 | `build.yml`「Cron CRUD smoke (Windows schtasks)」：install → `schtasks /query /fo csv /nh` 出现 `JSpaceCron_*` → `cron status` 为 `never run` → `cron remove` 后 doctor 报 `cron.stale_task` → uninstall 后任务消失。真实触发（等到 21:00 或 `schtasks /run`）需真机 |
| Windows | 登出不触发（产品边界，文档明示非 bug） | 未验证 | 需真机登出会话观察；hosted runner 没有登出语义 |
| Windows | 非法 schedule（MONTHLY / dom / month 定值）→ 显式报错 | **已进 CI 断言**（2026-08-26） | 同上 Windows 步骤末尾的负向断言：`cron add --schedule "0 21 1 * *"` 必须非零退出且文案含 `not supported on Windows`（`cronAdd` 在 win32 上 add 期即拒绝）。纯函数侧另有 `isWindowsInstallable` 单测 |
| Windows | schtasks `/tr` 超长（>260 字符）→ build 阶段 fail loud | 未验证 | — |
| Windows | AVX-less（baseline）本地构建 `bun run build:all` 产物冒烟（CI 无 baseline 运行时） | **替代关闭**（2026-08-26） | 未获 AVX-less 硬件，改按替代关闭条件关闭：① `jspace update` **替换前自检**——下载 + SHA-256 通过后先落暂存文件跑 `--version`，exit≠0 或版本号不符即丢弃、**绝不触碰**现有二进制，文案点名 Windows x64 非 baseline / AVX2 边界（`cli/update.ts`，有单测）；② `install/install.ps1` 落盘前同构自检，失败不安装/不替换；③ 本文档「构建 target 兼容性」明示该边界。真机复核待有 AVX-less 机器 |
| 全部 | CI cron 冒烟解锁：`install → status → uninstall` 全链 exit 0 + doctor 断言 | **已解锁**（2026-08-26） | `.github/workflows/build.yml` 的 `if: false` 占位已替换为按 `runner.os` 分派的真实断言，见下节 |

## CI cron 冒烟（已解锁,2026-08-26）

`.github/workflows/build.yml` 的 build 矩阵按 runner OS 跑调度 CRUD 闭环,用编译好的发布产物(不是源码 CLI):

| runner | 步骤 | 断言 |
|---|---|---|
| Linux(2 格) | Cron CRUD smoke (Linux crontab) | `cron add`(enabled)→ doctor 报 `cron.not_installed` → `install --dry-run` 规划 `[create]` → `install` → `crontab -l` 含受管块 + smoke-test 行 → `cron status` 为 `never run` → doctor 不再报 `cron.not_installed` 且**不得**出现 `*_unverifiable` → 二次 `install` 为 no-op → `cron remove` 后报 `cron.stale_task` → `uninstall` 后受管块消失。runner 缺 `crontab` 时先装 cron,绝不静默跳过 |
| Windows(2 格) | Cron CRUD smoke (Windows schtasks) | 同构闭环,读回走 `schtasks /query`;末尾追加 dom 定值调度必须在 `cron add` 阶段被拒绝的负向断言 |
| macOS(2 格) | Cron plan smoke (macOS, no launchd mutation) | 仅 `cron install --dry-run` + `doctor`:launchd agent 绑定真实用户 GUI 会话,hosted runner 上 bootstrap 只会 flaky。仍覆盖 schedule 解析 + plist 内容编译 + 收敛规划 |

**刻意不断言的**:任务被**真的触发**。runner 上 crond/launchd 的触发时机不是可信信号,且无头 run 还需真实 harness CLI;真实触发留在上方台账的人工行。

> 触发时机注意:`build.yml` 只在 `push tags v*` 与 `workflow_dispatch` 上运行(PR 走 `verify.yml`)。因此这套冒烟的首个 run 证据来自下一次 tag 构建或手动 dispatch —— **发版前建议先手动 dispatch 一次**,别把调度冒烟的问题留到打 tag 当下。

## 纯函数单测(本机可跑,无需真机)

`bun test` 覆盖:`adapters/scheduler/scheduler.test.ts`（planReconciliation create/update/delete、两 workbench tag 隔离、crontabBlock 单引号/`%` 转义/1000 字符、replaceManagedBlock、schtasksArgs、isWindowsInstallable、buildPlist）、`application/automation/status.test.ts`（cron status/failures/check 结构化 incidents）、`application/automation/use-cases.test.ts`（cronInstall 端到端）。对抗用例:路径含空格/单引号/`%`、dow=7、month 定值。

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
- **`jspace update` 版本形态**:只接受**正式发布 tag** `vX.Y.Z`(裸 `1.2.3` 归一到 `v1.2.3`)。预发布/别名/畸形 tag 在下载前 fail loud —— 本项目不发预发布通道,放行只会让 update 去下一组根本不存在的产物。
- **`jspace update` 的 API 逃生门**:解析 `latest` 走 GitHub API,遇 403/429(未认证速率限制或代理拦截)会明确提示改用 `jspace update --version vX.Y.Z` —— 指定版本直连 releases 下载,完全绕过 API。
- **替换前自检(防变砖)**:SHA-256 只证明字节是我们发布的,不证明它能在本机跑起来。`jspace update` 与 `install.ps1` 都先把产物落到暂存文件跑一次 `--version`(须 exit 0 且输出含目标版本号),通过后才替换;失败即丢弃暂存文件、**绝不触碰**现有二进制,文案点名 Windows x64 非 baseline(需 AVX2)这条最可能的成因。暂存文件放**目标目录同级**而不是 `$TMPDIR`:`/tmp` 常挂 `noexec`,同盘 rename 也才是原子的。
- **`JSPACE_BASE_URL` 信任语义**:设置该变量即**完全信任该源**——二进制与 `checksums.txt` 的 SHA-256 校验对都来自同一个 base(install 脚本与 `jspace update` 一致),校验只防传输/宿主篡改,不防源本身。默认 GitHub Releases 安全;本地模拟/私有镜像源时需自行确保源可信。install 脚本强制 https 并用 `JSPACE_ALLOW_INSECURE=1` 显式放行 http。
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

