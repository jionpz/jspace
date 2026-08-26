# 全项目 8 维专家评审报告

> 任务：`08-05-project-review` · 基线 `cc7bb1e` · 2026-08-05
> 方法：8 名专家并行只读评审（发现）→ 6 名对抗性怀疑者验证（P0/P1 全量验证）→ 主循环综合
> 原始 findings：58 条（8 维）· 去重后独立问题 **~35** 个 · 全部 P0/P1（8 条）经对抗验证 **全部 CONFIRMED**，0 REFUTED
> 本轮只评审，未改任何代码（`git diff` 干净）

---

## 一、总结论

**总体健康，但存在一个贯穿性的高风险主题：cron 调度子系统处于「新旧两套实现并存的过渡态」**，而 Windows 的 `cron install` 已按构造性缺陷确认不可用，doctor 健康检查在 macOS/Windows 上会对已成功安装的 cron 永久误报。另有一处 P0 红线违反：公开仓库 GOAL.md 泄漏真实数据。

具体画像：

- **架构分层**清晰（core/contracts 纯 decoder → core/registry → adapters → application → cli），但有 1 处已确认的层环（adapters↔application），且 spec 描述已落后于代码。
- **原子写纪律**整体优秀（hub/local/marker/journal/envelope 均走 `writeBytesAtomic`），仅 2 处漏网：`cron.json`（用户数据）与 run/incident 记录。
- **测试**数量扎实（267/34 files），但覆盖面失衡：doctor、cron 管理用例、filehub 注册、darwin adapter 四大用户可见面**零覆盖**；34 个测试恰好没盖住最重的缺陷（win32 install、身份漂移）。
- **安全红线**整体干净（无密钥、无 `curl|bash` 执行路径、SHA-256 校验默认 HTTPS），但 GOAL.md/示例文件泄漏真实数据是 P0；`irm|iex`、JSPACE_BASE_URL 镜像自证等为 P3 卫生项。
- **发布/分发**：版本三处同步靠手工无校验、Windows release 二进制缺 baseline 变体。

---

## 二、红线专项（P0）

### 🔴 P0-CONFIRMED · GOAL.md 公开仓库泄漏真实个人/客户数据

- **位置**：`GOAL.md:87`
- **内容**：M4 验收记录写明「2 份真实资料经 asset-ingest 入库」「指针定位『30GB / 梯度公式』」
- **证据**：`GOAL.md:87` 原文；验证 agent 已核实：仓库 PUBLIC（`github.com/jionpz/jspace`，isPrivate=false），且 30GB / ∂L∂w 梯度公式确为用户真实私有资料（文件柜内《机器学习基础第二章笔记》《周报》），非虚构占位。
- **失败场景**：任何公开访问者可读到用户真实私有资料的具体数据点，且 git 历史无法事后撤回。
- **连带**：`skills/memory-recall/references/example-recall.md:40`（"30GB 存量"）复用同一真实数字，已嵌入 `cli/assets.generated.ts` 随二进制分发。
- **修复方向**：GOAL.md 与 example-recall.md 改为中性占位（如 12800 / 「12.8T」），措辞「2 份真实资料/真实验收」改「示例资料/示例验收」；改后重跑 `gen-assets` + grep 复扫。**涉及 git 历史，需用户决策是否改写历史或接受新 commit 后旧历史仍含数据。**
- **verdict**：`CONFIRMED`

---

## 三、P1 明细（重要缺陷 · 全部 CONFIRMED）

### P1-CONFIRMED · Windows `cron install` 构造性损坏 —— schtasks argv 往返丢失 `/tr` 命令
- **位置**：`cli/commands/registry.ts:375` ↔ `adapters/scheduler/win32.ts:35,63`
- **问题**：CLI 层把 schtasks 参数数组 `args.join(" ")` 成字符串作 `op.content`，win32 adapter 再 `op.content.split(" ")` 重建 argv。`/tr` 元素本身含空格（`"<bin>" cron run --dir "<root>" --id <id>`），split 将其拆碎成孤儿 token。
- **失败场景**：`jspace cron install` 在 Windows 上必然失败（schtasks 收到残缺 `/tr` + 无主选项报错，`fail()` 中断），或注册一个只跑裸二进制、不带 `cron run` 的任务。CI 只跑 dry-run、测试只断言 join 方向，故从未暴露。
- **修复方向**：`op.content` 不再走空格串——结构化传递 argv 数组（或 JSON 序列化），`win32.apply` 直接消费。
- **verdict**：`CONFIRMED`（4 名怀疑者独立确认 + 模拟复现：11 元素拆成 18 token）

### P1-CONFIRMED · doctor/安装提示与 tag-scoped 调度器身份漂移 —— macOS/Windows 永久误报
- **位置**：`cli/cron.ts:49-51,74-76,87-91`（legacy 无 tag 身份）vs `adapters/scheduler/types.ts:36-38`、`darwin.ts:12`、`win32.ts:11`（tag-scoped 写）；`doctor.ts:100-111` 消费 legacy 读取
- **问题**：新调度器写 `com.jspace.cron.<tag>.<id>.plist` / `JSpaceCron_<tag>_<id>`，doctor 的 `installedCronIds` 只剥 `com.jspace.cron.` 前缀 → 得到 `<tag>.<id>` 永不等同 cron id；win32 则用 `shortHash(root)` 与 `workbenchTag(uuid)` 不同值域。
- **失败场景**：macOS/Windows 上成功 `cron install` 后，`jspace doctor` 对每条已启用 cron 报「enabled but not installed」+ 假「stale scheduled task」（doctor 还是 `workspace upgrade` 的自动后置检查）；`cron add/remove` 的「再跑 install」提示永不触发。本机存在 3 个 legacy 无 tag plist → 重跑 install 会生成第二套 tag 化 agent（潜在双触发），且 `cron uninstall`（按 tag）无法删除 legacy plist。
- **修复方向**：doctor/提示统一走 tag-scoped adapter `inspect(workbenchTag(marker.workbench_id))` 三平台，删除 cli/cron.ts 中 legacy 身份读取；legacy plist 做一次性迁移/删除。
- **verdict**：`CONFIRMED`（3 名怀疑者独立确认）

### P1-CONFIRMED · adapters↔application 层环，违反已声明依赖方向
- **位置**：`adapters/scheduler/{types:8,linux:9,win32:6}.ts` 反向 import `application/automation/definitions.ts`（`ScheduleDict`/`parseSchedule`）；`application/automation/scheduler.ts:6` re-export `workbenchTag` from `adapters/scheduler/types.ts`
- **问题**：与 `.trellis/spec/backend/directory-structure.md:34` 声明（唯一反向边 = `adapters/harness/argv.ts → application/errors.ts`）冲突，形成双向依赖环。
- **失败场景**：把 `parseSchedule/ScheduleDict` 移出 definitions 或改签名即构建期断裂；adapters 不再是纯平台工具层，无法独立演进。
- **修复方向**：`ScheduleDict/parseSchedule` 下沉到 core/contracts（纯解码层）或迁入 adapters 自身，消除反向依赖；同步修正目录结构 spec。
- **verdict**：`CONFIRMED`

---

## 四、P2 明细（一般 · 未全部经对抗验证，主循环已抽查核心项）

> ✅ = 主循环已读源码核验；其余为专家证据 + 引用片段，未另行复核。

### 可靠性 / 数据一致性
1. ✅ **linux inspect tag 取错下标** `adapters/scheduler/linux.ts:93` `taskId.split(".")[2]` 恒等于 `"cron"` → 与 tag 永不等 → inspect 恒返回 `[]`。后果：每次 `cron install` 全量重写 crontab；**双工作台共享机器时第二台会整体替换第一台的 managed block，第一台 cron 静默失效**（tag 隔离机制从未生效）。修法：取 `[3]` 或剥前缀。
2. ✅ **cron.json 非原子写** `application/automation/definitions.ts:34` `writeFileSync` —— 全仓库唯一不原子的用户数据文件（其余全走 `writeBytesAtomic`）。崩溃/断电留截断 cron.json → 所有 cron 命令 + doctor 直接 fail，且无备份可恢复。修法：复用 `writeBytesAtomic`。
3. ✅ **failIngest 与 cleanup-pending 标记碰撞** `application/ingest/journal.ts:322,125-127,135-140` —— 失败发生在 `index` 步时 `failedStep=NEXT_STEP["index"]="committed"`，恰好等于 `isCleanupPending` 判定 → `ingest status` 谎报「cleanup pending」，`--complete` 会把源文件 unlink 并写终态 committed（实际 index.md 从未写入）。修法：`failedStep` 记在进步中的步本身，或排除该组合。
4. **linux apply 仅按非 delete ops 重建块** `cli/commands/registry.ts:389-395` —— delete-only 时 `enabled=[]` → `crontabBlock([])` 生成空标记块 → `replaceManagedBlock` 清空全部 cron 行（含仍启用的）。当前被 #1 的空 inspect 掩盖，修好 inspect 后即引爆。另：全禁用时 early-return 不清已装任务。
5. **run/incident 记录非原子写** `application/automation/runs.ts:31`、`incidents.ts:56` —— 截断文件被 reader 静默跳过 → 真实失败从 `cron failures`/doctor 消失。
6. **applyPending TOCTOU + 空页误判** `application/pending/apply.ts:42-43,79` —— get→put 非 CAS；空内容页被当作「已存在不同内容」→ envelope 终态 failed。
7. **cron 日志文件名秒级精度** `execute.ts:189` —— 同秒两次运行互相覆盖 human payload。

### 平台 / 依赖
8. **darwin adapter 读 `process.env.HOME` 而非注入 env.home** `adapters/scheduler/darwin.ts:12` —— 测试/agent 场景下 inspect/apply/uninstall 操作错误的 LaunchAgents 目录。
9. **core/registry 直接 import node:fs** `core/registry/effective.ts:4` —— 违反「core/* only」，默认 `existsSync` 使纯计算层依赖真实文件系统。
10. **build.yml Windows x64 用非 baseline（需 AVX）** `build.yml:29` vs `build-all.ts:25` —— release 从不包含兼容老 CPU 的 baseline 二进制，与「x64 uses -baseline」声明矛盾。

### 安全 / 文档
11. **`init --force` 静默覆盖碰撞文件** `application/workspace/init.ts:47-49` + `cli/embed.ts:100-102` —— 无「将覆盖 N 个文件」披露、无备份（对照 install.sh 有 `*.jspace-bak`）。指向已存在项目目录时 README/AGENTS/.gitignore 被模板覆盖。
12. **PLATFORMS.md 全面过时** `docs/PLATFORMS.md:9,10,39` —— plist 名写无 tag 旧式、crontab 标记缺 `DO NOT EDIT`、称 tag 注入「尚未落地」；与当前 adapters 矛盾。
13. **workbench README 漏 2 个 skill** `templates/workbench/README.md:15-16` —— init 实际拷 4 个 skill，README 只列 2 个（AGENTS.md 列了 4 个）。
14. **文档的刷新路径是死路** `templates/workbench/AGENTS.md:138` + `skills/jspace-bootstrap/SKILL.md` 教 `jspace init --force .`，但 init 对已有 marker 硬失败；正确路径是 `jspace workspace upgrade`（运行时已验证 exit 1）。
15. **example-recall.md 复用真实数字 30GB** `skills/memory-recall/references/example-recall.md:40` —— 违反中性占位纪律（同 P0 连带）。

### 测试质量
16. **零覆盖高危面**：`doctor.ts`（全健康检查）、`application/automation/use-cases.ts`（cron 管理用例）、`filehub.ts:101 filehubInit`（注册+补偿）、`adapters/scheduler/darwin.ts`（唯一无测试的平台后端）。
17. **handler 接线端到端几乎无测试** `cli/commands/registry.ts` —— 除 cron run/project add 外约 30 个 handler 未走 parse→handler 路径。
18. **spec 测试数陈旧** `quality-guidelines.md:38` 声称 218/30 files，实际 267/34。

---

## 五、P3 建议（分组简表）

| 组 | 项 | 位置 |
|---|---|---|
| 正确性/UX | main.ts 非 CliError 打裸堆栈（不包 `jspace: error:`） | `cli/main.ts:66-69` |
| | `todaySuccess()` 全文 grep "status: ok" → 输出含该串的失败运行被跳过 | `execute.ts:66-69` |
| | `out.join("")` 每 chunk O(n²) | `execute.ts:155-156` |
| | `cron run` 缺 id 退 1（应退 2） | `registry.ts:440` |
| | `cron status` 无 `--dir` | `registry.ts:462-470` |
| 安全卫生 | install.ps1 头部 `irm <url> \| iex` 一行式 | `install/install.ps1:7` |
| | JSPACE_BASE_URL 覆盖时 SHA-256 自证（checksums 同源） | `cli/update.ts:162,179,185` |
| | cron 日志明文存完整 prompt + 64KB 输出无脱敏 | `execute.ts:190-200` |
| 平台/依赖 | darwin `env.HOME`（P2 #8 同源，P3 余项） | — |
| | cli/registry.ts 与 cli/commands/registry.ts 同名异构 | `cli/registry.ts:1` |
| | 跨层重复 helper（isWithin/isFile/workbenchTag/linuxCronHealth） | helpers.ts / inspect.ts / fs.ts / paths.ts / cron.ts |
| | 版本三处手工同步无校验 | `package.json:3` + gen-version.ts |
| | install.sh `append_markblock` 依赖全局 `$line` 无转义 | `install/install.sh:74,220` |
| | README 用真实路径 `~/jspace-work` 作公开示例 | `README.md:36` |
| 测试 | assets-reachability 断言源码文本（测实现非行为） | `cli/assets-reachability.test.ts:108-111` |

---

## 六、每维覆盖与未验证项

| 维 | 专家 | 产出 | 验证 | 覆盖说明 / 未验证 |
|---|---|---|---|---|
| 1 架构 | architect | 9 | 3/3 CONFIRMED | 全层依赖、目录结构 spec、cron 编排归属；未跑依赖检查工具，靠 grep |
| 2 正确性 | typescript-reviewer | 6 | 1/1 CONFIRMED | journal/execute/main 全覆盖；win32 未真机跑 |
| 3 安全 | security-reviewer | 5 | 无 P0/P1 | 密钥/注入/网络出口/执行；未审计 gbrain MCP 侧 |
| 4 测试 | code-reviewer | 8 | 无 P0/P1 | 34 测试文件全读 + 未测模块清单；未跑覆盖率工具 |
| 5 数据一致性 | typescript-reviewer | 10 | 1/1 CONFIRMED | journal/envelope/migration/ownership 全读 |
| 6 跨平台 | general-purpose | 6 | 1/1 CONFIRMED | 三平台 adapter + CI；win32/darwin 未真机验证（结论基于构造性证据） |
| 7 CLI·UX·文档 | general-purpose | 8 | 1/1 CONFIRMED | 命令面/文档漂移；部分命令运行时验证过 |
| 8 发布分发 | typescript-reviewer | 6 | 1/1 CONFIRMED | gen-version/gen-assets/build/install 全读；未实际发布 |

**未真机验证**：win32 schtasks、darwin launchd、linux crontab 的真实 apply（结论均为构造性证据 + 模拟复现，建议修复后真机回归）。

---

## 七、修复优先级建议（分批 · 本轮未执行）

**第一批（立即，含红线，各 1-2 天级）**
1. 🔴 中性化 GOAL.md / example-recall.md（P0）→ 重跑 gen-assets + grep 复扫 → **用户确认是否改写 git 历史**
2. Win32 `cron install` 结构化 argv（P1，6 维共同命中，Windows 核心功能断）
3. doctor/提示统一走 tag-scoped inspect + legacy plist 迁移（P1，macOS/Windows 误报与双触发）

**第二批（近期，1 周内）**
4. linux inspect tag 取下标修复 + 恢复 no-op 检测（P2#1/#2，连带引爆 delete-only 地雷 P2#4 → 一并修）
5. cron.json 原子写（P2#2）；failIngest 标记碰撞（P2#3）
6. 补 4 块零覆盖测试：doctor / cron use-cases / filehubInit / darwin adapter（P2#16）
7. 消除 adapters↔application 层环（P1 结构性）——与 spec 更新同批

**第三批（规划）**
8. init --force 覆盖披露/备份；linux 双工作台隔离真机回归
9. PLATFORMS.md / workbench README / AGENTS.md 刷新路径修正（P2#12-14）
10. P3 卫生项按组批量处理

> 建议以「cron 子系统收敛」为一条主线任务（M5 遗留的终结）：合并 cli/cron.ts legacy 与 tag-scoped adapters 的职责，删除重复 helper，恢复三平台 no-op/idempotency 契约——这同时消解 P1×2 + P2×6。

---

## 八、附注

- 评审未发现：密钥/令牌泄漏（除真实数据占位）、`curl|bash` 静默执行、越权网络出口、破坏性操作无任何防护（`--force` 有语义但缺披露）。
- 架构与 spec 漂移是双向的：spec 未跟代码（directory-structure "no adapters/scheduler yet"、quality-guidelines 测试数、PLATFORMS.md），代码也未跟 spec（层环、core/registry 的 fs）。建议把 spec 与实现的同步纳入日常 gate。
- 原始 58 条 findings 与每维详细证据见 workflow 输出（`wf_e99e7e0f-fb1` journal）；本报告为其综合去重版。
