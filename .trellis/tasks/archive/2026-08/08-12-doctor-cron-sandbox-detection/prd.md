# doctor 在沙盒/namespace 隔离下误报 cron 状态(issue #10)

## Goal

修复 `jspace doctor` 在 PID namespace / UID 隔离环境(Codex sandbox、容器)下对 Linux cron 的误报:宿主 cron daemon 正常运行、crontab 已装好,doctor 却报 `cron.daemon_stopped` 和 `cron.not_installed`。核心语义:doctor 应区分「确认故障」与「当前环境无法验证」,后者不得按 warning 上报。

## Confirmed Facts(代码证据,2026-08-12)

- **Daemon 检测单层**:`adapters/scheduler/linux.ts:260-264` `health()` 的 service 仅用
  `pgrep -x crond || pgrep -x cron` 一个命令;PID namespace 隔离下看不到宿主进程 → `service:false`。
  crontab 检测仅 `command -v crontab`(二进制存在即 true)。
- **crontab 读取语义**:`linux.ts:150-157` `readCrontab()` — `crontab -l` status 0→内容;
  status 1→返回 `""`(视为"无 crontab");其他 status→`fail()` 抛错。
  在 UID 隔离下 `crontab -l` 按当前 UID 查 spool,看不到宿主条目 → status 1 → 空 → 误判"未安装"。
- **已装条目判定**:`cli/scheduler.ts:32-38` `installedCronIdsForRoot` → `linux.ts:215-224` `inspect()`
  → `parseManagedLine`(tag 过滤)。marker 缺失返回 `[]`。
- **doctor 判定**:`application/diagnostics/doctor.ts:642-675` `checkCrons` —
  `!health.crontab` → `cron.crontab_missing` warning;`!health.service` → `cron.daemon_stopped` warning;
  `enabled && !installedIds.has(id)` → `cron.not_installed` warning。无环境可验证性判断。
- **注入面**:`cli/commands/helpers.ts:75` `linuxCronHealth` 注入 `schedulerAdapter().health(schedulerEnv())`。
- **测试现状**:`doctor.test.ts` 中 `linuxCronHealth` 为 stub 硬编码 `{crontab:true,service:true}`,
  无 health 失败分支测试;`scheduler.test.ts` 无 health() 直接测试。
- **无现成沙盒检测设施**:仓库内无 sandbox/namespace/container/PssIDs/D-Bus 检测代码。

## Requirements

- R1: Linux cron daemon 检测从单层 pgrep 升级为多层手段;多手段一致确认未运行才报 warning,
  「无法验证」(进程不可见 / D-Bus 失败 / PID namespace 隔离)降级为 info 或 skip。
- R2: crontab 已装条目检测区分三种状态:正常读到内容(status 0)→ 正常比对;
  确定无 crontab(status 1)→ 按环境语义处理(真实环境 warning / 隔离环境降级);
  无法验证(其他 status / 命令不可用)→ 不误报 warning。
- R3: doctor 的 cron 诊断在「当前环境无法验证调度器」时不得报 `cron.daemon_stopped` / `cron.crontab_missing` /
  `cron.not_installed` warning;应以 info/skip 说明原因。
- R4: 真实环境行为不变:确认未运行时仍报 warning;真没装 crontab 时仍报 warning。
- R5: 新增测试覆盖隔离环境与真实环境两种判定路径(daemon 多层检测、crontab 状态分级)。

## Acceptance Criteria

- [ ] 在注入的"PID 隔离 + crontab status 1"场景下,doctor 不再报上述 3 类 cron warning(降级 info/skip)。
- [ ] 在注入的"确认未运行 + 无 crontab"场景下,doctor 仍报 warning(回归不破坏)。
- [ ] 多层 daemon 检测:任一手段可用且能确认运行 → service ok;全部手段失败且环境不可验证 → info,非 warning。
- [ ] `crontab -l` 退出码分级处理,status 1(无 crontab)不再与"无法验证"混为一谈。
- [ ] 现有 doctor / scheduler 测试全部通过;新增测试覆盖上述判定路径。

## Out of Scope

- 不改 Windows(schtasks)调度器路径。
- 不实现完整的容器/沙盒指纹检测库,只做 doctor 需要的最小可验证性判断。
- 不改 crontab 的安装/卸载写路径(applyBatch/uninstallAll 语义不变)。
- 不处理 cron 运行期(failures/incidents)相关诊断。

## Key Decisions

- **无法验证 → info(用户批准 2026-08-12)**:沙盒 / PID 隔离 / D-Bus 不可达时,cron 相关诊断降级为 info
  (如 `cron.unverifiable`,文案指引去宿主确认),不报 `cron.daemon_stopped` / `cron.crontab_missing` /
  `cron.not_installed` warning。info 不参与 exitCode 失败判定(与现有 `cron.inline_prompt_legacy` 等先例一致)。
- **范围 Linux-only**:不改 Windows / macOS 调度器路径。
- **crontab status 1 分级**:不做 issue 建议 3 的原文(「退出码非 0 才 warning」会掩盖真实无 crontab 场景),
  而是按「真实环境 status 1 → warning(真没装)/ 隔离环境 status 1 → info(看不到宿主条目)」分级。
