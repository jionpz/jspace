# Design — doctor 在沙盒/namespace 隔离下误报 cron 状态(issue #10)

## 问题本质

`jspace doctor` 把「调度器检测手段失败」直接等同于「调度器故障」,而检测手段本身在 PID namespace /
UID 隔离环境(bwrap --unshare-pid 沙盒、容器)下会失败。修复的核心不是「增加检测手段」,而是给
doctor 引入**可验证性(verifiability)**维度:区分「确认故障」「确认正常」「无法验证」三种状态,
只有前者才按 warning 上报,「无法验证」按 info 提示。

## 架构与边界

改动跨 4 层,但边界清晰:

```
adapters/scheduler/linux.ts   health() 返回三态 + 环境隔离信号(可测 seam)
adapters/scheduler/types.ts   三态类型定义
cli/commands/helpers.ts       注入面 fallback 同步
application/diagnostics/doctor.ts  消费三态,unverifiable → info
```

- **scheduler 层负责「事实」**:调度器到底什么状态,只有它知道(pgrep、crontab、/proc)。
- **doctor 层负责「严重度」**:状态 → warning/info 的映射。
- 不改 crontab 写路径(applyBatch/uninstallAll)、不改 Windows 路径。

## 三态模型

```ts
// adapters/scheduler/types.ts
export type SchedulerHealth = "ok" | "stopped" | "missing" | "unverifiable";
export interface LinuxCronHealth {
  crontab: "ok" | "missing" | "unverifiable";
  service: "ok" | "stopped" | "unverifiable";
}
```

语义:
- `service.ok` = 确认 daemon 运行(无诊断)
- `service.stopped` = 确认 daemon 未运行(可验证环境下的确定结论 → warning)
- `service.unverifiable` = 手段失败且环境可疑(→ info)
- `crontab.ok` = `crontab -l` status 0,可正常比对 installed 条目
- `crontab.missing` = `crontab -l` status 1 且环境可验证 = 确定无 crontab(→ warning + not_installed)
- `crontab.unverifiable` = status 1 但环境隔离 / 或命令失败 = 看不到宿主条目(→ info,跳过 installed 比对)

## 环境隔离信号

主信号:**PID namespace 嵌套层级**(标准信号,无副作用,只读 `/proc/self/status`):

```ts
// /proc/self/status 里的 NSpid 字段;≥2 个值 = 处于嵌套 PID namespace(看不到宿主进程)
NSpid:\t42 205
```

- 正常 Linux 环境(含 CI runner、WSL2 宿主、普通容器壳内):`NSpid:` 1 个值。
- bwrap `--unshare-pid` 沙盒:≥2 个值(当前 namespace PID + 外层宿主 PID)。

提取为纯函数 `pidNamespaceIsolated(procStatus: string): boolean`,从 `/proc/self/status` 文本解析
`NSpid:` 行,值数 ≥2 → true。proc 读取路径可注入(测试用 fake 文本)。

**不用**的信号及原因:
- `systemctl`/D-Bus:沙盒内同样失败(issue 已观测),且非 systemd 环境不可用,无法区分「服务停了」与「查不到」。
- `PssIDs`:issue 笔误,正确字段是 `NSpid`。
- `/var/run/crond.pid`:做补充信号,优先级低于 NSpid;systemd 管 cron 时可能无此文件,不依赖它。

## health() 检测链(linux.ts)

```ts
health(_env): LinuxCronHealth {
  const procStatus = readProcStatus();                 // 可注入,默认读 /proc/self/status
  const isolated = pidNamespaceIsolated(procStatus);

  // service:pgrep 优先;失败时区分「隔离」与「确停」
  const s = spawn("sh", ["-c", "pgrep -x crond ... || pgrep -x cron ..."]);
  let service: SchedulerHealth = s.status === 0 ? "ok"
    : isolated ? "unverifiable"
    : "stopped";

  // crontab:status 分级
  const c = spawn("sh", ["-c", "command -v crontab"]);
  const crontabBin = (c.stdout ?? "").trim() !== "";
  let crontab: SchedulerHealth = "missing";              // 命令不可用 → 确证无法安装(确证故障)
  if (crontabBin) {
    const r = spawn("crontab", ["-l"]);
    crontab = r.status === 0 ? "ok"
      : r.status === 1 ? (isolated ? "unverifiable" : "missing")
      : "unverifiable";
  }
  return { crontab, service };
}
```

> 实现修正(2026-08-12):「crontab 命令不存在」从初稿的 `unverifiable` 改为 `missing` —— 它是确证故障
> (jspace 无法安装),必须保留原 `cron.crontab_missing` warning,不能降级为 info。
> installed 比对语义随之:ok → 读真实 installed;missing → 视为空且可比(确认无 crontab 时
> enabled cron 确实没装,仍报 not_installed);仅 unverifiable 跳过比对。

- **可测 seam**:`linuxAdapter` 增加 `spawn?: SchedulerSpawn`(仿现有 `io?` seam),
  `readProcStatus?: () => string`。测试注入 fake 覆盖各分支。

## doctor 判定(checkCrons,doctor.ts)

```ts
const health = cron.linuxCronHealth();
if (process.platform === "linux") {
  if (health.service === "stopped")
    diags.push(warning cron.daemon_stopped, 文案不变);          // 保留原文案
  else if (health.service === "unverifiable")
    diags.push(info cron.daemon_unverifiable,
      "cron daemon status cannot be verified in this environment (sandbox/namespace isolation); check on the host");
  if (health.crontab === "missing")
    diags.push(warning cron.crontab_missing, 文案不变);          // 保留原文案
  else if (health.crontab === "unverifiable")
    diags.push(info cron.crontab_unverifiable, ...);
}
// installed 比对:ok → 读真实 installed;missing → 视为空且可比(确认无 crontab → enabled 未装是真诊断);
// 仅 unverifiable 跳过比对(installedIds 读不到 ≠ 没装)。非-linux 平台保持读自己的调度器。
let installedCheckable = true;
if (process.platform === "linux") {
  ...health 三态 → warning/info...
  installedCheckable = health.crontab !== "unverifiable";
  installedIds = health.crontab === "ok" ? new Set(cron.installedCronIds(root)) : new Set<string>();
}
if (crons.length > 0 && installedCheckable) {
  ...现有 not_installed / stale_task 循环...
}
```

严重度汇总对比:

| 场景 | 现在 | 修复后 |
|---|---|---|
| 真实环境,daemon 真停 | warning `daemon_stopped` | warning `daemon_stopped`(不变) |
| 真实环境,真无 crontab | warning `crontab_missing` + not_installed | 同(不变) |
| 沙盒隔离,daemon 看不到 | warning `daemon_stopped`(误报) | info `daemon_unverifiable` |
| 沙盒隔离,crontab 条目看不到 | warning not_installed ×3(误报) | info `crontab_unverifiable`(1 条) |
| 正常沙盒,pgrep 看得到 | service ok(无诊断) | 无诊断(不变) |

## 兼容性

- **接口变更**:`linuxCronHealth` 返回类型 `{crontab:boolean;service:boolean}` → 三态。
  调用点:helpers.ts:75(注入)、doctor.ts:643-668(消费)、doctor.test.ts stub(4 处硬编码 `{crontab:true,service:true}`)、
  scheduler.test.ts(若有)。逐一同步。
- **CI**:verify.yml:69-70 只 grep warning 文案,文案保留 → 不红。ubuntu runner 无隔离信号,
  无 cron daemon → 走 "stopped" → 仍报 warning → 不红(exitCode 仅 error 决定)。行为不变。
- **文案**:`cron.daemon_stopped` / `cron.crontab_missing` / `cron.not_installed` 文案逐字保留。

## 回滚

- 三态回布尔:health() 返回值改为 `{ok, ...}` 判断即可回退,无数据迁移。
- 新诊断码 `cron.daemon_unverifiable` / `cron.crontab_unverifiable` 为纯新增,删除即回滚。
- 不改任何持久化格式(no schema change)。

## 验证

- 单元测试:scheduler.test.ts(health 各分支)、doctor.test.ts(三态消费、unverifiable→info、回归)。
- `bun run scripts/gen-assets.ts && git diff --exit-code`(不动生成资产,但按仓库规则验证)。
- `bunx tsc --noEmit`、`bun test`。
- 端到端:本机 macOS 走不到 linux 分支 → 靠单测覆盖 + CI(ubuntu runner)回归。
- 沙盒实测:修复后可在 WSL2 + Codex sandbox 里跑 `jspace doctor` 复现 issue 场景确认(若环境可用)。
