# JSpace 工作台 - 本地工作控制平面

## Core Positioning

本目录由 JSpace 开发仓库的 `bin/jspace init` 生成，是用户本地工作控制平面。大多数非项目特定的计算机工作从这里开始：domain 路由、agent 基础设施管理、资源查找和上下文进入。

**First core - gbrain unified memory base.** 第一核心是共享记忆层（`gbrain`，注册于 `agent-infra`）。最普适的组合是 JSpace 工作台 + gbrain：支持 Pi、Claude Code、Codex、Cursor 四个会话 harness，用户选择其一；每个 harness 通过 MCP/CLI 读写同一个本地记忆库（PGLite + 知识图谱 + 本地 embedding），会话开始检索式注入，工作结束写回持久事实。hermes（自主/cron/多端）可选：提及即可，不主动推广。本工作台不包装 gbrain 命令，gbrain CLI/MCP 就是接口。

JSpace 开发仓库（资源 `jspace`）位于 `__DEV_ROOT__`，只负责维护 CLI、模板和技能；本工作台不直接编辑模板，开发需求回到开发仓库处理。

## Modes

| Mode | Trigger | Scope |
| --- | --- | --- |
| Work mode | Default | 路由工作到 domain、检查资源、进入上下文。 |
| Development mode | User says "开发模式" | 前往 JSpace 开发仓库 `__DEV_ROOT__` 维护 CLI、模板和技能。 |
| Agent-infra domain | User says "弄一下 agent" or "管理 AI" | 读 `workspace/agent-infra/README.md`；通过 `cc-switch` 管理 AI 资源。 |

## Language

默认使用中文回复，除非用户明确要求其他语言。

## Daily Work Intake

Before changing files for non-trivial work, classify the request internally:

| Request type | Default action |
| --- | --- |
| Existing domain work | Read `workspace/<domain>/README.md` and `domain.json`; look up the domain/resource in `hub.json`. |
| Existing resource work | Look up the resource in `hub.json`; enter the owning domain before operating. |
| Candidate new domain | Create/propose a minimal domain only if it meets the domain rules below. |
| Candidate new resource | Add/update a `hub.json` resource only when it is a reusable entrypoint worth future lookup. |
| Candidate new skill | Propose a skill only if it meets the skill rules below; ask before creating. |
| One-off operation | Do the work without adding durable structure. |
| JSpace development | Go to the development repository `__DEV_ROOT__`; use its Trellis workflow before editing. |

Classification is implicit by default. Mention it only when updating durable records, creating/proposing a domain or skill, the fit is uncertain, or the user asks why a file/domain is involved.

## Domain Governance

A domain is a first-class operational work area under `workspace/<domain>/`. Current registered domains are indexed in `hub.json`. Initial domains are `jspace-dev` and `agent-infra`; future domains such as `docker` or `notes` should emerge from real use, not from up-front taxonomy design.

Create or propose a domain when at least two signals apply:

- It recurs across days, projects, or sessions.
- It has external resources worth tracking.
- It has distinct entry points, procedures, or safety rules.
- It needs AI-specific boundaries.
- It would become noisy as tags on unrelated resources.
- The user explicitly says this area should be managed from this workbench.

Do not create a domain for a one-off operation, a single code repository, a vague topic, or heavy content with no management surface.

High-confidence domain creation may proceed with a brief explanation. Medium-confidence cases should ask one question. Low-confidence cases stay one-off or attach to an existing domain.

Minimal domain shape:

```text
workspace/<domain>/
  README.md
  domain.json
```

Add `workspace/<domain>/AGENTS.md` or `runbook.md` only when repeated procedure or safety boundaries require it.

When creating a domain, also add a minimal domain index record to `hub.json`. Keep detailed domain content in `workspace/<domain>/domain.json` and markdown files, not in `hub.json`.

## Resource Governance

Resources are discoverable entrypoints inside a domain. They may represent projects, repositories, URLs, provider resources, containers, note systems, or other objects worth finding again.

`hub.json` is the resource index. Resource records use:

- `id`: globally unique across domains and resources.
- `type`: non-empty freeform string such as `project`.
- `domain`: registered domain id.
- `entrypoints`: one or more `path` or `url` entrypoints.
- optional `tags`.
- optional concise `notes`.

Resource path entrypoints must use absolute paths. If a resource has path entrypoints, exactly one `kind: "path"` entrypoint must be `primary: true`. `primary` is not valid on URL entrypoints.

Do not put executable operation commands such as start/stop/deploy in resources. Operations belong in the owning domain's README, optional AGENTS, or optional runbook and are executed by the current human/AI session.

## Registry Access

Read the registry and domain files directly with standard tools:

- `hub.json`: domain/resource discovery index.
- `workspace/<domain>/README.md` and `workspace/<domain>/domain.json`: domain entry and detail.

Validation uses the JSpace CLI: `jspace doctor --dir .` (`jspace` is the compiled binary on PATH; a source checkout runs `bun run cli/main.ts` from `__DEV_ROOT__`). `hub.json` is a map, not a file reader. It points to context files and must not duplicate full README/AGENTS/runbook content. For lookup, use `jq . hub.json`, `find workspace -maxdepth 2 -type f`, and `rg` queries.

## Skill Governance

Project-local skills are future reusable AI capabilities. Do not create root `skills/` or skill placeholders unless the user approves or a later task explicitly implements the skill layer.

Propose a skill when at least two signals apply:

- Agents repeatedly need the same non-obvious procedure.
- The workflow crosses multiple files, tools, or domains.
- The behavior needs clear auto-trigger rules.
- Mistakes would be costly without a reusable checklist.
- The knowledge is too procedural for root `AGENTS.md` and too cross-cutting for one domain README.
- The user explicitly wants a reusable AI capability.

Do not create a skill for one-off notes, simple domain metadata, coding conventions that belong in `AGENTS.md`, large content dumps, or rules that fit clearly in `AGENTS.md` / a domain README.

Approved workbench skills (copied in by `jspace init`):
- `jspace-bootstrap` - first-time setup: verify the registry, bootstrap the gbrain memory base, and wire harnesses. Use it when the user asks to initialize or configure this workbench.
- `asset-ingest` - ingest work material (books, pdf/ppt/txt, excel, reports) into the file hub and gbrain as searchable knowledge assets. Use it when the user asks to file a document, tidy the inbox, or turn a resource into knowledge.

## Durable Knowledge Routing

| Knowledge | Destination |
| --- | --- |
| Daily operating rule for all agents | Root `AGENTS.md` |
| Persistent facts and asset pointers | gbrain（bootstrap 后接线；见 `skills/jspace-bootstrap/references/gbrain.md`） |
| Domain entry point/resource/workflow | `workspace/<domain>/README.md` or `domain.json` |
| Domain-specific AI boundary | `workspace/<domain>/AGENTS.md` |
| Repeatable domain procedure | `workspace/<domain>/runbook.md` |
| Reusable AI capability | `skills/<jspace-skill>/` after confirmation |
| Domain/resource discovery index | `hub.json` |

Only write durable records when they will help future sessions. Root `AGENTS.md` should contain long-lived operating rules, not temporary preferences or one-off task notes.

## Agent-infra Workflow

For "弄一下 agent" or "管理 AI":

1. Read `workspace/agent-infra/README.md` and `workspace/agent-infra/domain.json`.
2. Treat `/Users/jionpz/.cc-switch` as the managed AI-resource project registered as the `cc-switch` resource in `hub.json`.
3. Operate through the `cc-switch` context for providers, models, proxy, client configuration, and skills.
4. When the user says "好了" or "去工作了", confirm the next domain if it is not clear.

## Development Mode

When the user says "开发模式":

1. This workbench is generated output. Do not edit template sources here.
2. Go to the JSpace development repository `__DEV_ROOT__`.
3. Read its `AGENTS.md` and use its Trellis workflow for non-trivial changes.
4. After template/CLI changes, re-run `jspace init --force .` or reinitialize a fresh workbench, then run `jspace doctor --dir .`.

## Confirmation Rules

Ask before:

- Creating a project-local skill.
- Creating a domain when confidence is medium or low.
- Replacing existing resource notes/tags.
- Removing a domain or resource from `hub.json`.
- Editing registry or docs in ways not covered by the rules in this `AGENTS.md`.

Can proceed with explanation:

- High-confidence minimal domain creation.
- Updating durable domain/resource notes when the user clearly provided reusable facts.
- Repairing registry/domain-file drift when `hub.json` and `workspace/<domain>/` disagree.

## End-of-Work Capture

Before finishing a work session, quietly check whether anything should be preserved:

- Durable domain/resource fact.
- Rule that future agents should follow.
- Repeated workflow for a domain runbook.
- Candidate reusable skill.

If nothing durable was learned, do not mention the check. If something should be preserved, briefly explain what, where, why, and whether confirmation is needed.

## Brain operations

gbrain resolver rows (OpenClaw AGENTS.md layout). This section is parsed by `gbrain` for skill routing; keep the format intact.

- **jspace-bootstrap**: initialize jspace | setup jspace | configure jspace | first-use jspace | workbench broken | registry broken | gbrain missing | wire gbrain | fresh environment
- **asset-ingest**: 资料入库 | 整理 inbox | 归位资料 | 把这份资料入库

## Quality Checks

- `hub.json` must remain valid JSON.
- Registered domain folders should exist and include `README.md` and `domain.json`.
- Registered resource primary paths should exist unless the task is explicitly about missing paths.
- `workspace/<domain>/domain.json` ids must match both the folder name and `hub.json`.
- `jspace doctor --dir .` must pass after registry changes.
- Do not introduce task-management concepts; this workbench has no task manager.
