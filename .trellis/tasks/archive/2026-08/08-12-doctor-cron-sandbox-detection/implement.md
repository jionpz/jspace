# Implement — doctor 在沙盒/namespace 隔离下误报 cron 状态(issue #10)

## 实现清单(有序)

1. **类型**(adapters/scheduler/types.ts):新增
   `SchedulerHealth = "ok" | "stopped" | "missing" | "unverifiable"` 与
   `LinuxCronHealth = { crontab: SchedulerHealth; service: SchedulerHealth }`。
2. **NSpid 隔离解析纯函数**(adapters/scheduler/linux.ts):`pidNamespaceIsolated(procStatus: string): boolean`,
   解析 `NSpid:` 行,值数 ≥2 → true。无解析/缺字段 → false(保守:不算隔离)。
3. **health() 重写**(adapters/scheduler/linux.ts:260-264):
   - 读 procStatus(默认 `/proc/self/status`,注入 seam `linuxAdapter.readProcStatus?`)。
   - service 链:pgrep ok → "ok";pgrep fail + isolated → "unverifiable";否则 → "stopped"。
   - crontab 链:无 crontab 命令 → "unverifiable";`-l` status 0 → "ok";status 1 → isolated ? "unverifiable" : "missing";其他 → "unverifiable"。
   - spawn seam:`linuxAdapter.spawn?`(仿现有 `io?`),默认 `schedulerSpawn`。
4. **doctor 消费三态**(application/diagnostics/doctor.ts:642-675 `checkCrons`):
   - `service === "stopped"` → 保留 warning `cron.daemon_stopped`(文案逐字不变)。
   - `service === "unverifiable"` → 新增 info `cron.daemon_unverifiable`(文案含 sandbox/namespace 提示 + 去宿主确认)。
   - `crontab === "missing"` → 保留 warning `cron.crontab_missing`(文案逐字不变)。
   - `crontab === "unverifiable"` → 新增 info `cron.crontab_unverifiable`,并**跳过** not_installed/stale_task 比对。
   - installed 比对仅 `crontab === "ok"` 时执行。
5. **注入 fallback 同步**(cli/commands/helpers.ts:75):fallback 从 `{crontab:false,service:false}`
   改为 `{crontab:"missing",service:"stopped"}`(保持「无法确定时从严」语义)。
6. **doctor.test.ts**:stub 的 `linuxCronHealth` 4 处硬编码改为三态 `{crontab:"ok",service:"ok"}`;
   新增用例:
   - `service:"unverifiable"` → 无 `cron.daemon_stopped`,有 `cron.daemon_unverifiable`(info),exitCode 0。
   - `crontab:"unverifiable"` + enabled cron → 无 `cron.crontab_missing` / `cron.not_installed`,有 info。
   - `service:"stopped"` + `crontab:"missing"` → 仍报两个 warning(回归保护)。
7. **scheduler.test.ts**:新增 health() 用例(注入 spawn + readProcStatus fake):
   - pgrep ok → service "ok"。
   - pgrep fail + NSpid 隔离 → service "unverifiable"。
   - pgrep fail + 无隔离 → service "stopped"。
   - crontab status 0/1(隔离与不隔离)/其他 status → 各状态。
   - `pidNamespaceIsolated` 纯函数:单值/多值/缺字段。

## 验证命令

```bash
bun test adapters/scheduler/scheduler.test.ts        # health 新用例
bun test application/diagnostics/doctor.test.ts      # 三态消费用例
bun test                                            # 全量回归
bunx tsc --noEmit                                   # 类型门禁
bun run scripts/gen-assets.ts && git diff --exit-code -- cli/ # 资产新鲜度(预期无 diff)
git diff application/diagnostics/doctor.ts | grep -c "cron daemon not running"  # 文案保留
```

## 风险点 / 回滚

- **verify.yml:69-70 drift guard**:grep warning 文案 —— 文案必须逐字保留,否则 CI 红;若确需改文案,
  必须同步改 verify.yml(本设计不改文案)。
- **接口变更影响面**:`linuxCronHealth` 三态化波及 doctor.ts / helpers.ts / doctor.test.ts / scheduler.test.ts,
  逐一编译确认(tsc 兜底)。
- **回滚**:三态回布尔(health 返回 ok 判断)即回退;新诊断码纯新增,删除即回滚;无 schema 变更。

## 验收复查门

- 实现后逐条过 prd.md 的 Acceptance Criteria。
- doctor 的「只读不变式」不被破坏(不新增 throw 路径;readCrontab 的 fail() 分支仍走原有兜底)。
- 沙盒实测(WSL2 + Codex sandbox)若环境可用,跑 `jspace doctor` 确认无 cron warning 误报。
