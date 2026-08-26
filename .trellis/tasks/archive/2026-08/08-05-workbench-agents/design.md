# workbench agents 约定 — 技术设计

## 放置位置

`templates/workbench/AGENTS.md`,插在「Workspace Upgrade & Ownership」之后、「Confirmation Rules」之前(治理/升级/能力相关段集中)。纯静态文本,**不新增渲染区**——工作台能力 agents 引用既有「Approved workbench skills」块,避免双源。

## Section 草稿

```markdown
## Agents

Agent 定义是**声明式**的:作为上下文读取、按描述扮演,不物化成各 harness 的 agent 文件(`~/.claude/agents/` 等仍归各 harness 系统 agent 所有)。归属按"覆盖面最小的那一层",上层被引用、不复制:

| 适用范围 | 归属 |
| --- | --- |
| 用户个人 agents(跨机器/所有项目) | 全局 `~/.agents/agents.md` 的 `# agents` 段(用户定义,对象标签格式见下) |
| 工作台能力 agents(本工作台) | 本文件 `## Agents` 段(见下) |
| 项目专属 agents(单项目) | 项目根 `AGENTS.md` |

本工作台以 agent 形态提供的能力 = 下方「Approved workbench skills」的 4 个 skill(skill 即 agent 形态):jspace-bootstrap / asset-ingest / memory-recall / memory-writeback——按需读取对应 SKILL.md。

**项目级继承**:在项目根 `AGENTS.md` 顶部加一行:
> Agents:读 `~/.agents/agents.md`(用户级)+ 工作台 `AGENTS.md`(如在此工作台下);本项目只定义项目专属 agents。

**对象标签格式**(写用户 agents 时参考,模仿 Trellis agent frontmatter):
- `name` 唯一短名;`description` 一句"做什么/何时用/不用什么";`labels` 触发关键词;正文 = 扮演说明(可选)。
- 例:`**jspace-bootstrap**:首次配置工作台(gbrain 记忆库+注册表+harness 接线)。Use when 初始化/配置 jspace。Do NOT use for 资料入库(→asset-ingest)。`
```

## 关键决策

- **不重复 skill 列表**:Agents 段引用「Approved workbench skills」而非再列一遍,防 drift(该块由 gen-assets 渲染)。
- **不新增渲染区**:对象标签格式是"用户写自己 agents 的模板",是静态约定,不随 skill frontmatter 变化;若未来要渲染工作台 agent 清单,再加 `<!-- TRELLIS-AGENTS:BEGIN/END -->` 走 gen-assets。
- **范围**:只改工作台模板 AGENTS.md;README/全局文件不动。

## 影响面

- `templates/workbench/AGENTS.md`(唯一手改文件)
- `cli/assets.generated.ts` / `cli/manifest.generated.ts`(gen-assets 再生,AGENTS.md 嵌入内容变化)
- 无测试文件改动(纯文档);验证 = gen-assets 幂等 + `bun test` 全绿 + 新 init 工作台 doctor 通过
