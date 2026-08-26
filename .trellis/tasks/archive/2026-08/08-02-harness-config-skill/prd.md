# harness 推荐配置 skill

## Goal

新建分发技能 `skills/harness-config/`：指导 AI harness 为用户配置各 AI harness（Pi / Claude Code / Codex / Cursor）的推荐配置。核心交付是 `~/.agents/agents.md` 全局治理文档（所有 harness 的单一事实源）的创建与接线，外加各 harness 的推荐配置清单（gbrain MCP/CLI、session 注入、hooks 等）。技能安装到用户根目录 `~/.agents/skills/harness-config/`，机器级一次性，自包含可用。

## Background

- 各 harness 原生只读自己的全局文件，不识别 `~/.agents/agents.md`：Pi `~/.pi/agent/AGENTS.md`（/reload 生效）、Claude Code `~/.claude/CLAUDE.md`（支持 @import 与 symlink）、Codex `~/.codex/AGENTS.md`（原生全局层级）、Cursor `~/.cursor/rules/*.mdc`（需 frontmatter，适合"指针式"规则文件）。
- 内容分层：`~/.agents/agents.md` 只放 harness 无关的静态治理规则（安全/隐私红线、通用规范、工作台入口路由骨架）；各 harness 的会话级 wiring 留在各自目录；工作台 `AGENTS.md` 是路由层（域路由+资源治理），全局文档是治理层（在其之上）。
- 命名混淆点：`~/.agents/`（用户根目录）与本仓库项目级 `.agents/`（Trellis skills）同名不同位置，文档必须写明"用户根目录 ~/.agents"。
- `skills/jspace-bootstrap/references/harnesses.md` 已有 gbrain wiring（MCP/hooks/session 注入）细节，作为本 skill 同源底稿；但本 skill 必须自包含（安装到用户目录后不依赖仓库路径）。

## Requirements

1. 新建 `skills/harness-config/SKILL.md`，格式与本仓库 jspace-bootstrap 一致（frontmatter name/description + 分阶段流程），流程覆盖：**检测本机已安装 harness**（命令 + 配置目录）→ 安装/升级自身到 `~/.agents/skills/harness-config/` → 创建 `~/.agents/agents.md` 治理文档 → 接线已安装 harness 原生全局文件 → 各 harness 推荐配置 → 验证与报告（含跳过项）。
2. 新建 `skills/harness-config/references/governance.md`：`~/.agents/agents.md` 骨架模板（含内容分层说明：放什么、不放什么、与工作台 AGENTS.md 的分工、维护约定"编辑单一事实源"）。
3. 新建 `skills/harness-config/references/harnesses.md`：4 个 harness 的接线细节——① 全局文档接线（Pi/Codex/Claude Code 用 symlink；Cursor 用带 frontmatter 的 .mdc 指针文件）② gbrain MCP/CLI ③ session-start 注入 ④ 其他推荐配置。自包含，不引用仓库相对路径。
4. 可选：`skills/jspace-bootstrap/references/harnesses.md` 顶部加一行"完整推荐配置见 harness-config skill"（bootstrap wiring 视角保留，加指向）。
5. 在用户机器（jionpz）按 SKILL.md 实跑一遍：创建 `~/.agents/agents.md`、完成已安装 harness 的**治理文档接线**（symlink / .mdc 指针）、跳过未安装的并报告。gbrain MCP / session 注入等会话级 wiring 只**核对报告**（wired / missing / skipped），**不修改既有配置**。
6. 内容为中文（SKILL.md 流程/说明），技术事实（路径、命令、frontmatter）用英文原文；全文无陈旧 `myhub` 引用。
7. SKILL.md 具备**自动检测本机已安装 harness** 的功能：`scripts/detect.sh`（POSIX bash，自包含）输出每个 harness 的二进制路径 / 配置目录 / 状态（installed / config_only / not_found），检测结果驱动后续接线与跳过，不依赖用户手动指定。
8. `references/harnesses.md` 各 harness 的配置规则（全局文件位置、symlink / @import 支持、MCP 配置位置与格式、session 注入、rules 格式）以**官方当前文档为准**：实现前逐 harness 查文档并分析，不依赖既有知识或陈旧底稿；每节标注来源链接。

## Acceptance Criteria

- [ ] `skills/harness-config/SKILL.md` 存在，frontmatter 合法，流程覆盖 R1 全部阶段（含检测 Phase）。
- [ ] `references/governance.md` 含治理文档骨架模板与内容分层规则；`references/harnesses.md` 覆盖 4 个 harness 的接线 + gbrain wiring + 注入方式，且不依赖仓库相对路径（自包含）。
- [ ] 用户机器上实跑结果：`~/.agents/agents.md` 存在且为合法 Markdown；已安装 harness 的全局文件接线完成（symlink 目标正确 / .mdc 存在）；未安装 harness 明确列为跳过项。
- [ ] 接线可验证：`ls -la` 确认 symlink 指向 `~/.agents/agents.md`；**Claude Code 做内容层验证**（新会话 `/context` 或 `@import` 确认治理文档实际可见），Pi/Codex 文件层验证。
- [ ] 全文无陈旧 `myhub` / `hub-dev` / `hub doctor` 引用；skill 文档中 `~/.agents` 均写明"用户根目录"。
- [ ] `scripts/detect.sh` 本机可跑通，输出与 `command -v pi claude codex cursor` + 配置目录现状一致；未安装 harness 正确标为 not_found。
- [ ] `references/harnesses.md` 每 harness 节标注官方文档来源链接，配置规则（symlink / @import 支持性等）与来源一致。

## Out of Scope

- 不安装/卸载 harness 本体（前提：至少一个已安装）。
- 不做各 harness 对 `~/.agents/skills/` 的自动发现机制接线（无原生支持，推迟）。
- 不改 jspace-bootstrap 核心流程（仅可选加一行指向）。
- 不做 CLI/GUI；skill 本体为文档技能，唯一可执行件是轻量 `scripts/detect.sh` 检测脚本（不安装/卸载 harness、不做自动发现接线）。

## Key Decisions

- **范围=全集，自包含**：skill 同时含治理文档接线 + 各 harness 推荐配置清单；安装后独立可用，不引用仓库路径。代价是与 jspace-bootstrap 的 harnesses.md 存在同源内容，靠"bootstrap=首次 wiring 视角 / harness-config=推荐配置总入口"定位区分。
- **安装位置=用户级全局**：源在仓库 `skills/harness-config/`，装到 `~/.agents/skills/harness-config/`，机器级一次性，与治理文档同住；不随工作台复制（全局治理非工作台内容）。
- **接线方式=单源优先**：Pi/Codex/Claude Code 用 symlink（编辑任何入口都写回 `~/.agents/agents.md`）；Cursor 因 .mdc 需 frontmatter 用指针式小文件（正文指向治理文档并遵循之）；Claude Code 的 symlink 若内容层验证不生效则改用 `@import` 备选。
- **MCP 边界=只读核对**：实跑仅做治理文档接线；gbrain MCP / session 注入等会话级配置逐 harness 核对状态（wired / missing / skipped）写入报告，不修改既有配置（gbrain MCP 写入由 bootstrap 负责）。
- **检测=自动而非询问**：与 bootstrap"问用户用哪个 harness"不同，harness-config 用 `scripts/detect.sh` 自动检测全部已装 harness 并逐个接线；检测逻辑（命令 + 配置目录）幂等、每次运行重跑。
- **配置规则=查证而非假设**：harnesses.md 逐 harness 以官方当前文档为准（研究先行后写入），每节标注来源；不依赖训练知识或陈旧底稿。
- **内容分层纪律**：治理文档只放 harness 无关规则；MCP/hooks/注入等会话级细节留各 harness 目录；全局文档不重复工作台 AGENTS.md 的路由细节。

## Risks / Deferred

- 各 harness 的 skills 发现机制对 `~/.agents/skills/` 无原生支持：接受现状（该 skill 供本仓库/工作台会话调用），发现机制推迟到真实需求出现。
- Claude Code `@import` 与 symlink 的行为差异：skill 默认给 symlink，@import 作为备选注明。
- Cursor .mdc 指针式规则可能不如直接嵌入内容可靠：接受，因治理文档需单源维护。
