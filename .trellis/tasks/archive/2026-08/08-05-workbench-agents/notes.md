# 实现笔记

## 2026-08-05 — workbench 根 agents.md 声明式 agents 分层约定

- **落地内容**:`templates/workbench/AGENTS.md` 新增 `## Agents` 段(仅此一文件手改):
  1. agents 语义声明:声明式(当上下文读),不物化成 harness agent 文件;
  2. 三层归属表(用户全局 `~/.agents/agents.md` / 工作台 / 项目根)+ "覆盖面最小一层"覆盖规则;
  3. 项目根 AGENTS.md 指针约定一行;
  4. 工作台能力 agents = 引用「Approved workbench skills」4 skill(skill 即 agent 形态),不重复;
  5. 对象标签格式模板(模仿 Trellis frontmatter:name/description/labels + 正文)。
- **范围控制**(用户要求"默认只影响 jspace work 的根 agents.md"):未碰 `~/.agents/agents.md`、README、各 harness agent 目录。
- **不新增渲染区**:避免与 Brain operations / Skill Governance 双源;若未来要渲染工作台 agent 清单再加 `<!-- TRELLIS-AGENTS:BEGIN/END -->`。
- **验证**:gen-assets 幂等;267 tests 全绿;新 init 工作台含 Agents 段、既有渲染区完好、doctor ok。

## 决策记录

- 用户个人 agents 的"对象标签"格式 = 声明式文档约定(非 harness subagent 文件),用户在自己的 `~/.agents/agents.md` `# agents` 段照此写。
- 系统 agents(trellis-check/implement/research)是开发仓库的 Trellis 能力,不属于工作台 agents,不声明。
