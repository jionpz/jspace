# B: GOAL#5 平台调度残余闭合

## Background

GOAL.md 开放问题 **#5（Linux/Windows 真机调度复核）** 已于 2026-08-26 **部分关闭**：

- **已关闭**：调度 CRUD（CI cron 冒烟：Linux crontab / Windows schtasks 全链 + doctor 非降级侧；Linux 本机按 CI 脚本复核）；AVX-less 按替代关闭条件关闭。
- **仍开放（本任务）**：① 真实触发；② Linux「错过即跳过」；③ Windows 登出边界；④ 沙盒 / PID+UID namespace 降级。

权威源（冲突时以此序）：`GOAL.md` #5 → `docs/PLATFORMS.md`「真机验证台账」+ 调度语义表 → `adapters/scheduler/{linux,win32,darwin}.ts` + `scheduler.test.ts` → `.github/workflows/build.yml` Cron CRUD smoke。

父任务约束（`08-27-febel-post-m6-roadmap`）：允许「替代关闭条件」写入 GOAL/PLATFORMS，但必须**显式标注效力边界**；**禁止用 CI 假触发冒充真实触发**。

## Goal

把 #5 四条残余各自落到可验收的关闭路径：能工程交付的用文档/单测/合同断言关闭；必须真机的写可复跑协议并回写台账；短期无真机时允许替代关闭，但效力边界写进台账与 GOAL。

## Closing Taxonomy（每条必标）

| 类型 | 含义 | 可否单独关闭该条 |
|---|---|---|
| **E — 工程交付** | 文档协议、合同单测、代码审计、CI 已有 CRUD/非降级断言的加固 | 可；不声称「真机已观察」 |
| **H — 必须真机** | 等到钟点被 crond/schtasks 拉起、登出会话、真实嵌套 namespace | 真机证据回写台账后关闭 |
| **A — 替代关闭** | 无真机时的显式替代；**效力弱于 H**，台账标「替代关闭」+ 边界句 | 可关闭 GOAL 条目，但须保留「真机复核待…」脚注 |

**红线**：`build.yml` Cron CRUD smoke / `jspace cron run` 手动调用 / `schtasks /Run` **均不得**在台账或 GOAL 中写成「真实触发已验证」。CRUD ≠ fire；CLI 直跑 ≠ 调度器拉起。

---

## Requirements

### R0 — 台账与 GOAL 回写纪律

1. 四条每条在 `docs/PLATFORMS.md`「真机验证台账」有独立行（或拆行）：状态 ∈ `{未验证, 工程已闭合, 真机已验证, 替代关闭}` + 日期 + 证据指针。
2. 本任务完成时更新 `GOAL.md` #5：逐条写清关闭方式（E/H/A）与效力边界；不得把 CI CRUD 说成触发闭合。
3. 不改业务调度语义（不引入 anacron / StartWhenAvailable / 登出仍跑）；本任务以**证实与诚实文档**为主，非改行为。

### R1 — ① 真实触发（crond / schtasks）

**产品声明**：真实触发 = 系统调度器在约定时刻（或等价「下一分钟」临时 schedule）自行拉起 `jspace cron run …`，并在 `.jspace/state/runs/` 与 `.jspace/logs/cron/` 留下 run 证据。macOS launchd 自然触发已在 #3 闭合；本条仅 Linux + Windows。

| 交付 | 类型 | 内容 |
|---|---|---|
| 真机触发协议 | E | 在 PLATFORMS 增「真实触发 runbook」：临时 cron（如下一分钟 `M H * * *`）、`cron enable` + `install`、等待 ≥1 个槽、断言 `cron status` / runs 目录出现新 run；清理 uninstall。Windows 同构用 DAILY `/st` 设近时点（注意 schtasks 分钟粒度与登录态）。 |
| 证据模板 | E | 台账证据字段：日期、平台、cron id、schedule、run-id 或日志路径、`crontab -l` / `schtasks /query` 摘录。 |
| Linux/Windows 各至少一次钟点拉起 | H | 按 runbook 执行并回写台账。 |
| 替代关闭（仅当短期无 Win/Linux 真机） | A | 文档声明：CRUD CI 已证明「任务已注册且 argv 正确」；触发依赖 OS 调度器固有行为 + macOS #3 同类观察先例。**边界**：未证明 Linux crond / Windows Task Scheduler 对本机 PATH/烘焙 env/`/it` 令牌下的 jspace 二进制能成功 spawn；不得写「触发已验证」。GOAL 标「触发：替代挂账，真机待使用」。 |

**明确排除**：

- CI runner 上「等到某分钟」或解析 cron 日志冒充触发（hosted 时机不可信，见 build.yml 注释）。
- `jspace cron run <id>`（人工/脚本直跑）≠ 真实触发。
- `schtasks /Run /tn …`：经 Task Scheduler 但**非钟点触发**；最多记为「调度器可执行入口冒烟」，**不能**关闭「真实触发」台账行。

### R2 — ② Linux「错过即跳过」无补跑语义

**产品声明**（已有）：用户 crontab / 常规 crond **无补跑**；jspace **不**叠加 anacron / 自研 catch-up。与 macOS launchd「唤醒补一次」差异已在 PLATFORMS 诚实声明。

| 交付 | 类型 | 内容 |
|---|---|---|
| 合同审计 | E | 审计 `adapters/scheduler/linux.ts`：install 只写标准 crontab 行，无 anacron、无 `@reboot` 补跑包装、无「missed run」扫描。结论写入 PLATFORMS 台账证据列或短节「补跑语义合同」。 |
| 文档硬化 | E | PLATFORMS 明示：错过槽位 → **不**产生 run 记录；用户不得把「关机错过」当 bug。与 doctor/incident 文案无「将补跑」暗示。 |
| 真机错过实验 | H | 协议：install 近时点 cron → 在槽位前停 cron 守护或 sleep/关机跨过槽 → 恢复后确认该槽**无**新 run；下一槽可正常触发（可选）。 |
| 替代关闭 | A | 以 **E 合同审计 + 文档** 关闭语义条目：行为是 Vixie/cronie 用户 crontab 的平台固有语义，非 jspace 实现分支。**边界**：未在目标发行版上观察「停 daemon / 跨槽」；若某环境用 systemd timer 替代 crontab，不在本 MVP 合同内。 |

### R3 — ③ Windows 登出边界

**产品声明**（已有）：默认仅登录运行；登出不触发；`/it` 交互令牌；**文档明示非 bug**。

| 交付 | 类型 | 内容 |
|---|---|---|
| 创建参数合同 | E | 确认 `schtasksArgs` **始终**含 `/it`，且不传「无论是否登录都运行」类开关；现有单测已含 `/it`——若缺口则补「禁止无 `/it` 的 create argv」断言。 |
| 文档/runbook | E | PLATFORMS「Windows 额外两步」升级为可勾选协议：登录态 query 存在 →（可选）钟点或明确标注的非关闭性 `/Run` → **登出后**该槽不应新增 run。 |
| 登出观察 | H | 真机：已 install 的任务在用户登出期间到达 `/st`，确认无新 run；重新登录后行为符合「仅登录时」。 |
| 替代关闭 | A | 以 **E：`/it` 合同单测 + 文档产品边界** 关闭。**边界**：未观察真实登出；依赖 Microsoft Task Scheduler「仅当用户登录时」默认语义。不得把 CI schtasks CRUD 写成登出已验证。 |

### R4 — ④ 沙盒 / PID+UID namespace 降级

**产品声明**（issue #10 / 已实现）：嵌套 PID namespace（`NSpid:` ≥2 值）下 doctor 将 `cron.daemon_unverifiable` / `cron.crontab_unverifiable` 降为 **info**，不报 warning；真机非隔离宿主绝不能出现 `*_unverifiable`（CI 已断言非降级侧）。

| 交付 | 类型 | 内容 |
|---|---|---|
| 单测维持/缺口补齐 | E | `pidNamespaceIsolated` + `health()` 三态（ok / stopped / unverifiable）与 missing-cmd 分支保持绿；若 doctor 映射层缺「info 非 warning」断言则补 application 层单测。 |
| 非降级侧 | E | 保持 `build.yml` / verify 对真实宿主「不得出现 `*_unverifiable`」——**这是 E，不是沙盒真机**。 |
| WSL2 + Codex sandbox（或 `bwrap --unshare-pid`） | H | 建议路径（台账已写）：在嵌套 namespace内跑 `jspace doctor`，期望 info 降级、无 cron warning 误报；宿主上再跑确认非降级。 |
| 替代关闭 | A | **单测覆盖降级逻辑 + CI 覆盖非降级侧** 作为替代关闭（对标 AVX-less 模式）。**边界**：未在真实 Codex/`bwrap` 嵌套 namespace观察；GH runner 禁止非特权 user namespace、本仓库开发环境 `NSpid:` 单值——两边都构造不出。真机复核待 WSL2+Codex。 |

---

## Acceptance Criteria

### 横切

- [ ] AC0.1 四条在 PLATFORMS 台账均有终态（真机已验证 **或** 替代关闭含效力边界句）；无「用 CRUD smoke 冒充触发」表述。
- [ ] AC0.2 `GOAL.md` #5 更新为四条逐条关闭结论（或显式「替代挂账」），与台账一致。
- [ ] AC0.3 本任务若改代码：仅限文档、单测合同、文案澄清；**不**改变补跑/登录语义。`bunx tsc --noEmit` + `bun test` 绿；改 templates/skills/capabilities 则 gen-assets + 三 check。

### ① 真实触发

- [ ] AC1.1（E）PLATFORMS 有可复跑「真实触发 runbook」+ 证据模板；明文排除 `cron run` / CI 等到 / 单独用 `/Run` 关闭。
- [ ] AC1.2（H 或 A）Linux 与 Windows 台账行终态为「真机已验证」**或**「替代关闭」+ 边界（CRUD≠fire）。

### ② 错过即跳过

- [ ] AC2.1（E）linux adapter 合同审计结论已文档化；无 jspace 侧补跑实现。
- [ ] AC2.2（H 或 A）台账「补跑语义」行终态为真机错过实验 **或** 替代关闭（平台固有语义 + 审计）。

### ③ Windows 登出

- [ ] AC3.1（E）`/it` 合同有单测锁定；PLATFORMS 登出协议可勾选。
- [ ] AC3.2（H 或 A）登出台账行终态为真机观察 **或** 替代关闭（`/it` + OS 默认登录态）。

### ④ 沙盒 namespace

- [ ] AC4.1（E）降级单测 + 非降级 CI 断言仍成立；缺口已补。
- [ ] AC4.2（H 或 A）沙盒台账行终态为 WSL2+Codex（或等价 bwrap）观察 **或** 替代关闭（单测降级 + CI 非降级），边界句保留。

## Non-Goals

- 不统一三平台补跑语义（不在 Linux/Win 上模拟 launchd 补跑）。
- 不改为「登出仍运行」或 SYSTEM 账户任务。
- 不在 CI 增加「真实触发」作业。
- 不把 `schtasks /Run` 或 `jspace cron run` 记为钟点真实触发。
- 不解决 AVX-less / `/tr` 超长等台账其它未验证行（除非顺手文档一句指针）；本任务范围仅 #5 四条残余。
- 不 `task.py start`（本文件为规划交付）；不改业务代码于本规划回合。

## Key Decisions

1. **CRUD 与 fire 严格分家**：CI 只证明注册/读回/卸载；fire 只认调度器钟点拉起 + runs/logs 证据。
2. **替代关闭允许，但必须弱于真机**：格式对标 AVX-less 台账行——护栏/合同 +「真机复核待…」。
3. **语义条（②③）优先合同关闭**：属 OS 固有行为 + jspace 有意不封装；工程审计/单测即可 A 关闭，H 为增强证据非阻塞（若选择 A，GOAL 须写明）。
4. **① 与 ④**：① 强烈偏好 H（无真机则 A 挂账，不假绿）；④ 已有单测+CI 非降级，A 与 AVX-less 同级可接受，H 建议 WSL2+Codex。
5. **建议实施序**：先 E（runbook、审计、`/it` 单测、台账模板）→ 有机器则 H → 否则对 ②③④ 用 A、对 ① 显式替代挂账 → 回写 GOAL。

## Disposition Summary（规划结论）

| # | 残余 | 建议处置 | 主关闭类型 | 效力边界一句话 |
|---|---|---|---|---|
| ① | 真实触发 | 写 runbook；真机钟点拉起优先；禁 CI/`cron run`/`/Run` 冒充；无机器则 A 挂账 | H 优先 / A 可挂 | A 只证明「已注册」，不证明「会被拉起并跑完」 |
| ② | Linux 错过跳过 | 合同审计 + 文档；可选真机跨槽；默认可 A | E+A（H 增强） | 合同基于用户 crontab 固有语义，非全发行版实测 |
| ③ | Windows 登出 | 锁 `/it` 单测 + 文档；登出观察可选；默认可 A | E+A（H 增强） | 未登出观察时依赖 Task Scheduler 登录态默认行为 |
| ④ | 沙盒 namespace | 单测+CI 非降级作 A；H=WSL2+Codex | E+A（H 建议） | 降级路径无真实嵌套 namespace观察 |

## Notes

- 相关已归档：`archive/.../08-12-doctor-cron-sandbox-detection`（降级实现）；#23 win32 读回；CI dispatch 32969257020 / 32971530049。
- 实施前读：`.trellis/spec/` 中 adapters / docs 相关 checklist；改 PLATFORMS/GOAL 属文档交付，仍需与台账术语一致。
- 若实施时协议过长，可再拆 `design.md`（runbook 细节）——非本规划回合必做。
