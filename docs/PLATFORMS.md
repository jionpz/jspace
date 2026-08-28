# JSpace 跨平台支持矩阵

JSpace **必须支持 macOS / Linux / Windows 三平台**。本文档记录各平台的调度后端、已知差异、手动验证矩阵,以及 CI 解锁后的通过标准。

## 平台调度后端

| 平台 | `jspace cron install` 后端 | 补跑语义 | 运行上下文 |
|---|---|---|---|
| macOS | launchd(一 cron 一 plist,`~/Library/LaunchAgents/com.jspace.cron.<tag>.<id>.plist`) | 睡眠错过 → **下次唤醒补跑一次**(多次合并一次);整夜关机不唤醒则跳过 | 仅用户已登录会话 |
| Linux | crontab(注释块 `# jspace crons <tag> (managed) DO NOT EDIT`…`# end jspace <tag>`,tag 见 §Scheduler 任务隔离) | **无补跑**(错过即跳过) | 登录用户,环境最小(PATH/HOME 由 install 烘焙) |
| Windows | Task Scheduler(`schtasks`,任务名 `JSpaceCron_<wb-id>_<id>`) | **无补跑** | **默认仅登录时运行**(登出不触发);`/it` 交互令牌 |

> **调度语义差异诚实声明**:三个平台对「错过的时间点」行为不同——macOS 会唤醒补跑,Linux/Windows 直接跳过。这是各系统调度器的固有差异,cron 定义(`.jspace/cron.json`)是平台无关的,同一份定义在三平台行为可能不同。Linux 侧「无补跑」的代码审计结论与合同边界见 §补跑语义合同;Windows 侧「仅登录时运行」的 argv 合同与登出协议见 §Windows 登录/登出边界 runbook。失败都会打开结构化 incident(`.jspace/state/incidents/`),`cron failures` 在下个会话可见;成功 retry 自动 resolve,`cron ack` 保留证据但停止告警。

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

> 构建/发布与一键安装已在 CI 自动验证(`.github/workflows/build.yml`:三平台矩阵构建 + `verify-install` 作业)。**Linux crontab 与 Windows schtasks 的调度 CRUD(写入/读回/卸载)自 2026-08-26 起也由 CI 真实执行**(见下方「CI cron 冒烟」)。本矩阵仍是本地开发期人工冒烟与 CI 断言口径;**真实触发**(等到时间点被拉起)与 macOS launchd 的真机安装仍需人工复核 —— Linux/Windows 的可复跑协议见 §真实触发 runbook。

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

### Windows 登录/登出边界 runbook(可勾选,M5)

产品边界:任务用 `/it`(交互令牌)创建,**默认仅在用户登录时运行**;登出后该槽不触发,登录后按下一个槽正常运行。这是明示的产品边界,不视为 bug。argv 侧的合同(`/it` 必在、`/ru` `/rp` 这类「无论是否登录都运行」开关必不在)由 `adapters/scheduler/scheduler.test.ts` 的「win32 create argv always carries /it and never a logged-out escalation switch」单测锁定;下面是真机侧的可勾选协议。

- [ ] **1. 登录态注册**:`cron install` 后 `schtasks /query /tn JSpaceCron_<wb-id>_<id>` 应存在(CI 已断言注册/读回,见「CI cron 冒烟」)。
- [ ] **2. 登录态钟点触发**(可选,属「真实触发 runbook」范畴):按下面的 Windows 真实触发 runbook 设近时点,确认到点后 `.jspace/state/runs/<id>/` 出现新 run。
- [ ] **3. 登出态跨槽**:把 `/st` 设到 5-10 分钟后 → **注销**(logoff,不是锁屏、不是休眠)→ 跨过该时点后重新登录 → 断言该槽**没有**新 run 文件(`.jspace/state/runs/<id>/` 数量不变),且 `schtasks /query /tn <task> /v /fo list` 的 `Last Run Time` 未推进到该时点。
- [ ] **4. 恢复**:重新登录后下一槽正常触发(可选);`cron uninstall` 清理。

> 锁屏与休眠**不等于**登出:锁屏会话仍在,任务照常触发;休眠属「错过」语义而非登出语义。第 3 步必须真的注销(`logoff` / 开始菜单→注销),否则观察无效。

### Linux 额外用例(无 cron 服务 / 沙盒隔离,M5 + issue #10)
- 最小发行版/容器无 crontab 或未启动 crond:`jspace cron install` 应 **fail-fast 报错**;`doctor` 报「crontab 命令缺失 / cron 守护进程未运行」warning。
- **沙盒 / PID+UID 隔离**(Codex sandbox、`bwrap --unshare-pid` 容器):宿主 cron daemon 与 crontab 对 doctor 不可见,`pgrep` 查不到进程、`crontab -l` 读不到宿主条目。doctor 经 `/proc/self/status` 的 `NSpid:` 字段(≥2 值 = 嵌套 namespace)识别,将状态降级为 **info**(`cron.daemon_unverifiable` / `cron.crontab_unverifiable`),不报 warning、不误导"未安装"——真机状态需在宿主上确认。

## 真实触发 runbook(Linux crond / Windows Task Scheduler)

> **真实触发的定义**:系统调度器**自行**在约定时刻把 `jspace cron run …` 拉起,并在 `.jspace/state/runs/<cron>/` 留下新 run JSON、`.jspace/logs/cron/<id>/` 留下 prose 日志。macOS launchd 的自然触发已在 GOAL 开放问题 #3 用真实日志闭合;本 runbook 补 Linux + Windows 两侧,执行后按下方证据模板回写台账。

**以下都不算真实触发**(台账/GOAL 均不得据此写「真实触发已验证」):

- CI 的「Cron CRUD smoke」——只证明**任务已注册且 argv 正确**(CRUD ≠ fire);hosted runner 的 crond/launchd 触发时机不是可信信号,也没有真实 harness CLI。
- `jspace cron run <id>`(人工或脚本直跑)——绕过调度器。
- `schtasks /Run /tn <task>`——经 Task Scheduler 执行,但**非钟点触发**;最多记为「调度器可执行入口冒烟」。

### Linux:临时「下一分钟」cron(实取 +2 分钟余量)

用一个只活几分钟的临时 cron,避免动真实任务。全程不需要 root(用户 crontab)。

```bash
WB=~/ws-test                     # 目标工作台
BIN=bin/jspace                   # 或已安装的 jspace
pgrep -x cron || pgrep -x crond  # 前置:cron 守护必须在跑(否则先启动)

# 1. 取「当前 +2 分钟」的时分,留出安装时间(cron add 默认 enabled;
#    模板自带的 4 个 cron 默认 disabled,拿它们做探针要先 cron enable)
read -r M H < <(date -d "+2 minutes" +"%M %H")
"$BIN" cron add trigger-probe --schedule "$((10#$M)) $((10#$H)) * * *" \
  --harness claude --prompt "echo jspace trigger probe" --dir "$WB"
"$BIN" cron install --dir "$WB"
crontab -l | sed -n '/jspace crons/,/end jspace/p'   # 证据①:受管块含 trigger-probe 行

# 2. 等过那一分钟(cron 分钟粒度,留 90s 余量)
sleep 150

# 3. 断言调度器自己拉起过
ls -l "$WB/.jspace/state/runs/trigger-probe/"        # 证据②:出现新 run JSON
"$BIN" cron status trigger-probe --dir "$WB"         # 证据③:不再是 never run
cat "$WB/.jspace/logs/cron/crontab-trigger-probe.log" # 证据④:crontab 重定向日志

# 4. 清理
"$BIN" cron uninstall --dir "$WB" && "$BIN" cron remove trigger-probe --dir "$WB"
crontab -l | grep -c 'jspace crons' || true          # 期望 0
```

判读:harness 本身可能因无 `claude` CLI 或配额失败 → run 记为 `failed` 并开 incident,**这仍然是真实触发成立**(调度器确实拉起了进程)。真实触发不成立的表现是**根本没有新 run 文件**——此时看 `journalctl -u cron`(或 `/var/log/syslog`)确认 crond 是否报了 `CMD` 与错误,常见成因是烘焙进 crontab 行的 `PATH`/`HOME` 或 jspace 二进制路径在 cron 的最小环境下不可用。

### Windows:DAILY 近时点

同构,注意两点:schtasks 的 `/st` 是分钟粒度;必须**保持登录**(登出侧见上面的登出边界 runbook)。

```powershell
$WB = "$HOME\ws-test"
$BIN = "$HOME\.local\bin\jspace.exe"
$t = (Get-Date).AddMinutes(3)
& $BIN cron add trigger-probe --schedule "$($t.Minute) $($t.Hour) * * *" `
  --harness claude --prompt "echo jspace trigger probe" --dir $WB
& $BIN cron install --dir $WB
schtasks /query /tn "JSpaceCron_<wb-id>_trigger-probe" /v /fo list   # 证据①:Next Run Time = 上面时点

Start-Sleep -Seconds 240                                            # 等过该时点

Get-ChildItem "$WB\.jspace\state\runs\trigger-probe"                # 证据②:新 run JSON
& $BIN cron status trigger-probe --dir $WB                          # 证据③:不再 never run
schtasks /query /tn "JSpaceCron_<wb-id>_trigger-probe" /v /fo list  # 证据④:Last Run Time 已推进

& $BIN cron uninstall --dir $WB; & $BIN cron remove trigger-probe --dir $WB
```

### 证据模板(回写台账用)

回写台账「证据」列时逐字段填,缺字段即视为未闭合:

```
日期: 2026-MM-DD
平台/版本: Ubuntu 24.04 (cron 3.0pl1) | Windows 11 23H2
jspace: <版本或 commit>
cron id / schedule: trigger-probe / "37 14 * * *"
调度器读回: crontab -l 摘录 | schtasks /query /v 摘录(Next/Last Run Time)
run 证据: .jspace/state/runs/trigger-probe/<run-id>.json(status=<ok|failed>)
日志路径: .jspace/logs/cron/trigger-probe/<stamp>-<id>.md
判读: 调度器是否自行拉起(harness 成败不影响本条结论)
```

## 补跑语义合同(Linux 错过即跳过)

**合同**:Linux 侧 jspace **不实现任何补跑**。错过的槽位**不产生 run 记录**,`cron status` 保持上一次的状态,不会事后补一次。用户关机/挂起跨过槽位后没有 run —— 这是**符合合同的行为,不是 bug**。

代码审计结论(`adapters/scheduler/linux.ts`,2026-08-27):

- `crontabLine` 只发标准五字段 crontab 行(`分 时 日 月 周` + `cd … && jspace cron run …`);无 `@reboot` / `@daily` 特殊调度,无 anacron / `run-parts` 间接层,无「missed run」扫描或启动时补跑包装。整仓 grep `anacron|@reboot|StartWhenAvailable|catch-up` 在生产代码中零命中。
- `applyBatch` / `uninstallAll` 只重写本工作台的受管块,不注册任何附加单元(无 systemd timer、无 `@reboot` 引导项)。
- 唯一与「补跑」沾边的代码是 `application/automation/execute.ts` 的**当日成功去重**(`todaySuccess` → 已成功则 skip,`--force` 绕过)。它是为 macOS launchd 唤醒补跑做的**去重闸门**,只会**抑制重复运行**,永远不会**产生**一次错过的运行 —— 因此不构成 Linux 侧的补跑路径。
- 该合同由单测锁定:`adapters/scheduler/scheduler.test.ts`「linux install writes plain 5-field crontab entries — no anacron/@reboot catch-up wrapper」。
- **边界**:合同覆盖 jspace 写入用户 crontab(Vixie cron / cronie)这一路径。若某发行版的 cron 由 anacron 驱动、或用户改用 systemd timer 承载,则错过语义由该系统决定,不在本 MVP 合同内。

真机错过实验协议(可选增强,H 型):install 近时点 cron → 槽位前 `sudo systemctl stop cron`(或 `sleep`/挂机跨过)→ 槽位过后 `sudo systemctl start cron` → 断言该槽**无**新 run 文件;下一槽正常触发。

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
>
> **状态词表**（只用这四个，且效力递增/递减明确）：
>
> | 状态 | 含义 | 效力 |
> |---|---|---|
> | **未验证** | 既无真机观察也无工程替代 | 无 |
> | **工程已闭合 / 真机待使用** | 协议（runbook）+ 合同（单测/审计）已交付，**未**声称真机观察过 | 弱于真机；不得表述为「已验证」 |
> | **替代关闭** | 显式替代关闭条件 + 效力边界句，条目可关，脚注留「真机复核待…」 | 弱于真机 |
> | **真机已验证** | 真机执行 runbook 并回写证据模板全字段 | 最强 |
>
> **红线**：CI 的 Cron CRUD smoke、`jspace cron run <id>` 直跑、`schtasks /Run` 单独执行 **都不得**在本台账或 `GOAL.md` 写成「真实触发已验证」。CRUD ≠ fire；CLI 直跑 ≠ 调度器拉起。

| 平台 | 用例（见验证矩阵） | 状态 | 证据 |
|---|---|---|---|
| Linux | crontab `install → status → uninstall` 全链（CRUD） | **CRUD 已验证**（2026-08-26） | ① 合入前本机（Ubuntu 24.04 + cron，`NSpid:` 单值）按 `build.yml` 脚本原样通过（`bun-linux-x64-baseline`）。② **main @ `13bf260`（#21 合入后）再次原样通过**（`bin/jspace-smoke`）：doctor 报 `cron.not_installed` → install → `crontab -l` 含受管块与 smoke-test → status `never run` → 二次 install no-op → remove 后 `cron.stale_task` → uninstall 后受管块消失。同一脚本已进 CI（linux 两格）。真实触发与补跑语义见下面两行（本行**不**覆盖） |
| Linux | **① 真实触发**：crond 到点自行拉起 `jspace cron run`，`.jspace/state/runs/` 出现新 run | **工程已闭合 / 真机待使用**（2026-08-27） | 已交付（E）：本文档「真实触发 runbook」§Linux——临时「当前 +2 分钟」cron → install → `crontab -l` 摘录 → 等 150s → 断言 runs 目录 + `cron status` + crontab 重定向日志 → uninstall/remove 清理；含明文排除项（CI smoke / `cron run` 直跑 / `schtasks /Run`）与证据模板。runbook 的 CRUD 命令形态已在本仓库开发容器实跑校验（装 cron 包后 add → install → `crontab -l` 见受管块 → status → uninstall → 块消失）。**效力边界**：本容器**无 cron 守护进程**（`pgrep -x cron` 空），只证明「任务已按正确 argv 注册」，**未**证明 crond 能在烘焙的 `PATH`/`HOME` 下成功 spawn 该二进制并跑完。真机复核待有 Linux 常驻机执行 runbook 并回写证据模板 |
| Linux | **② 补跑语义**：错过槽位即跳过，不产生 run（无 anacron / 无 catch-up） | **替代关闭**（A，2026-08-27） | 替代关闭条件：① 代码审计（本文档「补跑语义合同」节）——`crontabLine` 只发标准五字段 crontab 行，无 `@reboot`/anacron/`run-parts`/missed-run 扫描，`applyBatch`/`uninstallAll` 不注册附加单元；整仓生产代码 grep `anacron|@reboot|StartWhenAvailable|catch-up` 零命中；② 合同单测 `adapters/scheduler/scheduler.test.ts`「linux install writes plain 5-field crontab entries — no anacron/@reboot catch-up wrapper」；③ 澄清 `execute.ts` 的 `todaySuccess` 是**去重闸门**（抑制重复），永不**产生**错过的运行。**效力边界**：错过行为是 Vixie/cronie 用户 crontab 的平台固有语义、非 jspace 实现分支；未在目标发行版上真机做「停 daemon 跨槽」实验；若某环境改用 anacron 驱动或 systemd timer 承载，不在本 MVP 合同内。真机复核待执行「补跑语义合同」节末的错过实验协议 |
| Linux | 无 crontab 命令 / 无 crond → `cron install` fail-fast + doctor warning | **已验证**（2026-08-26） | 本机临时移除 `/usr/bin/crontab`：`doctor` 报 warning `crontab command not found on this system` 且 **exit 0**（健康检查不抛）；`cron install` **exit 1**，文案 `crontab command not available (…ENOENT); install the cron package first (…)`（本次复核发现原文案是无信息量的 `crontab -l failed (status undefined)`，已硬化为 `adapters/scheduler/linux.ts` 的 `crontabUnavailable`）。无 crond：cron 已安装但守护进程未启动 → doctor 报 warning `cron daemon not running…` |
| Linux | **④ 沙盒 / PID+UID namespace 隔离** → doctor info 降级（`cron.daemon_unverifiable` 等，不报 warning） | **工程已闭合 / 真机待使用**（2026-08-27） | 降级侧（E）单测齐全：`adapters/scheduler/scheduler.test.ts` 的 `pidNamespaceIsolated` 解析 + `health()` 三态（ok / stopped / unverifiable）+ missing-cmd 分支；映射侧 `application/diagnostics/doctor.test.ts` 断言两个 `*_unverifiable` 的 severity **是 `info`**、不报 `cron.daemon_stopped` / `cron.crontab_missing` / `cron.not_installed`，且 doctor **exit 0**。**非降级侧**（真机绝不得报 `*_unverifiable`）由 `verify.yml` 与 CI cron 冒烟断言，并有「可核实宿主 → 两个 warning 都保留」的反向单测。**效力边界**：构造不出真实嵌套 namespace——本仓库开发环境 `NSpid:` 单值（非嵌套），GitHub runner 禁止非特权 user namespace（`verify.yml` 尾注实测）；因此降级路径只有单测证据，无真机观察。真机复核建议 WSL2 + Codex sandbox（或 `bwrap --unshare-pid`）内跑 `jspace doctor` 期望 info 降级、宿主上再跑确认非降级[^ns-wsl2] |
| Windows | schtasks `install` → `/query` 读回 → `uninstall`（CRUD） | **注册/读回已进 CI 断言**（2026-08-26） | `build.yml`「Cron CRUD smoke (Windows schtasks)」：install → `schtasks /query /fo csv /nh` 出现 `JSpaceCron_*` → `cron status` 为 `never run` → `cron remove` 后 doctor 报 `cron.stale_task` → uninstall 后任务消失。真实触发与登出边界见下面两行（本行**不**覆盖） |
| Windows | **① 真实触发**：Task Scheduler 到点自行拉起 `jspace cron run` | **工程已闭合 / 真机待使用**（2026-08-27） | 已交付（E）：本文档「真实触发 runbook」§Windows——`/st` 设近时点 → install → `schtasks /query /v /fo list` 看 `Next Run Time` → 等过时点 → 断言 runs 目录新增 + `Last Run Time` 已推进 → 清理；含明文排除项（`schtasks /Run` 只是「调度器可执行入口冒烟」，**不能**关闭本行）。**效力边界**：CI 只证明任务已注册且 `/tr`/`/st`/`/it` argv 正确（CRUD ≠ fire），未证明 Task Scheduler 在 `/it` 交互令牌下能 spawn 该二进制并跑完；hosted runner 的触发时机不是可信信号。真机复核待有 Windows 真机执行 runbook 并回写证据模板 |
| Windows | **③ 登出不触发**（产品边界，文档明示非 bug） | **替代关闭**（A，2026-08-27） | 替代关闭条件：① argv 合同单测 `adapters/scheduler/scheduler.test.ts`「win32 create argv always carries /it and never a logged-out escalation switch」——DAILY/WEEKLY 两种及真实写路径 `win32Adapter.buildContent` 都必须含 `/it`，且**禁止** `/ru`（run-as，如 SYSTEM）与 `/rp`（存储密码）这两个会让任务在无人登录时也运行的开关；② 产品边界文档化 + 可勾选协议（本文档「Windows 登录/登出边界 runbook」，含「锁屏/休眠 ≠ 登出」判读）。**效力边界**：未观察真实登出会话；结论依赖 Microsoft Task Scheduler「仅当用户登录时运行」的默认语义 + 上述 argv 合同；CI 的 schtasks CRUD **不**构成登出已验证（hosted runner 无登出语义）。真机复核待执行登出 runbook 第 3 步 |
| Windows | 非法 schedule（MONTHLY / dom / month 定值）→ 显式报错 | **已进 CI 断言**（2026-08-26） | 同上 Windows 步骤末尾的负向断言：`cron add --schedule "0 21 1 * *"` 必须非零退出且文案含 `not supported on Windows`（`cronAdd` 在 win32 上 add 期即拒绝）。纯函数侧另有 `isWindowsInstallable` 单测 |
| Windows | schtasks `/tr` 超长（>260 字符）→ build 阶段 fail loud | 未验证 | — |
| Windows | AVX-less（baseline）本地构建 `bun run build:all` 产物冒烟（CI 无 baseline 运行时） | **替代关闭**（2026-08-26） | 未获 AVX-less 硬件，改按替代关闭条件关闭：① `jspace update` **替换前自检**——下载 + SHA-256 通过后先落暂存文件跑 `--version`，exit≠0 或版本号不符即丢弃、**绝不触碰**现有二进制，文案点名 Windows x64 非 baseline / AVX2 边界（`cli/update.ts`，有单测）；② `install/install.ps1` 落盘前同构自检，失败不安装/不替换；③ 本文档「构建 target 兼容性」明示该边界。真机复核待有 AVX-less 机器 |
| 全部 | CI cron 冒烟解锁：`install → status → uninstall` 全链 exit 0 + doctor 断言 | **已解锁**（2026-08-26） | `.github/workflows/build.yml` 的 `if: false` 占位已替换为按 `runner.os` 分派的真实断言，见下节 |

[^ns-wsl2]: 沙盒降级真机复核建议路径（未执行）：在 WSL2 里用 Codex sandbox 或 `bwrap --unshare-pid --dev-bind / / -- jspace doctor --dir <wb>` 进嵌套 PID namespace，先 `grep NSpid /proc/self/status` 确认出现 ≥2 个值，再期望 doctor 输出 `cron.daemon_unverifiable` / `cron.crontab_unverifiable` 为 **info** 且 exit 0；退出沙盒在宿主上重跑，期望**不出现**任何 `*_unverifiable`。回写时按「真实触发 runbook」的证据模板记 `NSpid:` 原文 + 两次 doctor 输出。

## CI cron 冒烟（已解锁,2026-08-26）

`.github/workflows/build.yml` 的 build 矩阵按 runner OS 跑调度 CRUD 闭环,用编译好的发布产物(不是源码 CLI):

| runner | 步骤 | 断言 |
|---|---|---|
| Linux(2 格) | Cron CRUD smoke (Linux crontab) | `cron add`(enabled)→ doctor 报 `cron.not_installed` → `install --dry-run` 规划 `[create]` → `install` → `crontab -l` 含受管块 + smoke-test 行 → `cron status` 为 `never run` → doctor 不再报 `cron.not_installed` 且**不得**出现 `*_unverifiable` → 二次 `install` 为 no-op → `cron remove` 后报 `cron.stale_task` → `uninstall` 后受管块消失。runner 缺 `crontab` 时先装 cron,绝不静默跳过 |
| Windows(2 格) | Cron CRUD smoke (Windows schtasks) | 同构闭环,读回走 `schtasks /query`;末尾追加 dom 定值调度必须在 `cron add` 阶段被拒绝的负向断言 |
| macOS(2 格) | Cron plan smoke (macOS, no launchd mutation) | 仅 `cron install --dry-run` + `doctor`:launchd agent 绑定真实用户 GUI 会话,hosted runner 上 bootstrap 只会 flaky。仍覆盖 schedule 解析 + plist 内容编译 + 收敛规划 |

**刻意不断言的**:任务被**真的触发**。runner 上 crond/launchd 的触发时机不是可信信号,且无头 run 还需真实 harness CLI;真实触发留在上方台账的人工行。

> 触发时机注意：`build.yml` 只在 `push tags v*` 与 `workflow_dispatch` 上运行（PR 走 `verify.yml`）。**首跑已执行（2026-08-26）：第一轮 dispatch（32969257020）即抓出 win32 cron 读回 bug**——`schtasks /query` 输出任务路径形式（前导 `\`），裸名前缀过滤全丢 → install 成功后 doctor 仍报 `cron.not_installed`；修复 #23（含二次 install 非 no-op 的连带），复跑（32971530049）6 平台全绿。发版打 tag 前仍建议手动 dispatch 一次确认最新 main。
>
> Cloud Agent / 默认 `GITHUB_TOKEN` **无** `actions: write`，无法代你 `gh workflow run build.yml`（会 403）。本机 `gh`（凭据带 `workflow` scope）已实测可直接 dispatch（2026-08-26）；否则请仓库维护者在 GitHub → Actions → **build** → **Run workflow**（ref=`main`）手动触发。

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

