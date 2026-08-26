# M5 模板去个人化（分发前置）

## Goal

让 `templates/workbench/` 变为**中性默认**：任何人在任意机器上 `jspace init` 得到的都是干净、无 owner 个人内容的工作台——为公开分发（GOAL.md M5 R7）铺路，同时修复「二进制独立安装时 `__DEV_ROOT__` 被替换为安装目录 → 生成指向 `~/.local/bin` 的错误 dev-repo 引用」的泄漏。

## 已确认事实（来自代码/模板，已取证）

- 模板含 owner 个人内容的 8 处：
  - `workspace/jspace-dev/` + `workspace/agent-infra/` 两域（README.md + domain.json）：前者指向 JSpace 开发仓库，后者管理 owner 的 AI 资源（cc-switch、个人 provider 端点 PackyCode/DeepSeek 等）。
  - `hub.json` 3 资源：`jspace`→`__DEV_ROOT__`、`cc-switch`→`/Users/jionpz/.cc-switch`、`gbrain`→`/Users/jionpz/.gbrain`。
  - `AGENTS.md`：硬编码「Initial domains are jspace-dev and agent-infra」、`Agent-infra Workflow` 段（cc-switch + `/Users/jionpz/.cc-switch`）、Modes 表 `Agent-infra domain` 行、`__DEV_ROOT__` 引用。
  - `README.md`：结构清单引用两域、`__DEV_ROOT__` 引用。
  - `skills/jspace-bootstrap/references/harnesses.md:68-70` + `gbrain.md:104-106`：cc-switch 路径、本地代理 `http://127.0.0.1:2006`、`workspace/agent-infra/` 引用。
- `cli/embed.ts`：`PLACEHOLDER="__DEV_ROOT__"`，`materializeTree` 在 init 时替换为 `devRoot()`；独立编译二进制安装时 `devRoot()` = 二进制所在目录 → 陌生人生成错误 dev-repo 引用（复评 B5 已确认）。
- `validateHub`（cli/registry.ts）对空 `domains`/`resources` 数组无报错（forEach 跳过）→ 空 hub.json 合法。
- `cron.json` 三任务（inbox-tidy / weekly-report / memory-consolidate）是 GOAL M3 产品级默认，无 owner 痕迹 → 保留。
- `skills/jspace-bootstrap`、`skills/asset-ingest` 是产品能力 → 保留，仅清 references 中 owner 路径。
- `cli/assets.generated.ts` 是构建期从 templates/ 生成的嵌入式树 → 改模板后需 `bun run scripts/gen-assets.ts` 重新生成。

## Requirements

- R1 移除 `workspace/jspace-dev/`、`workspace/agent-infra/` 两域（含 README.md、domain.json）。
- R2 `hub.json` 清空为 `{"version": 3, "domains": [], "resources": []}`。
- R3 `AGENTS.md` 中性化：删「Initial domains are jspace-dev and agent-infra」、`Agent-infra Workflow` 段、Modes 表 Agent-infra 行、cc-switch / `__DEV_ROOT__` 引用；保留域/资源/技能治理、路由、cron、Brain operations 等产品规则；gbrain 作为产品记忆层保留通用描述（去掉 cc-switch 接线细节）。
- R4 `README.md` 中性化：结构清单删除两域与 `__DEV_ROOT__` 引用，改为中性默认说明。
- R5 `skills/jspace-bootstrap/references/` 清理 owner 路径（harnesses.md cc-switch 段、gbrain.md Option C），改为中性/可选描述。
- R6 重新生成 `assets.generated.ts`；验证全新 init 的工作台零 owner 字符串、`jspace doctor` 通过。

## Acceptance Criteria

- [ ] `jspace init` 全新生成的工作台 grep 不到 `jionpz` / `cc-switch` / `agent-infra` / `jspace-dev` / `/Users/jionpz` / `__DEV_ROOT__`（**源码运行与编译二进制**各验一次）。
- [ ] 全新工作台 `jspace doctor --dir .` 0 error（空 hub.json 合法）。
- [ ] `bunx tsc --noEmit` 通过；`bun run build` 成功。
- [ ] 默认 cron 三任务在新工作台可用（`jspace cron list` 正常列出）。
- [ ] bootstrap skill 在新工作台可用且 references 无 owner 路径。

## Out of Scope

- 不改 `cli/embed.ts` 的 `__DEV_ROOT__` 机制本身（模板不再使用即自然消除泄漏；机制保留给需 dev-repo 链接的场景/owner 手动使用）。
- 不改 `cron.json` 内容（产品级默认任务）。
- 不动 owner 现有真实工作台（生成物按机器各自维护）。
- 不新增「空工作台引导」UX（`jspace-bootstrap` skill 已覆盖首次配置）。

## Key Decisions

- **中性默认 = 空 workspace**（无初始域，域从真实使用涌现）——对齐 GOAL.md「emerge from real use, not up-front taxonomy」。
- **`__DEV_ROOT__` 从默认模板移除**（两域与 jspace 资源删除后无占位符残留）；owner 如需 dev-repo 链接，按机器自行 `jspace domain add` / `resource add` 重建。
- **gbrain 保留为产品记忆层通用描述**（GOAL 四大支柱），去掉 cc-switch / owner 接线细节。

## Risks / Deferred

- **owner 未来重新 init 的工作台默认不含 jspace-dev/agent-infra**，需按机器手动重建（记录在本任务文档与 README 中性说明中）。
- 编译二进制 init 的 `__DEV_ROOT__` 泄漏在占位符移除后自然消失，无需改 embed.ts。
