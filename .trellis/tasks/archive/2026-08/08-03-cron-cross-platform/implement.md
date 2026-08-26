# 跨平台 cron 后端 — 执行计划(修订版,吸收 H1-H5 + M1-M6)

## 实施清单(顺序)

1. **平台基础设施**:`cli/cron.ts` 加 `platform` 检测;`jspaceBinary(plat?)` 纯函数(win 存在性探测 `.exe`,可注入 platform);`whichBin()`(which/where)。
2. **纯函数(本机可单测)**:
   - `shq(s)`:POSIX 单引号引用(含 `'` 转义);
   - `crontabBlock(crons, root, jspaceBin, path, home)`:注释块 + 每行 `shq` 引用 + `%` 转义 + env + `--dir` + 日志重定向;超 1000 字符报错;
   - `replaceManagedBlock(existing, block)`:删旧块/保留非 jspace 行/追加新块/空输入/冲突检测;
   - `schtasksArgs(cron, jspaceBin, root, taskName)`:DAILY/WEEKLY 映射、dow 0/7→SUN 归一、month/dom 定值→null;
   - `isWindowsInstallable(schedule)`:前置校验。
3. **`cmdCronRun` 加 `--dir <root>`**(cwd 显式 root,无 --dir 回退 cwd);win32 分支:`taskkill /pid /T /F` 超时杀树、`.cmd`/`.exe` harness 用 `shell:true`、PATH `;` 兜底。
4. **`cmdCronInstall/Uninstall` 平台分发**:
   - darwin:现有 launchd(plutil 仅 darwin);
   - linux:`crontab -l` status 分支(exit1=空、尾换行补)、写回前备份+校验、空表 `crontab -r`、`replaceManagedBlock`;
   - win32:任务名 `JSpaceCron_<wb-id>_<id>`、`/it`、`--dir`、schtasksArgs(同 id 冲突报错);`isWindowsInstallable` fail-fast。
5. **`cmdDoctor` 平台适配**:去 `installedIds.size>0` 门闩;平台分发 installed 检测;linux crontab/cron 服务存在性检查。
6. **纯函数单测**(`bun test cli/cron.test.ts` 或临时脚本):crontabBlock/replaceManagedBlock/schtasksArgs/isWindowsInstallable/jspaceBinary/whichBin;对抗用例(空格/单引号/`$()`/`%` 路径、末行无换行、空 crontab、dow=7、month 定值、`--dir` 在 schtasks 参数中)。
7. **验证矩阵文档**:`docs/PLATFORMS.md`(三平台手动步骤 + win 登录/登出 + linux 无 cron 服务 + **doctor-on-linux/win 断言表**)。
8. **CI 冒烟占位**:build.yml 追加 cron add→install→status→uninstall(注释 `if: false`,解锁即启用,M6)。
9. **回归**:tsc/gen-assets/build;macOS 实测 install/uninstall/doctor/run --dry-run;`~/jspace-work` 不受影响。

## 校验命令

- `bunx tsc --noEmit`
- 纯函数单测:`bun test cli/cron.test.ts`(断言如上)
- macOS 实测:`cron install`(plist+launchctl)、`cron uninstall`、`doctor`、`cron run inbox-tidy --dry-run`
- linux/win 逻辑:纯函数单测断言(不依赖目标 OS)
- 回归:init/doctor/filehub/inbox 全命令面;build 编译产物

## 关键风险 / 回滚点

- **crontab 写回破坏用户条目**:`replaceManagedBlock` 保留非 jspace 行;写回前备份临时文件;空表 `crontab -r`。
- **schtasks /tr 引号**:`--dir`/任务名含空格 → 参数单测断言;`/it` 需交互令牌。
- **win harness shim**:`.cmd`/`.exe` 结尾用 shell 包裹。
- **cron run --dir**:三后端统一传,手工调用无 `--dir` 回退 cwd。
- **assets.generated.ts 手改会被覆盖**:改模板必须 gen-assets。
- 回滚:还原 cron.ts diff + gen-assets + 对应平台 uninstall。

## CI 解锁后通过标准(预写,M6)

- linux/win runner 上 `cron add inbox-tidy --schedule "0 21 * * *" ...` → `cron install` → `cron status`(never run)→ `cron uninstall` 全链 exit 0;doctor 无「enabled 但未安装」告警(断言表见 docs/PLATFORMS.md)。
