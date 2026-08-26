<!-- JSPACE:START -->
<!-- JSpace 工作台受管块。本块由 jspace 维护:
     - jspace init 嵌入你的 AGENTS.md(无 AGENTS.md 时创建含本块的最小文件);
     - jspace workspace upgrade 只更新块内文本;
     - 块外内容归你所有,永不覆盖、永不删除。
     生成子块(Brain operations)由 scripts/gen-assets.ts
     从 SKILL.md frontmatter 渲染,勿手工编辑。 -->

# JSpace 工作台 - 本地工作控制平面

本目录由 JSpace CLI (`jspace init`) 生成，是用户本地工作控制平面。大多数非项目特定的计算机工作从这里开始：domain 路由、资源查找和上下文进入。**First core - gbrain unified memory base.** 第一核心是共享记忆层（`gbrain`）：JSpace 工作台 + gbrain 支持 Pi、Claude Code、Codex、Cursor、Grok Build、OpenCode 六个 harness（会话 harness 五选一，codex 兼容 cron），用户选择其一；各 harness 通过 MCP/CLI 读写同一本地记忆库（PGLite + 知识图谱 + 本地 embedding），会话开始检索式注入，结束时提醒你显式写回持久事实（提醒不代写，见 End-of-Work Capture）。hermes（自主/cron/多端）可选：提及即可，不主动推广。本工作台不包装 gbrain 命令，gbrain CLI/MCP 就是接口。

> 治理与流程细节（域/资源/skill 创建规则、cron 运维）→ `.jspace/skills/jspace-use/SKILL.md` 第 8 章「治理细节」，按需读，不在此复制。

## Modes

默认 Work mode——路由工作到 domain、检查资源、进入上下文；用户说「开发模式」→ 前往 JSpace 开发仓库（如已注册）维护 CLI、模板和技能。默认使用中文回复，除非用户明确要求其他语言。

## Daily Work Intake

Before changing files for non-trivial work, classify the request internally (implicit by default; mention it only when updating durable records, creating/proposing a domain or skill, the fit is uncertain, or the user asks why):

| Request type | Default action |
| --- | --- |
| Existing domain work | Read `workspace/<domain>/README.md` and `domain.json`; look up the domain/resource in `.jspace/hub.json`. |
| Existing resource work | Look up the resource in `.jspace/hub.json`; enter the owning domain before operating. |
| Candidate new domain | Create/propose a minimal domain only if it meets the domain rules in jspace-use §8. |
| Candidate new resource | Add/update a `.jspace/hub.json` resource only when it is a reusable entrypoint worth future lookup. |
| Candidate new skill | Propose a skill only if it meets the skill rules in jspace-use §8; ask before creating. |
| One-off operation | Do the work without adding durable structure. |
| JSpace development | Go to the JSpace development repository (if registered); use its workflow before editing. |

## Domain Governance

域是第一等操作工作区（`workspace/<domain>/`），索引在 `.jspace/hub.json`。**初始无域**——域从真实使用涌现，不做前置分类设计。建域前读 jspace-use 第 8 章（创建信号 ≥2 / 确定度分级 / 何时加 AGENTS|runbook 都在那边）。最小形态：`workspace/<domain>/{README.md, domain.json}`；建域时同步在 `.jspace/hub.json` 加索引，细节进 `domain.json`。

## Resource Governance

资源是域内可发现的入口（项目/仓库/URL/provider/容器/笔记等值得再次找到的对象）。schema（entrypoints/binding/primary）与 drift 规则 → `.jspace/skills/jspace-use/references/registry.md`，不在此复制。

## Registry Access

**注册表 = `.jspace/hub.json`。** 用标准工具直接读；校验用 `jspace doctor --dir .`。注册表是指针而非文件读取器，不复制完整 README/AGENTS/runbook 内容；查找用 `jq .jspace/hub.json`、`find workspace -maxdepth 2 -type f`、`rg`。文件细节见 `.jspace/skills/jspace-use/references/registry.md`。

## Skill Governance

根 `skills/` 归**用户自建**（创建须用户批准）；官方技能在 `.jspace/skills/`（machine-managed，未改随升级刷新、本地改动保留为 skip）、`.claude/skills/` / `.grok/skills/` / `.opencode/skills/`（各 harness 同字节投影）与 `.agents/skills/`（项目级多 harness 同字节投影），勿手工编辑；提议信号 / 禁区 / 用户确认规则 → jspace-use 第 8 章。首次使用前运行 `jspace skills install`，把官方 skills 物化到用户级 `~/.agents/skills/`（SKILL.md 里引用的 `~/.agents/skills/<skill>/references/...` 文档在此落地，未安装时打开会 404；`workspace upgrade` 会自动刷新过期副本）。

## Durable Knowledge Routing

| Knowledge | Destination |
| --- | --- |
| Daily operating rule for all agents | Root `AGENTS.md`(本块外是你的内容,块内是 JSpace 规则) |
| Persistent facts and asset pointers | gbrain（首次启用接线后；见 `.jspace/skills/jspace-use/references/gbrain.md`） |
| Domain entry point/resource/workflow | `workspace/<domain>/README.md` or `domain.json` |
| Domain-specific AI boundary | `workspace/<domain>/AGENTS.md` |
| Repeatable domain procedure | `workspace/<domain>/runbook.md` |
| Reusable AI capability | 官方 `.jspace/skills/` / 用户自建 根 `skills/`（经确认） |
| Domain/resource discovery index | `.jspace/hub.json` |

## Development Mode

维护 CLI/模板/技能请前往 JSpace 开发仓库（未注册先 `jspace domain add` / `jspace resource add`），读其 `AGENTS.md`，非平凡改动走其工作流；本工作台是生成产物，不在此编辑模板源。升级：`jspace workspace upgrade --dry-run` 预览 → 应用 → `jspace doctor --dir .`。

## Agents

Agent 定义是**声明式**的:作为上下文读取、按描述扮演,不物化成各 harness 的 agent 文件(`~/.claude/agents/` 等仍归各 harness 系统 agent 所有)。归属按"覆盖面最小的那一层",上层被引用、不复制:用户个人 agents → 全局 `~/.agents/agents.md`(用户定义);工作台能力 agents → 官方 skill(skill 即 agent 形态,按需读对应 SKILL.md);项目专属 agents → 项目根 `AGENTS.md`。**项目级继承**:项目根 `AGENTS.md` 顶部加——`> Agents:读 ~/.agents/agents.md(用户级)+ 工作台 AGENTS.md(如在此工作台下);本项目只定义项目专属 agents。`

## Confirmation Rules

Ask before: creating a project-local skill; creating a domain when confidence is medium or low; replacing existing resource notes/tags; removing a domain/resource from `.jspace/hub.json`; editing registry or docs outside these rules. Can proceed with explanation: high-confidence minimal domain creation; updating durable domain/resource notes from clearly-provided facts; repairing registry/domain-file drift when `.jspace/hub.json` and `workspace/<domain>/` disagree.

## End-of-Work Capture

Before finishing a work session, quietly check whether anything should be preserved (durable domain/resource fact, rule for future agents, repeated workflow, candidate skill). **When something durable was learned, run `memory-writeback` skill to persist it to gbrain** (session-fact write-back: state 覆盖 / knowledge append-only / promotion; 每页 `tags` 带 **`source:session`** —— 写回率取证的唯一依据). If nothing durable was learned, do not mention the check.

**提醒 ≠ 写入**：session-end hook 与每会话一次的收工轻提示（`jspace context turn`）都只提醒、从不写 gbrain；不跑 `memory-writeback` 就等于本次没沉淀。写回率自查 → `gbrain list --type note --tag source:session -n 20`。

## Scheduled Tasks (cron)

**Session start 跑 `jspace cron check`**，上报失败与 pending 暂存写（`<filehub>/.jspace-logs/*.APPLY.json`）；定义在 `.jspace/cron.json`。**出厂四个任务全 `enabled: false`**——没开启就没有 inbox 整理 / 周报 / 记忆巩固 / 周自省（`jspace doctor --verbose` 以 `cron.all_disabled` info 提示）；开启序列 `jspace cron enable <id>` → `jspace cron run <id>` → `jspace cron install`，细节与代价说明 → jspace-use 第 2 章 4.5 与第 8 章。

## Brain operations

gbrain resolver rows (OpenClaw AGENTS.md layout). This section is parsed by `gbrain` for skill routing; keep the format intact.

<!-- JSPACE-BRAIN-OPS:BEGIN -->
- **jspace-use**: initialize jspace | setup jspace | configure jspace | first-use jspace | how to use jspace | 工作台怎么用 | maintain jspace | 维护工作台 | workspace upgrade | jspace doctor | cron check | 故障排查 | workbench broken | registry broken | gbrain missing | wire gbrain | fresh environment
- **asset-ingest**: 资料入库 | 整理 inbox | 归位资料 | 把这份资料入库
- **memory-recall**: 问一句 | 找那个文件 | 那个数 | 精准召回 | recall | find the file
- **memory-writeback**: 收工 | 写回记忆 | 记一下本次进展 | 本次进展 | end of work | session end | writeback
- **workbench-retro**: 周自省 | 复盘 | 本周回顾 | 工作流体检 | retro | workbench retro | 纪律检查
- **weekly-report**: 生成周报 | 本周周报 | 本周汇总 | weekly report
- **memory-consolidate**: 记忆巩固 | 巩固记忆 | 周快照 | consolidate
<!-- JSPACE-BRAIN-OPS:END -->
> 区间内由 `scripts/gen-assets.ts` 从 SKILL.md frontmatter `triggers` 渲染生成,勿手工编辑;改 triggers 后重跑 gen-assets。

## Quality Checks

- `.jspace/hub.json` must remain valid JSON.
- Registered domain folders should exist and include `README.md` and `domain.json`.
- Registered resource primary paths should exist unless the task is explicitly about missing paths.
- `workspace/<domain>/domain.json` ids must match both the folder name and `.jspace/hub.json`.
- `jspace doctor --dir .` must pass after registry changes.
- Do not introduce task-management concepts; this workbench has no task manager.

<!-- JSPACE:END -->
