# 跨平台 cron 后端 — 技术设计(修订版,吸收评审 H1-H5 + M1-M6)

## 架构与边界

`jspace cron install/uninstall` 按 `process.platform` 分发;`cron run` 按平台分支(win32 进程树杀 / .cmd spawn / PATH 分隔符),其余(argv/日志/flock/守卫/失败判定)跨平台。

```
.crons → jspace cron install
  darwin → launchd(一 cron 一 plist,已有)
  linux  → crontab 注释块管理(单引号引用 + % 转义 + replaceManagedBlock)
  win32  → schtasks(JSpaceCron_<wb-id>_<id>,/it,--dir root,DAILY/WEEKLY)
```

## 关键设计

### 1. 平台检测与二进制解析
```ts
type Platform = "darwin" | "linux" | "win32";
const platform = process.platform as Platform;
function jspaceBinary(plat = platform): string {
  if (isCompiled()) return process.execPath;                 // 编译:任意平台
  if (plat === "win32") {                                    // 源码检出:存在性探测(H4)
    return existsSync(join(devRoot(), "bin", "jspace.exe"))
      ? join(devRoot(), "bin", "jspace.exe") : join(devRoot(), "bin", "jspace");
  }
  return join(devRoot(), "bin", "jspace");
}
function whichBin(name: string): string {                    // which/where(H4)
  const cmd = platform === "win32" ? "where" : "which";
  const w = spawnSync(cmd, [name], { encoding: "utf-8" });
  return (w.stdout ?? "").trim().split(/\r?\n/)[0] ?? name;  // win 取第一行
}
```
> `jspaceBinary` 做成可注入 platform 的纯函数,便于单测 win 分支。

### 2. darwin launchd(已有)
- `plutil -lint` 与 `launchctl` 仅 darwin;`plistPath`/`installedPlists` 仅 darwin 分支调用。

### 3. linux crontab(注释块 + 单引号引用 + 读改写边缘)
- **行格式**(每 enabled cron 一行,全路径 POSIX 单引号引用,修 H2):
  ```
  MIN HOUR DOM MON DOW  cd '<root>' && PATH='<path>' HOME='<home>' '<jspaceBin>' cron run --dir '<root>' --id '<id>' >> '<root>/.jspace/logs/cron/crontab-<id>.log' 2>&1
  ```
  - 引用 helper:`shq(s) = "'" + s.replace(/'/g, "'\\''") + "'"`;
  - `%` 转义 `\%`(cronie 换行语义);
  - 生成行超 1000 字符 → 显式报错。
- **读改写(H3)**:`crontab -l` →
  - exit 0 → 用 stdout(末尾无 `\n` 则补);
  - exit 1 + "no crontab" → 空输入;
  - 其他 → 报错。
  - 写回前备份到临时文件;写回用 `crontab -`(stdin),成功后校验。
  - 空表 uninstall → `crontab -r`。
- **纯函数 `replaceManagedBlock(existing, block)`**(H3):删除旧 jspace 块、保留非 jspace 行、追加新块;existing 为空 → 直接用新块;检测多个 jspace 块(冲突)报错。
- 诚实:crontab **无补跑**(错过即跳过),与 launchd 不同,文档明示。

### 4. win32 schtasks(DAILY/WEEKLY 子集 + --dir + /it + 工作台身份)
- **任务名**:`JSpaceCron_<wb-id>_<id>`(wb-id = root 短哈希/slug,防多工作台互踩,M4)。同 id 冲突 → 显式报错而非 `/f` 覆盖。
- **命令**:`"<jspaceBin>" cron run --dir "<root>" --id "<id>"`(**显式 --dir,修 H1**)。
- **`/it`**(交互令牌,修 M3):任务可访问用户凭据/交互上下文。
- **映射(纯函数 `schtasksArgs(cron, jspaceBin, root, taskName): string[] | null`,H5)**:
  - DAILY:`dom=* 且 dow=*` 且 minute/hour 定值 → `/sc DAILY /st HH:MM`;
  - WEEKLY:`dom=*`、dow 单值(0/7→SUN、1→MON…6→SAT)→ `/sc WEEKLY /d <DAY> /st HH:MM`;
  - month 定值 / WEEKLY 下 dom 定值 / DAILY 下 dow 定值 → **null**(拒绝);
  - 其余 → null。
- **前置校验 `isWindowsInstallable(schedule)`**:cron add/install 平台入口 fail-fast(非 DAILY/WEEKLY 在 win 上早报,而非 install 才报,H5)。
- uninstall:`schtasks /delete /tn <name> /f`(仅自己的命名空间)。
- 诚实:Windows 计划任务**无补跑**;**默认仅登录时运行**(登出不触发,M5 文档边界);运行环境 = 登录用户会话。

### 5. doctor 平台适配(去门闩,M1/M5)
- 去掉 `installedIds.size>0` 外层门闩(M1);按平台分发 installed 检测:
  - darwin:LaunchAgents plist;
  - linux:`crontab -l` 是否含 jspace 块(**并检查 `crontab` 命令与 cron 服务运行**,warning,M5);
  - win32:`schtasks /query /tn` 是否存在。
- 各平台输出「enabled 但未安装」「残留/陈旧」告警;非 darwin 不误报 plist。

### 6. run 平台分支(撤回「无平台耦合」,H4)
- 超时杀进程树:unix `process.kill(-pid, SIGTERM)`;win32 `taskkill /pid <pid> /T /F`。
- harness `.cmd`/`.exe` 结尾 → `spawn(..., { shell: true })` 或 `cmd /c` 包裹(win npm shim)。
- PATH 兜底:`win32 ? ";" : ":"` 分隔。
- **`cron run` 增加 `--dir <root>`**:cwd = 显式 root(替代 `workbenchRoot()` 从 cwd 推导),三后端统一传(H1);无 `--dir` 时回退 cwd(保持 CLI 手工调用可用)。
- 其余(argv 传参、flock、当日跳过、失败判定、inbox-tidy 守卫、日志)跨平台。

### 7. 验证矩阵(M5/M6)
- 纯函数单测(本机可跑):`crontabBlock`、`replaceManagedBlock`、`schtasksArgs`、`isWindowsInstallable`、`jspaceBinary`/`whichBin`(win 分支);对抗用例:路径含空格/单引号/`$()`/反引号/`%`、末行无换行、空 crontab、dow=7、month 定值。
- 手动矩阵:每平台 `build → init → doctor → filehub init --register → inbox status → cron add/install/run`;**Windows 登录态/登出态两步**;**linux 无 cron 服务** 用例。
- **doctor-on-linux/win 断言表**(M6):每种 warning 类别的期望断言,供 CI 解锁后判通过。
- **CI 冒烟占位**(M6):build.yml 追加 cron add→install→status→uninstall(注释 `if: false`,解锁即启用)。

## 兼容与迁移

- 未分发;cron.json 声明平台无关;各平台调度语义差异(补跑/仅登录)文档明示。
- 多工作台:块标记/任务名带工作台身份,install/uninstall/doctor 只操作自己命名空间。

## 取舍

- **`--dir` 而非 `cmd /c cd /d`**:三后端统一显式传 root,彻底摆脱调度器 cwd 依赖(H1 专家优选)。
- **单引号引用 + % 转义**:恢复 argv 级注入保证到 crontab shell 行(H2)。
- **`replaceManagedBlock` 纯函数**:块替换逻辑无真机也可验证(H3)。
- **win `taskkill /T /F` + .cmd shell**:win 进程树终止与 shim 兼容(H4)。
- **DAILY/WEEKLY 子集 + 前置校验**:win 只装能表达的,其余早报错(H5)。
- **验证分层**:macOS 实测 + 纯函数 + 手动矩阵 + CI 断言表;真机留待 CI 解锁。

## 操作与回滚

- install/uninstall 均本地系统调度操作,可逆;crontab 写回前备份。
- 回滚 = 还原 cron.ts diff + gen-assets + 对应平台 uninstall。
