# JSpace - 工作台开发仓库

## Core Positioning

`JSpace` 是用户本地工作控制平面的**开发仓库**（前身 `myhub`）。它不再承担日常工作的 domain 路由：真实工作台由本仓库的 CLI 生成到其他目录，日常工作和 AI 会话从生成的工作台开始。

本仓库只维护三类内容：

- `bin/jspace`：Python 标准库 CLI，提供 `init`（生成工作台）和 `doctor`（校验工作台）。
- `templates/workbench/`：工作台模板，包含 `hub.json`、工作台 `AGENTS.md`、初始 domains。
- `skills/jspace-bootstrap/`：生成时复制进工作台的首次配置技能（gbrain + harness 接线）。

本仓库根目录**不维护** `hub.json` / `workspace/` 日常注册表；这些只存在于 `templates/workbench/`，由 `jspace init` 实例化。模板中用占位符 `__DEV_ROOT__` 记录本仓库绝对路径，初始化时由 CLI 替换。

## Modes

| Mode | Trigger | Scope |
| --- | --- | --- |
| Development | 默认；用户说 "开发模式" | 修改 CLI、模板、技能和本仓库文档 |
| Workbench | 在生成的工作台目录 | 见该目录 `AGENTS.md` |

## Language

默认使用中文回复，除非用户明确要求其他语言。

## Development Workflow

1. 非平凡改动先走 Trellis 工作流；用户明确要求不建任务时直接实施。
2. 模板和技能是生成物来源：改 `templates/workbench/` 和 `skills/jspace-bootstrap/`，不要通过修改已生成的工作台来反推模板。
3. CLI 每次改动后验证：
   - `python3 -m py_compile bin/jspace`
   - `bin/jspace init /tmp/jspace-smoke`
   - `bin/jspace doctor --dir /tmp/jspace-smoke`
4. `hub.json` schema 见 `templates/workbench/hub.json` 和 `skills/jspace-bootstrap/references/registry.md`：资源主路径必须是绝对路径，且恰好一个 `primary: true`。
5. 命名统一：项目、CLI、技能、domain 使用 `jspace`；不再出现 `myhub`、`hub-dev`、`hub doctor`。

## Confirmation Rules

Ask before:

- 创建新的 domain/resource（模板内高置信度初始集除外）。
- 删除模板中已注册的 domain/resource。
- 把一次性实验固化进模板或技能。

## Quality Checks

- `bin/jspace` 可执行，`python3 -m py_compile` 通过。
- 模板渲染后 `jspace doctor` 通过（缺少的外部资源路径按 warning 处理）。
- 本仓库根目录没有残留 `hub.json` / `workspace/` 日常注册表。
- 全文无陈旧 `myhub`、`hub-dev`、`hub doctor` 引用。

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
