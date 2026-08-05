# JSpace - 工作台开发仓库

## Core Positioning

`JSpace` 是用户本地工作控制平面的**开发仓库**。它不再承担日常工作的 domain 路由：真实工作台由本仓库的 CLI 生成到其他目录，日常工作和 AI 会话从生成的工作台开始。

本仓库只维护以下内容：

- `cli/`：JSpace CLI（TypeScript/bun 源码，`bun run cli/main.ts` 运行；`bun run build` 产出 `bin/jspace` 编译二进制），提供 `init`（生成工作台）和 `doctor`（校验工作台）。
- `templates/workbench/`：工作台模板，包含 `.jspace/hub.json`、工作台 `AGENTS.md`、初始 domains。
- `skills/jspace-bootstrap/`：生成时复制进工作台的首次配置技能（gbrain + harness 接线）。
- `skills/asset-ingest/`：生成时复制进工作台的资料转知识资产技能（归位 + gbrain reference + 中文语义召回）。

本仓库根目录**不维护** `hub.json` / `workspace/` 日常注册表；这些只存在于 `templates/workbench/`，由 `jspace init` 实例化。模板中用占位符 `__DEV_ROOT__` 记录本仓库绝对路径，初始化时由 CLI 替换。

## Product Vision

完整愿景见根目录 **`GOAL.md`**（North Star，最高对齐物；冲突时以它为准）。摘要：JSpace 是**可移植的本地 AI 工作底座：路由 + 记忆 + 资产 + 定时**——在任意机器上安装 `jspace` CLI 初始化工作台，任何 AI harness（Pi / Claude Code / Codex / Cursor）从同一入口路由进正确的域、读写同一份持久记忆（gbrain）；工作产生的重资产（pdf/ppt/excel/md）被自动整理进独立的文件管理中心（Obsidian 可作为视图打开）；定时任务经系统调度 + harness 无头执行自动运行。对比基线是 hermes / OpenClaw 等常驻运行时方案：用静态组合覆盖其主要能力，而不引入常驻运行时与全家桶。

- 本仓库是**开发/发行目录**；产品形态是 CLI，目标机上的工作台才是日常入口。
- 能力分工：静态规则层（AGENTS.md + hub.json + 域）负责路由，gbrain 负责记忆（事实 + 资产指针）并兼作资料检索层（自带资料摄入/文件登记能力），文件管理中心负责重资产本体（人类可读），惯用 harness 负责执行，系统调度负责定时。**记忆存指针、资产存本体**。不封装 gbrain、不自研执行器、不自研文件同步。
- **非目标（显式不做）**：常驻运行时、事件驱动/入站多端网关（如消息触发代理）、自主代理、重资产全量二进制 embedding。系统调度覆盖"定时"，不承诺覆盖"事件"。
- **多机与分发采用分层同步**：git 同步规则与域内容；资产层走网盘/Obsidian Sync；registry 资源绝对路径属"本机真理"，按机器各自维护（doctor 对缺失路径仅告警即为此设计）。模板去个人化与路径占位符机制是分发（R7）的前置任务。
- 风险备忘：gbrain 为外部开源项目，选择不封装；数据本地（PGLite），上游停滞时数据仍可迁移。
- 成熟靠真实使用迭代涌现，不预先设计；当前迭代任务只是演进路径上的一步（里程碑 M0-M5 见 GOAL.md）。
- 所有迭代决策（范围、拆任务、暂缓项）都应向 `GOAL.md` 对齐；决策留痕见任务 PRD 的 Key Decisions。

## Modes

| Mode | Trigger | Scope |
| --- | --- | --- |
| Development | 默认；用户说 "开发模式" | 修改 CLI、模板、技能和本仓库文档 |
| Workbench | 在生成的工作台目录 | 见该目录 `AGENTS.md` |

**模式边界（开发 vs 工作）**：本仓库 AGENTS.md 属开发侧，包含 Product Vision、开发模式、Trellis 工作流等；这些内容**不会**随 `jspace init` 复制进生成的工作台。工作台模板（`templates/workbench/AGENTS.md`）只含工作模式的规则（域路由、资源治理、首次配置指引）。会话级工作流（harness 记忆注入/写回）由首次配置 skill 指导的 harness 接线提供，不属于任何 AGENTS.md 的内容，也不随 init 生成。

## Language

默认使用中文回复，除非用户明确要求其他语言。

## Development Workflow

1. 非平凡改动先走 Trellis 工作流；用户明确要求不建任务时直接实施。
2. 模板和技能是生成物来源：改 `templates/workbench/` 和 `skills/jspace-bootstrap/`，不要通过修改已生成的工作台来反推模板。
3. CLI 每次改动后验证：
   - `bunx tsc --noEmit`
   - `bun run cli/main.ts init /tmp/jspace-smoke`
   - `bun run cli/main.ts doctor --dir /tmp/jspace-smoke`
   - 在 `/tmp/jspace-smoke` 内演练 registry 命令（`domain`/`resource` 的 list/add/remove）
4. `hub.json` schema 见 `templates/workbench/.jspace/hub.json` 和 `skills/jspace-bootstrap/references/registry.md`：资源主路径必须是绝对路径，且恰好一个 `primary: true`。
5. 命名统一：项目、CLI、技能、模板、文档、domain 统一使用 `jspace`。
6. 首次开发、未上线：**无兼容性负担**——schema/CLI/模板可直接演进，不做迁移/弃用通道；版本化承诺推迟到分发（R7）。
7. 真实工作台升级约定（未分发、本地自用）：模板/CLI 更新后，既有工作台优先 `jspace workspace upgrade`（非破坏——未修改的 seed/skill 随升级刷新、本地编辑保留为 `skip`）；仅在需要完全重建时才清空重 init（`rm -rf <workbench>` 再 `jspace init <workbench>`，或清掉旧残留 `hub.json`/`.jspace.json` 后 `init --force`）。`init` 对已有工作台会拒绝（用 upgrade）；遇旧布局残留 init 会 fail 提示清除。

## Confirmation Rules

Ask before:

- 创建新的 domain/resource（模板内高置信度初始集除外）。
- 删除模板中已注册的 domain/resource。
- 把一次性实验固化进模板或技能。

## Quality Checks

- TS CLI 可执行（`bun run cli/main.ts --version`），`bunx tsc --noEmit` 通过。
- 模板渲染后 `jspace doctor` 通过（缺少的外部资源路径按 warning 处理）。
- 本仓库根目录没有残留 `hub.json` / `workspace/` 日常注册表。
- 命名检查：项目、CLI、技能、模板、文档、domain 统一使用 `jspace`。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
