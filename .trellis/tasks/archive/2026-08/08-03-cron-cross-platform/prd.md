# 跨平台 cron 后端 + CLI 三平台验证

## Goal

**项目必须支持 macOS / Linux / Windows 三平台(用户硬需求,推翻 M3 专家 P9 的「砍 Linux/Windows」)**。把 `jspace cron install` 调度后端扩展到三平台:macOS launchd(已有)/ Linux crontab / Windows schtasks;`run` 按平台分支(win32 进程树杀、.cmd spawn、PATH 分隔符);`doctor` 平台分发;并提供三平台验证矩阵。**本版吸收跨平台评审 H1-H5 + M1-M6**(见 Key Decisions 与 Notes)。

## Background(确认事实)

- build:all 已产出 7 平台二进制;当前平台 `bun run build` 产出 `bin/jspace`(win 为 `.exe`)。
- cron.ts 平台相关点:`~/Library/LaunchAgents`/`plutil`/`launchctl`(macOS)、`which`(win 用 `where`)、`process.kill(-pid)`(仅 POSIX)、spawn 直跑 harness(win `.cmd` shim 会 ENOENT)。
- `cron run` 无 `--dir` 参数(`workbenchRoot()` 从 cwd 推导)→ schtasks 默认 `C:\Windows\System32` 必挂(H1)。
- crontab 行裸拼(PATH/HOME/路径未引用)→ 空格拆词、`%` 截断、注入面(H2);crontab 读改写未建模「无 crontab/尾换行」(H3)。
- M3 已交付 launchd 后端;CI(GitHub 计费锁)阻塞 → Linux/Windows 真机验证靠纯函数 + 手动矩阵。

## Requirements

- **R1 平台检测与二进制解析**:`process.platform` → darwin/linux/win32;`jspaceBinary()` 平台正确(**win32 源码检出按存在性探测 `bin/jspace.exe`/`bin/jspace`**,编译=process.execPath);harness 解析 `which`(unix)/`where`(win32)。
- **R2 跨平台 `cron install`**:
  - **darwin**:launchd(已有,`plutil` 校验仅 darwin);
  - **linux(crontab)**:注释块管理(`# jspace crons (managed)`…`# end jspace`);每行 = **POSIX 单引号引用全部路径**(helper `'…'` + `'` 转义)+ **`%` 转义 `\%`** + env 显式导出(PATH/HOME)+ 日志重定向 + **超 1000 字符显式报错**;`crontab -l` 处理**无 crontab(exit 1→空输入)/末行无换行(补 `\n`)** 分支;写回前备份、写回后校验;空表 uninstall → `crontab -r`;**抽 `replaceManagedBlock(existing, block)` 纯函数**(保留非 jspace 行、冲突检测);
  - **win32(schtasks)**:每 enabled cron 建 `JSpaceCron_<id>`(含工作台 root 短身份,避免多工作台互踩)计划任务;命令带 **`cron run --dir <root> --id <id>`**(摆脱调度器 cwd,修 H1);任务显式 **`/it`**(交互令牌,修 M3);**DAILY / WEEKLY 子集**(`dow` 0/7→SUN 归一、month/dom 定值→拒绝),其余显式报错(H5);
  - 不可用平台 → 明确报错。
- **R3 跨平台 `cron uninstall`**:darwin 清 plist;linux 删注释块(空表 `crontab -r`);win 逐 `schtasks /delete /tn <name> /f`;各后端只操作**自己的命名空间**,检测他工作台残留并告警(M4)。
- **R4 `run` 平台分支(撤回「无平台耦合」断言,H4)**:
  - win32 超时用 **`taskkill /pid <pid> /T /F`** 杀进程树(unix 保留负 PID 进程组);
  - harness 解析到 `.cmd`/`.exe` 结尾 → **`shell:true`/`cmd /c` 包裹**;
  - PATH 兜底按平台分隔符(`;` win / `:` unix);
  - 其余(argv 传参、日志、flock、守卫、失败判定)跨平台。
- **R5 `doctor` 平台适配(去门闩,M1/M5)**:去掉 `installedIds.size>0` 外层门闩;按平台分发 installed 检测——darwin 查 plist、linux 查 crontab 块(**并检查 crontab 命令与 cron 服务存在**,warning)、win 查 schtasks;各平台输出「enabled 但未安装 / 残留」告警。
- **R6 验证矩阵**:本机 macOS 实测;纯函数单测(`crontabBlock`、`replaceManagedBlock`、`schtasksArgs`、`isWindowsInstallable`、`jspaceBinary`/`whichBin` win 分支,含空格/单引号/`$()`/`%` 对抗用例);手动矩阵含 **Windows 登录态/登出态两步** 与 **linux 无 cron 服务** 用例(M5);CI 解锁后的 **doctor-on-linux/win 断言表** 与 cron 冒烟占位预写(M6)。

## Acceptance Criteria

- [ ] AC1 `jspaceBinary()` 平台正确(win 存在性探测 `.exe`);harness `which`/`where` 分支。
- [ ] AC2 install 三平台分支;darwin 实测;linux crontab 行生成纯函数(单引号引用 + `%` 转义 + env + 日志)与 `replaceManagedBlock` 正确(空输入/粘连/冲突);win schtasksArgs(DAILY/WEEKLY、dow 归一、非法→null)正确。
- [ ] AC3 uninstall 三平台清理 + 空表 `crontab -r` + 各平台只动自己命名空间。
- [ ] AC4 `cron run --dir` 生效(三后端统一显式传 root);win32 分支(taskkill /T /F、.cmd shell、PATH `;`)逻辑正确。
- [ ] AC5 doctor 平台分发,无门闩吞告警;linux crontab/cron 服务检查;非 darwin 不误报 plist。
- [ ] AC6 验证矩阵文档(含 win 登录/登出、linux 无服务用例 + doctor 断言表);本机 macOS 实测通过。

## Key Decisions

- **推翻 M3 P9**:三平台为硬需求。
- **H1**:`cron run` 增加 `--dir <root>`,launchd/crontab/schtasks 三后端统一显式传 root(采纳专家优选,弃 `cmd /c cd /d`)。
- **H2**:crontab 行全路径 POSIX 单引号引用 + `%` 转义 + 1000 字符报错(关注入面,恢复 argv 级别保证)。
- **H3**:`replaceManagedBlock` 纯函数 + 读改写 status/尾换行/备份分支。
- **H4**:win32 `taskkill /T /F`、`.cmd` shell 包裹、PATH `;` 兜底;撤回「无平台耦合」。
- **H5**:统一 DAILY/WEEKLY(删 MINUTE);schtasksArgs 前置校验(dow 0/7→SUN、month/dom 定值→null)。
- **M3**:win 任务 `/it`;env/凭据前置自检进 doctor;文档明示「cron 凭据存 harness 配置」。
- **M4**:块标记/任务名注入工作台 root 短身份;同 id 冲突显式报错而非 `/f` 覆盖。
- **M5**:doctor 检查 crontab/cron 服务存在(linux);「仅登录时运行」定为 win 文档边界。
- **M6**:CI 冒烟占位(`if: false`)+ doctor-on-linux/win 断言表预写。

## Out of Scope

- Linux/Windows 真机自动化验证(CI 计费锁阻塞;纯函数 + 手动矩阵 + 断言表兜底)。
- Windows 任意 cron 表达式(PowerShell 触发器,后续)。
- 通知推送、事件驱动、常驻进程(维持)。

## Open Questions

- **无阻塞开放问题**。

## Notes

- 诚实边界:Linux/Windows 运行期无法本机实测,交付「逻辑正确 + 纯函数单测 + 手动矩阵 + CI 断言表」;win 分支的 run 超时终止/harness 启动为未验证风险,文档明示。
