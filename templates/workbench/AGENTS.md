<!-- JSPACE:START -->
<!-- JSpace 工作台受管块。本块由 jspace 维护:
     - jspace init 嵌入你的 AGENTS.md(无 AGENTS.md 时创建含本块的最小文件);
     - jspace workspace upgrade 只更新块内文本;
     - 块外内容归你所有,永不覆盖、永不删除。
     两个生成子块(Brain operations / Skill Governance)由 scripts/gen-assets.ts
     从 SKILL.md frontmatter 渲染,勿手工编辑。 -->

# JSpace 工作台 - 本地工作控制平面

本目录由 JSpace CLI (`jspace init`) 生成，是用户本地工作控制平面。大多数非项目特定的计算机工作从这里开始：domain 路由、资源查找和上下文进入。

**First core - gbrain unified memory base.** 第一核心是共享记忆层（`gbrain`）。最普适的组合是 JSpace 工作台 + gbrain：支持 Pi、Claude Code、Codex、Cursor 四个会话 harness，用户选择其一；每个 harness 通过 MCP/CLI 读写同一个本地记忆库（PGLite + 知识图谱 + 本地 embedding），会话开始检索式注入，工作结束写回持久事实。hermes（自主/cron/多端）可选：提及即可，不主动推广。本工作台不包装 gbrain 命令，gbrain CLI/MCP 就是接口。

## Modes

| Mode | Trigger | Scope |
| --- | --- | --- |
| Work mode | Default | 路由工作到 domain、检查资源、进入上下文。 |
| Development mode | User says "开发模式" | 前往 JSpace 开发仓库（如已注册）维护 CLI、模板和技能。 |

## Language

默认使用中文回复，除非用户明确要求其他语言。

## Daily Work Intake

Before changing files for non-trivial work, classify the request internally:

| Request type | Default action |
| --- | --- |
| Existing domain work | Read `workspace/<domain>/README.md` and `domain.json`; look up the domain/resource in `.jspace/hub.json`. |
| Existing resource work | Look up the resource in `.jspace/hub.json`; enter the owning domain before operating. |
| Candidate new domain | Create/propose a minimal domain only if it meets the domain rules below. |
| Candidate new resource | Add/update a `.jspace/hub.json` resource only when it is a reusable entrypoint worth future lookup. |
| Candidate new skill | Propose a skill only if it meets the skill rules below; ask before creating. |
| One-off operation | Do the work without adding durable structure. |
| JSpace development | Go to the JSpace development repository (if registered); use its workflow before editing. |

Classification is implicit by default. Mention it only when updating durable records, creating/proposing a domain or skill, the fit is uncertain, or the user asks why a file/domain is involved.

## Domain Governance

A domain is a first-class operational work area under `workspace/<domain>/`. Current registered domains are indexed in `hub.json`. **初始无域**——域从真实使用涌现（复现、有资源、有边界等信号满足时按本规则创建），不做前置分类设计。

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

When creating a domain, also add a minimal domain index record to `.jspace/hub.json`. Keep detailed domain content in `workspace/<domain>/domain.json` and markdown files, not in `.jspace/hub.json`.

## Resource Governance

Resources are discoverable entrypoints inside a domain. They may represent projects, repositories, URLs, provider resources, containers, note systems, or other objects worth finding again.

`hub.json` is the resource index. Resource records use:

- `id`: globally unique across domains and resources.
- `type`: non-empty freeform string such as `project`.
- `domain`: registered domain id.
- `entrypoints`: one or more `path` or `url` entrypoints.
- optional `tags`.
- optional concise `notes`.

Resource path entrypoints reference a machine-local binding by key; the absolute path value lives in `.jspace/local.json` (gitignored). If a resource has path entrypoints, exactly one `kind: "path"` entrypoint must be `primary: true`. `primary` is not valid on URL entrypoints.

Do not put executable operation commands such as start/stop/deploy in resources. Operations belong in the owning domain's README, optional AGENTS, or optional runbook and are executed by the current human/AI session.

## Registry Access

**注册表 = `.jspace/hub.json`。下文 `hub.json` 概念指代均指此文件。**

Read the registry and domain files directly with standard tools:

- `.jspace/hub.json`: domain/resource/project discovery index (portable).
- `.jspace/local.json`: machine-local path bindings (gitignored).
- `workspace/<domain>/README.md` and `workspace/<domain>/domain.json`: domain entry and detail.

Validation uses the JSpace CLI: `jspace doctor --dir .` (`jspace` is the compiled binary on PATH; a source checkout runs `bun run cli/main.ts`). The registry is a map, not a file reader. It points to context files and must not duplicate full README/AGENTS/runbook content. For lookup, use `jq .jspace/hub.json`, `find workspace -maxdepth 2 -type f`, and `rg` queries.

## Skill Governance

Project-local skills are future reusable AI capabilities. Root `skills/` is reserved for **user-created** skills — create one only with user approval. Official bundled skills live under `.jspace/skills/` (machine-managed by `jspace init`/upgrade: unmodified copies are refreshed on upgrade, local edits are preserved as `skip`); do not hand-edit them here.

Propose a skill when at least two signals apply:

- Agents repeatedly need the same non-obvious procedure.
- The workflow crosses multiple files, tools, or domains.
- The behavior needs clear auto-trigger rules.
- Mistakes would be costly without a reusable checklist.
- The knowledge is too procedural for root `AGENTS.md` and too cross-cutting for one domain README.
- The user explicitly wants a reusable AI capability.

Do not create a skill for one-off notes, simple domain metadata, coding conventions that belong in `AGENTS.md`, large content dumps, or rules that fit clearly in `AGENTS.md` / a domain README.

Approved workbench skills (official; materialized by `jspace init` into `.jspace/skills/`):
<!-- TRELLIS-SKILL-GOV:BEGIN -->
- `jspace-bootstrap` - **首次配置** JSpace 工作台(需已装至少一个 harness):装 gbrain 统一记忆库(PGLite+知识图谱+本地 embedding)、校验注册表、接线所选 harness(MCP/CLI + 会话注入/写回)。Use when 初始化/配置 jspace、registry broken、gbrain missing、fresh environment。Do NOT use for 机器级多-harness 全局治理接线(→harness-config)或日常资料入库(→asset-ingest)。
- `asset-ingest` - 把一份工作资料(书籍/pdf/ppt/excel/报告)变成可召回的知识资产:本体归位文件中心 + 要点写进 gbrain reference 页。Use when 资料入库/整理 inbox/归位资料。Do NOT use for 会话进度写回(→memory-writeback)或用户主动问句召回(→memory-recall)。
- `memory-recall` - **读侧精准召回**:用户「问一句」时,把问题召回为有出处的答案——语义查询 → top-1 校验 → 指针断言链 → 打开文件引用出处。Use when 问一句/找那个文件/那个数/精准召回/recall/find the file。Do NOT use for 资料入库(→asset-ingest 写侧)或会话进度写回(→memory-writeback)。
- `memory-writeback` - **会话结束收工**时把本次持久事实按纪律写回 gbrain:扫描 → 分类(状态/知识/周快照) → 归属(project+slug) → 写回 → 验证读回。Use when 收工/写回记忆/记一下本次进展/session end/writeback。Do NOT use for 资料文件入库(→asset-ingest)、用户问句召回(→memory-recall)、周快照(→memory-consolidate cron)。
<!-- TRELLIS-SKILL-GOV:END -->
> 区间内由 `scripts/gen-assets.ts` 从 SKILL.md frontmatter 渲染生成,勿手工编辑;改 skill 的 name/description 后重跑 gen-assets。

## Durable Knowledge Routing

| Knowledge | Destination |
| --- | --- |
| Daily operating rule for all agents | Root `AGENTS.md`(本块外是你的内容,块内是 JSpace 规则) |
| Persistent facts and asset pointers | gbrain（bootstrap 后接线；见 `.jspace/skills/jspace-bootstrap/references/gbrain.md`） |
| Domain entry point/resource/workflow | `workspace/<domain>/README.md` or `domain.json` |
| Domain-specific AI boundary | `workspace/<domain>/AGENTS.md` |
| Repeatable domain procedure | `workspace/<domain>/runbook.md` |
| Reusable AI capability | `.jspace/skills/<jspace-skill>/`（官方）/ 根 `skills/<name>/`（用户自建，经确认） |
| Domain/resource discovery index | `.jspace/hub.json` |

Only write durable records when they will help future sessions. Root `AGENTS.md` should contain long-lived operating rules, not temporary preferences or one-off task notes.

## Development Mode

When the user says "开发模式" and wants to maintain the JSpace CLI/templates/skills:

1. This workbench is generated output. Do not edit template sources here.
2. Go to the JSpace development repository the user maintains (register it first via `jspace domain add` / `jspace resource add` if not already registered); read its `AGENTS.md` and follow its own workflow for non-trivial changes.
3. Preview changes with `jspace workspace upgrade --dry-run`, then `jspace workspace upgrade`, and run `jspace doctor --dir .`.

> 升级范围与所有权边界见 `README.md`「目录边界与升级范围」。本块由 upgrade 维护,块外内容不会被覆盖。

## Agents

Agent 定义是**声明式**的:作为上下文读取、按描述扮演,不物化成各 harness 的 agent 文件(`~/.claude/agents/` 等仍归各 harness 系统 agent 所有)。归属按"覆盖面最小的那一层",上层被引用、不复制:

| 适用范围 | 归属 |
| --- | --- |
| 用户个人 agents(跨机器 / 所有项目) | 全局 `~/.agents/agents.md` 的 `# agents` 段(用户定义) |
| 工作台能力 agents(本工作台) | 本块下方「Approved workbench skills」的 skill(skill 即 agent 形态) |
| 项目专属 agents(单项目) | 项目根 `AGENTS.md` |

本工作台以 agent 形态提供的能力 = 下方「Approved workbench skills」的 4 个 skill:`jspace-bootstrap` / `asset-ingest` / `memory-recall` / `memory-writeback`——按需读取对应 SKILL.md,不在此重复。

**项目级继承**:在项目根 `AGENTS.md` 顶部加一行——
> Agents:读 `~/.agents/agents.md`(用户级)+ 工作台 `AGENTS.md`(如在此工作台下);本项目只定义项目专属 agents。

## Confirmation Rules

Ask before:

- Creating a project-local skill.
- Creating a domain when confidence is medium or low.
- Replacing existing resource notes/tags.
- Removing a domain or resource from `.jspace/hub.json`.
- Editing registry or docs in ways not covered by the rules in this `AGENTS.md`.

Can proceed with explanation:

- High-confidence minimal domain creation.
- Updating durable domain/resource notes when the user clearly provided reusable facts.
- Repairing registry/domain-file drift when `.jspace/hub.json` and `workspace/<domain>/` disagree.

## End-of-Work Capture

Before finishing a work session, quietly check whether anything should be preserved (durable domain/resource fact, rule for future agents, repeated workflow, candidate skill). **When something durable was learned, run `memory-writeback` skill to persist it to gbrain** (session-fact write-back: state 覆盖 / knowledge append-only / promotion). If nothing durable was learned, do not mention the check.

## Scheduled Tasks (cron)

Cron definitions live in `.jspace/cron.json` (declarative: schedule + harness + prompt) and install into macOS launchd via `jspace cron install` (one LaunchAgent per cron). **At session start, run `jspace cron check`** (Claude Code best-effort: its SessionStart hook usually runs it, but the hook must actually fire; other harnesses — pi/codex/cursor — run it manually; lifecycle 分级见 `.jspace/skills/jspace-bootstrap/references/harnesses.md`) and report any failures / pending staged gbrain writes (`.jspace-logs/*.APPLY.json`) to the user. Cron definitions are treated as code (git-synced) — review changes before applying. Before the machine-side `jspace cron install`, run each task once via `jspace cron run` to verify the contract (rehearsal gate). **Headless runs go through the cc-switch local proxy with failover; account/quota model & exhaustion handling live with the jspace distribution (`.jspace/skills/jspace-bootstrap/references/headless-ops.md`) — if a cron fails from rate-limit/quota, failover → retry → downgrade, then let `jspace cron check` surface it.**

## Brain operations

gbrain resolver rows (OpenClaw AGENTS.md layout). This section is parsed by `gbrain` for skill routing; keep the format intact.

<!-- TRELLIS-BRAIN-OPS:BEGIN -->
- **jspace-bootstrap**: initialize jspace | setup jspace | configure jspace | first-use jspace | workbench broken | registry broken | gbrain missing | wire gbrain | fresh environment
- **asset-ingest**: 资料入库 | 整理 inbox | 归位资料 | 把这份资料入库
- **memory-recall**: 问一句 | 找那个文件 | 那个数 | 精准召回 | recall | find the file | 帮我找
- **memory-writeback**: 收工 | 写回记忆 | 记一下本次进展 | 本次进展 | end of work | session end | writeback
<!-- TRELLIS-BRAIN-OPS:END -->
> 区间内由 `scripts/gen-assets.ts` 从 SKILL.md frontmatter `triggers` 渲染生成,勿手工编辑;改 triggers 后重跑 gen-assets。

## Quality Checks

- `.jspace/hub.json` must remain valid JSON.
- Registered domain folders should exist and include `README.md` and `domain.json`.
- Registered resource primary paths should exist unless the task is explicitly about missing paths.
- `workspace/<domain>/domain.json` ids must match both the folder name and `.jspace/hub.json`.
- `jspace doctor --dir .` must pass after registry changes.
- Do not introduce task-management concepts; this workbench has no task manager.

<!-- JSPACE:END -->
