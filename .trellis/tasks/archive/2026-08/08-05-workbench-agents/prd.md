# workbench 根 agents.md 声明式 agents 分层约定

## Goal

在 jspace 工作台根 `AGENTS.md`(模板 `templates/workbench/AGENTS.md`)建立**声明式 agents 分层约定**,作为全局约定在 jspace 侧的参考实现。**默认只影响工作台根 agents.md**,不碰用户全局 `~/.agents/agents.md`。

核心语义:
- **声明式 agents** = 当上下文读、按要求扮演,不物化成各 harness 的 agent 文件(`~/.claude/agents/` 等保持现状)。
- **三层归属**:用户个人 agents(全局 `~/.agents/agents.md` `# agents` 段,用户定义)→ 工作台能力 agents(本文件)→ 项目专属 agents(项目根 `AGENTS.md`)。
- **指针约定**:项目根 `AGENTS.md` 顶部注明"读全局 + 工作台 agents,本项目只定义项目专属"。

## Background（证据）

- 现状 workbench `AGENTS.md` 已有 10+ 节(域治理/资源治理/Skill Governance/Brain operations/Workspace Upgrade & Ownership),**无 agents 分层约定**;agents 定义按 harness 分散在 `.claude/agents/`、`.codex/agents/`、`.pi/agents/`(系统 agents,源头 `.trellis/agents/`),个人 agents 无单一归属。
- Claude Code/Pi 会拼接 用户级 + 祖先目录 + 项目级 的 AGENTS.md/CLAUDE.md(harness 自带继承),项目天然可见工作台 + 全局 agents;指针行把继承**显式化**。
- 工作台内置能力以 skill 形态已在「Approved workbench skills」块列出(jspace-bootstrap/asset-ingest/memory-recall/memory-writeback);agents 段应**引用而非重复**这些 skill,避免双源 drift。
- 上任务已落地「Workspace Upgrade & Ownership」段,本任务在其旁新增 agents 约定段。

## Requirements

- **R1 工作台根 AGENTS.md 新增 `## Agents` 段**(模板 `templates/workbench/AGENTS.md`),内容:
  1. agents 语义声明:声明式(当上下文读),不物化成 harness agent 文件;
  2. 三层归属表(全局用户 / 工作台 / 项目)+ 覆盖规则(放覆盖面最小的那层,上层被引用不复制);
  3. 项目根 `AGENTS.md` 指针约定一行说明;
  4. 工作台能力 agents = 引用「Approved workbench skills」的 4 个 skill(不重复列出),注明"skill 即 agent 形态";
  5. 对象标签格式模板(模仿 Trellis agent frontmatter:name/description/labels + 正文),供用户在自己 agents.md 里写个人 agents 参考。
- **R2 范围控制**:默认只改 `templates/workbench/AGENTS.md`;**不改** `~/.agents/agents.md`、不改 README、不改各 harness agent 文件。若 R1 内容需要 README 一句话呼应,须先说明理由。
- **R3 一致性与再生**:`bun run scripts/gen-assets.ts` 再生后 `templates/workbench/AGENTS.md` 与 `cli/assets.generated.ts` 一致(幂等);`bun test` 全绿;`jspace doctor` 类校验不受影响。
- **R4 不破坏既有渲染区**:`## Agents` 段不得影响「Brain operations」/「Approved workbench skills」既有 `<!-- TRELLIS-*-BEGIN/END -->` 渲染区(若 Agents 段新增渲染区,须走同一 gen-assets 渲染通道并防 drift)。

## Acceptance Criteria

- [ ] `templates/workbench/AGENTS.md` 含 `## Agents` 段,覆盖 R1 的 5 点(语义/三层表/指针/引用 skills/格式模板)。
- [ ] 段内对象标签格式模仿 Trellis frontmatter(name/description/labels),是声明式而非各 harness 语法。
- [ ] 未触碰 `~/.agents/agents.md` 与各 harness agent 目录(`git diff` 仅含本仓库工作台模板 + 再生产物)。
- [ ] `bun run scripts/gen-assets.ts` 幂等(二次运行 `git diff cli/` 不变);`bun test` 全绿。
- [ ] 既有「Brain operations」/「Approved workbench skills」渲染区字节不变(除本段新增内容)。
- [ ] 新 init 工作台的 `AGENTS.md` 含 Agents 段;`jspace doctor` 类校验通过。

## Out of Scope

- **物化 agents 到各 harness 文件**(`~/.claude/agents/` 等)——保持现状,纯声明式。
- **全局 `~/.agents/agents.md` 加 `# agents` 段**——用户自行维护,本任务只给格式模板。
- **项目根 AGENTS.md 模板/生成器**——指针约定作为文档说明写入工作台 AGENTS.md,不建项目模板。
- 系统 agents(trellis-check/implement/research)的声明——它们是开发仓库的 Trellis 能力,不属于工作台。
