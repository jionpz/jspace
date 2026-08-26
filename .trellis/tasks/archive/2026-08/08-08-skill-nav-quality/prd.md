# skill 导航质量：references 引用改 ${CLAUDE_SKILL_DIR} + 跨 skill 策略

## Goal

修复 skill 正文的**文件引用导航**：现在用 CWD 相对引用（`` `references/x.md` ``、`` `../asset-ingest/...` ``），
从子目录启动会话时 Claude 按 CWD 解析找不到（已实测：`workspace/acme/references/gbrain.md` 不存在）。
改成正确定位的引用，让 skill 在任何启动目录下都能导航到自己的 references 与同族 skill 文档。

## 背景（已实测 + 官方文档确认，2026-08-08）

- **现状缺陷**：skill 正文用 `` `references/x.md` ``（SKILL.md 内）与 `` `../<skill>/references/x.md` ``（跨 skill），
  Claude 从 `workspace/<domain>/` 启动时 CWD 相对解析断（A 审查观察项 3 + C S3.4 实测确认）。
- **官方语义**（code.claude.com/docs/en/skills）：
  - `${CLAUDE_SKILL_DIR}` = skill 的 SKILL.md 所在目录，**markdown 内容里被替换**，**反引号代码 span 内也替换**
    （官方示例 `Run `${CLAUDE_SKILL_DIR}/scripts/render.sh``）。指向 skill 实际加载目录
    （`.claude/skills/<name>/` 副本加载时解析到副本，references 子树也在，正确）。
  - `${CLAUDE_PROJECT_DIR}` = 项目根（同 hooks 收到的 `CLAUDE_PROJECT_DIR`）。
- **跨 skill 引用无法用 `${CLAUDE_SKILL_DIR}`**（它只指向当前 skill）。分布：
  `../jspace-use/references/gbrain.md`×5、`../asset-ingest/references/gbrain-write.md`×4、
  `../asset-ingest/SKILL.md`×3、`../SKILL.md`×2（references 内指回自己 SKILL.md）。

## 引用形态统计（全仓库）

| 形态 | 数量 | 语义 | 新写法候选 |
|---|---|---|---|
| `` `references/x.md` ``（SKILL.md 内，同 skill） | ~55 | 当前 skill 的参考文档 | `` `${CLAUDE_SKILL_DIR}/references/x.md` `` |
| `` `../<skill>/references/x.md` ``（跨 skill） | ~9 | 同族 skill 的参考文档 | **需决策**（见下） |
| `` `../<skill>/SKILL.md` ``（跨 skill） | ~3 | 同族 skill 主文档 | **需决策** |
| `` `../SKILL.md` ``（references 内，回自己根） | ~2 | 当前 skill 主文档 | `` `${CLAUDE_SKILL_DIR}/SKILL.md` `` |
| `` `references/x.md` ``（references 内，同 skill） | ~12 | 当前 skill 的另一参考 | `` `${CLAUDE_SKILL_DIR}/references/x.md` `` |

（另有 `../<workbench>-inbox/` 等是**路径描述**非文件引用，不受影响；harness-config 是 global skill
装到 `~/.agents/skills/`，不随工作台物化，其引用语义单独处理。）

## 跨 skill 引用策略（Key Decision，需用户拍板）

| 选项 | 写法 | 子目录启动 | 一致性 | 代价 |
|---|---|---|---|---|
| **A · `~/.agents/skills` 统一物化** | `` `~/.agents/skills/<skill>/references/x.md` `` | ✓（用户级绝对路径，所有 harness 可读） | 高（统一前缀 + 统一物化） | 官方 skill 需物化一份到 `~/.agents/skills/`（多一处副本 + 刷新机制） |
| **B · 描述性转介** | 「写侧纪律见 asset-ingest 的 `references/gbrain-write.md`（用 skill 工具定位）」 | ✓（不依赖路径，agent 用 skill 发现） | 中（语义化，但丢精确路径） | agent 需主动用 skill 工具；审查者不能直接点开 |
| **C · 工作台相对路径** | `` `.jspace/skills/<skill>/references/x.md` `` | ✗（CWD 相对断） | 中 | 与现状同样断，只是规范化 |

**已拍板（2026-08-08 用户决策）：方案 A —— `~/.agents/skills/` 统一物化 + 全引用统一前缀。**

理由（多 harness 事实）：用户不只 Claude Code，还用 Grok / Pi / OpenCode。Claude 特有的
`${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}` 对它们无效。`~/.agents/` 是用户级一致位置
（`agents.md` + harness-config 都在那），所有 harness 都能访问用户级绝对路径；
`~` 每机解析到各自 home，符合「机器无关、用户级一致」的分层同步原则。

**含义**：官方 workbench skill（jspace-use / asset-ingest / memory-recall / memory-writeback）
需物化一份到 `~/.agents/skills/<name>/`（与 harness-config 的 global 物化同位置，统一成
「JSpace 官方 skill 的用户级位置」）。SKILL.md 与 references 内**所有文件引用**（同 skill +
跨 skill）统一写 `` `~/.agents/skills/<skill>/references/x.md` ``。不再区分同/跨 skill。

## Requirements

- **R1** 官方 skill 物化一份到 `~/.agents/skills/<name>/`（CLI 提供安装/刷新；幂等）
- **R2** SKILL.md 内同 skill 引用 `` `references/x.md` `` → `` `~/.agents/skills/<self>/references/x.md` ``
- **R3** references/*.md 内同 skill 引用同样改；`` `../SKILL.md` `` → `` `~/.agents/skills/<self>/SKILL.md` ``
- **R4** 跨 skill 引用 `` `../<skill>/references/x.md` `` → `` `~/.agents/skills/<skill>/references/x.md` ``
- **R5** `scripts/check-skills.ts` 的 C1 正则更新：识别 `~/.agents/skills/<name>/...` 新形态，
      校验其对应的**源文件**（repo 内 `skills/<name>/...`）存在
- **R6** harness-config（global skill，装 `~/.agents/skills/`）：其引用语义与 A 方案天然一致
      （本就装用户级），一并统一
- **R7** 验证：从工作台根 + 从 `workspace/<domain>/` 两种启动下，skill 的 references 导航可解析
- **R8** 物化命令需处理 refresh（skill 更新后重装）与幂等


## Acceptance Criteria

- [ ] AC1 官方 skill 物化到 `~/.agents/skills/<name>/`（含 references），幂等可刷新
- [ ] AC2 全部文件引用（同 skill + 跨 skill）改为 `` `~/.agents/skills/<name>/...` `` 前缀，
      无 `` `references/ `` 与 `` `../ `` 残留（grep 干净）
- [ ] AC3 `check-skills.ts` C1 覆盖新形态，校验源文件存在、通过
- [ ] AC4 从工作台根 + `workspace/<domain>/` 启动 claude → 调用 skill → references 引用可解析（真实会话确认）
- [ ] AC5 `bunx tsc --noEmit`、`bun test`、`gen-assets` 幂等、`check-skills` 全过
- [ ] AC6 仓库 PUBLIC：无真实路径泄漏（`~` 是机器无关占位，允许）

## 约束

- 改动集中在 `skills/*/SKILL.md` 与 `skills/*/references/*.md`（seed，未改随升级刷新）
- `harness-config` 引用语义独立（global skill），避免过度改造
- 改后重跑 `gen-assets` + `check-skills`（C1 是 gate）

## 非目标

- 不改 references 内容本身（只改导航写法）
- 不引入绝对本机路径（机器无关性；`${CLAUDE_SKILL_DIR}`/`${CLAUDE_PROJECT_DIR}` 都是运行时展开）
