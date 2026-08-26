# 工作台上下文通路对齐 harness 官方机制

> 父任务。持有需求全集、任务地图、跨子任务验收标准与最终集成审查。
> 本任务本身**不做实现**；实现在三个子任务里各自独立验收。
> 方法论依据：`research/trellis-injection-methodology.md`（从 Trellis 0.6.12 源码提取）。

## Goal

让 `jspace init` 生成的工作台，在用户选定的 harness（首要 Claude Code）里**真正拿到上下文**：
路由规则、工作台状态、官方 skill 三者都能自动到达会话，而不是依赖用户记得去读某个文件。

当前状态是：这三样**一样都没到达**，整套设计建立在一个不成立的前提上。

## 问题陈述（已证实，非推测）

### P1 — 工作台 `AGENTS.md` 从未进入 Claude Code 会话

Claude Code 官方只读 `CLAUDE.md`，不读 `AGENTS.md`
（官方文档 https://code.claude.com/docs/en/memory ：*"Claude Code reads `CLAUDE.md`, not `AGENTS.md`"*，
并给出 `@AGENTS.md` import 或 `ln -s` 两种接法）。

实测印证：会话开在本仓库（根有 `AGENTS.md`、无 `CLAUDE.md`），注入上下文里只有全局
`~/.claude/CLAUDE.md`，仓库 `AGENTS.md` 一字未进。`~/jspace-work/AGENTS.md`（15712 bytes，
含全部域/资源路由规则）同理。

影响面超出"少一份文档"：
- `jspace-use` 第 7 章声称 "`AGENTS.md` 是常驻路由与红线（每会话注入）"——前提不成立
- `jspace-use` 第 3 章「日常会话路由」仅 6 行，内容是"以 AGENTS.md 为准，本指南不复制"——指向空处
- AGENTS.md 自述"路由规则以 AGENTS.md 为准"——自指
- 域级边界机制（`workspace/<domain>/AGENTS.md`）同样失效
- `.jspace/cron.json` 三个任务 prompt 全部写"按 AGENTS.md 路由"，`claude -p` 无头模式同样读不到，
  且无人在旁补救。
  **状态（B 落地后）**：A 的 `CLAUDE.md` 指针让无头 claude 也能经官方 memory 通道读到 AGENTS.md；
  B 实测（专家审查确证）无头 `claude -p` **同样触发** SessionStart hook 并注入状态——
  cron 三个 prompt 的显式 `先跑 jspace context session-start --plain` 保留作**确定性兜底**
  （hook 触发依赖 claude 版本/环境，cron 不赌它）；与 hook 注入构成双份，成本 ~1KB/任务，可接受。

### P2 — 官方 skill 不在 harness 的发现路径上

4 个官方 skill 物化到 `.jspace/skills/`（`cli/embed.ts:102`），
而 Claude Code 只从 `~/.claude/skills/` 和 `<project>/.claude/skills/` 发现 skill。
实测：`~/.claude/skills/` 无 jspace 相关项；`~/jspace-work/.claude/` 只有 `settings.json`。

后果：Skill 工具列不出、`/jspace-use` 打不出、`description` 不进上下文预算。
唯一触发路径是 AGENTS.md 的 Brain operations 表——而它随 P1 一起不存在。
两层依赖同时断。`triggers:` 是自造字段（gbrain resolver 用），Claude Code 忽略。

### P3 — 内容缺「长期」维度

- `jspace-use` 自称长期指南，实际重量在首启（第 2 章）与故障排查（第 6/7 章）；日常路由 6 行且外包
- 记忆写回靠用户说"收工"；lifecycle 矩阵自评 Claude Code session-end = `best_effort`，
  而 `GOAL.md` 使用画面写的是"会话结束前自动写回"。这道缝会复利：
  不写回 → gbrain 无事实 → 次日注入不到 → "带着准确记忆工作"空转
- 域/资源/项目只有准入规则（创建信号 ≥2 条、禁止清单、确定度分级），**没有任何退出/回收机制**。
  `jspace doctor` 只查结构合法性，不查"是否还活着"。`GOAL.md` 骨架里有 `archive/<年>/`，
  但无任何 skill 负责往里挪

## 方案总纲

照 Trellis 的做法：**不再指望 memory 文件被读取，改由 hook 主动推送上下文**，
同时把 skill 放进 harness 的官方发现路径。详见 `research/trellis-injection-methodology.md` §8。

一处关键的**不照抄**：Trellis ship python hook 脚本（它没有自己的可执行文件）；
JSpace 的 `jspace` 是编译好的单文件二进制且已在 PATH 上，因此 hook 应写成
`jspace context <sub>` 子命令。收益是零运行时依赖、payload 生成逻辑可单测、升级不产生模板漂移。
理由与代价见方法论 §7 第 10 条。

## 任务地图

| 子任务 | 交付物 | 独立验收锚点 |
|---|---|---|
| A · 发现层对齐 | `CLAUDE.md` 指针 + skill 同字节物化到 `.claude/skills/` + upgrade/doctor 适配 | 全新 `jspace init` 后，claude 会话 `/context` 能看到 CLAUDE.md，Skill 列表含 4 个官方 skill |
| B · 注入层 | `jspace context` 子命令 + SessionStart/UserPromptSubmit hook 接线 + payload 设计 | 新会话自动带工作台状态与下一步；每 turn 带极短路由提示；无工作台时静默 exit 0 |
| C · 内容对齐长期使用 | AGENTS.md 块重构 + `jspace-use` 日常章补强 + 退役体检诊断 | AGENTS.md JSPACE 块显著变小且无冗余段；`doctor` 能报僵尸域/陈旧 state/待归档项目 |

依赖顺序（**写在各子任务产物里，不靠树形位置表达**）：
- C 的「AGENTS.md 瘦身」依赖 A 完成（官方 selector 接管后那两段渲染块才成为冗余）
- C 的「日常路由章补强」依赖 B 完成（要引用 hook 注入的块名）
- A 与 B 之间无依赖，可并行

## Requirements

### R1 — 发现层（子任务 A）
- R1.1 `jspace init` 在工作台根生成 `CLAUDE.md`，内容为 `@AGENTS.md` import（**不用 symlink**：
  Windows 需管理员权限/开发者模式；官方文档亦推荐 import 作为跨平台解）
- R1.2 官方 skill 除现有 `.jspace/skills/` 外，**同字节**物化到 `.claude/skills/`
- R1.3 两份副本必须同字节，杜绝"同名两份不同内容"（该问题已在 `~/jspace-work` 真实发生，见 R5.2）
- R1.4 新增文件纳入 `manifest.generated.ts`，ownership 归 `seed`（未改随升级刷新、改过保留 skip）
- R1.5 `jspace doctor` 能检出：`CLAUDE.md` 缺失或未指向 AGENTS.md、两份 skill 副本内容分叉

### R2 — 注入层（子任务 B）
- R2.1 新增 `jspace context session-start` / `jspace context turn`，输出 harness hook 约定的
  JSON（`hookSpecificOutput.additionalContext`）
- R2.2 `templates/workbench/.claude/settings.json` 注册 `SessionStart`（matcher 覆盖
  `startup`/`clear`/`compact`）与 `UserPromptSubmit`；现有 `jspace cron check` 合并进 session-start payload
- R2.3 payload 遵循方法论 §2 四个体积手段：截取不全文、两层显式去重、给路径不给内容、按当前范围过滤
- R2.4 `<current-state>` 必须是**求值后的结论**而非规则表：当前域、活跃项目、pending 暂存写、cron 失败、
  以及一句 `Next-Action`
- R2.5 可靠性七条（方法论 §4 表格）逐条落为验收项：非交互环境跳过、`JSPACE_HOOKS=0` 总开关、
  `no-jspace` 单 turn escape hatch、任何失败静默降级 exit 0、子进程超时上限
- R2.6 降级要**可见不静默**：非工作台目录 → 静默 exit 0；是工作台但注册表损坏 → 注入一行告警

### R3 — 内容（子任务 C）
- R3.1 AGENTS.md JSPACE 块瘦身：被官方 selector 接管的段落移除或缩短
  （**约束**：Brain operations 段仍被 gbrain resolver 解析，删除前必须确认 gbrain 侧影响）
- R3.2 `jspace-use` 第 3 章「日常会话路由」补成真正可用的日常入口，不再整章外包
- R3.3 新增退役/回收规则：僵尸域、失效资源指针、待归档项目、陈旧 `project/<id>/state`
- R3.4 `jspace doctor` 增加对应的 info 级诊断（不升级为 error，避免日常噪音）

### R4 — 全局约束
- R4.1 **不破坏所有权模型**：`hub.json` / `cron.json` 永不覆盖；`AGENTS.md` 只动 JSPACE 块；
  用户改过的 seed 文件保留为 skip
- R4.2 既有工作台经 `jspace workspace upgrade` 平滑获得新文件，不需要重新 `init`
- R4.3 改 `templates/workbench/` 或 `skills/` 后必须重跑 `gen-assets.ts` + `build` 同步嵌入式资产
- R4.4 仓库为 PUBLIC：新增示例/文档一律中性占位，不得出现真实个人或项目数据
- R4.5 非 Claude Code 的 harness（Pi/Codex/Cursor）在本轮**不做**接线，但设计不能把它们堵死；
  `references/harnesses.md` 的 lifecycle 矩阵需同步更新为改造后的真实能力

### R5 — 本机现存问题（顺带修，非设计缺陷）
- R5.1 `~/jspace-work` 停在 `template_version 1.0.8`，skill 仍是旧名 `jspace-bootstrap`
- R5.2 该工作台根 `skills/` 存有 4 个官方 skill 的**旧副本**，与 `.jspace/skills/` 内容已分叉
  （`diff -rq` 多处 differ + 缺文件），而 README 规定根 `skills/` 只归用户自建。
  `jspace doctor` 当前报 0 error，**未检出**此漂移

## Acceptance Criteria（跨子任务·父任务负责验收）

- [x] AC1 全新 `jspace init` 到空目录 → 在该目录启动 `claude` → `/context` 显示 `CLAUDE.md` 已加载，
      且会话上下文含工作台路由内容
      <!-- 子任务 A S6.4 用户真实会话确认（2026-08-08） -->
- [x] AC2 同一会话中官方 4 个 skill 出现在 Skill 列表，`/jspace-use` 可直接调用
      <!-- 子任务 A S6.4 用户真实会话确认（2026-08-08） -->
- [x] AC3 新会话首轮即带 `<current-state>` 与一句 `Next-Action`，无需用户提问
      <!-- 子任务 B S6.1 用户真实会话确认；`~/jspace-work` --plain 实测可见 -->
- [x] AC4 每 turn 带极短路由提示；`no-jspace` 关键词可单 turn 跳过；`JSPACE_HOOKS=0` 可全局关闭
      <!-- 子任务 B S6.4/S6.5 用户真实会话确认；gate 六条单测覆盖 -->
- [x] AC5 在非工作台目录启动 claude → hook 静默 exit 0，不产生任何输出与报错
      <!-- 子任务 B S6.3 用户真实会话确认；FIFO/非工作台实测 exit 0 零输出 -->
- [x] AC6 `~/jspace-work` 跑 `jspace workspace upgrade` → 平滑获得新文件；
      `hub.json`/`cron.json` 未被触碰；用户改过的文件报 `skip`
      <!-- 父任务集成审查实测：40 条 create/update/block-update，hub/cron 均 skip -->
- [x] AC7 `jspace doctor --dir .` 对 R1.5 / R3.4 / R5.2 各诊断项均能正确报出与消除
      <!-- A S6.1-6.3 真实验收（legacy_root_copy/projection_drift/pointer_missing）；
           C 体检测试 domain.dormant/filehub.project_stale 命中/未命中/边界 -->
- [x] AC8 AGENTS.md JSPACE 块行数较当前（111 行）显著下降，且 gbrain resolver 仍能解析其所需段落
      <!-- C 交付：111 → 102 行；gbrain 源码确认逐行正则解析、实测移除段后仍 reachable -->
- [x] AC9 `bun run scripts/gen-assets.ts` 后 `git diff` 干净（嵌入式资产与模板一致）；
      `tsc` 门禁与既有测试全绿
      <!-- 各 commit 门禁：gen-assets 幂等、395 tests 绿、tsc 干净；
           集成审查确认 diff 仅剩 .trellis/.template-hashes.json 既有漂移 -->
- [x] AC10 `docs/PLATFORMS.md` 与 `skills/jspace-use/references/harnesses.md` 的能力矩阵
      更新为改造后的真实分级，**不虚报自动化**（原则见 GOAL.md 与矩阵自述）
      <!-- B 更新 harnesses.md 矩阵（含无头触发修正 + crash recovery 格）；
           PLATFORMS.md 交叉引用核对一致；分级保持 best_effort 不升格 -->

## 非目标

- 不接线 Pi / Codex / Cursor（本轮只做 Claude Code；设计需保留扩展位）
- 不引入常驻进程、不改 gbrain、不动 filehub 协议
- 不做 Claude Code 的 `commands` / `agents` 扩展点（方法论 §7 第 9 条：JSpace 不需要）
- 不改任务管理相关设计——工作台明确无任务管理器

## Key Decisions

- **D1｜`@AGENTS.md` import 而非 symlink**：Windows symlink 需管理员/开发者模式，
  官方文档对该场景直接推荐 import。代价是多一个文件，收益是跨平台一致。
- **D2｜hook 用 `jspace context` 子命令而非 ship 脚本**：与 Trellis 的最大分歧点。
  依据见方法论 §7 第 10 条。风险（hook 行为随二进制升级变化）由"未知参数优雅降级 exit 0"缓解。
- **D3｜skill 用复制而非 symlink**：官方文档确认 `.claude/rules/` 支持 symlink，
  但未明说 skills；复制规避不确定性，代价是需要 R1.3 的同字节校验。
- **D4｜保留 `.jspace/skills/` 不迁移**：它是 harness 无关的事实源（Pi/Codex/Cursor 后续要用），
  `.claude/skills/` 是它的 harness 特化投影。

## Notes

- 依赖关系写在各子任务的 `prd.md` / `implement.md` 里，不靠父子树形位置表达
- 本任务不应被 `task.py start`；start 的是持有下一个可独立验收交付物的子任务
