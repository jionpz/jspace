# harness 推荐配置 skill — Technical Design

## 1. 边界与职责切分

```
                ┌──────────────────────────────────────────────┐
                │  ~/.agents/agents.md    (治理层 · harness 无关) │
                │  安全/隐私红线 + 通用规范 + 工作台入口路由骨架     │
                └──────────────┬───────────────────────────────┘
                    symlink ▲  │ .mdc 指针   ▲ symlink   ▲ @import(备选)
                            │  │            │           │
   ┌───────────────┐  ┌──────┴───┐  ┌───────┴────┐  ┌────┴──────────┐
   │ Pi AGENTS.md  │  │Codex AGENT│  │Claude CLAUDE│ │Cursor rules/* │
   └───────────────┘  └──────────┘  └────────────┘  └───────────────┘
   (会话级 wiring —— gbrain MCP/CLI、session 注入、hooks —— 留在各 harness 自己的配置)
```

- **治理层** = `~/.agents/agents.md`:只放 harness 无关的静态治理规则(安全/隐私红线、通用规范、工作台入口路由骨架)。单一事实源,编辑只改此文件。
- **接线层** = 各 harness 原生全局文件:Pi/Codex/Claude Code 用 symlink 指向治理文档(任何入口编辑写回单源);Cursor 用带 frontmatter 的 .mdc 指针文件。
- **会话级 wiring**(gbrain MCP/CLI、session-start 注入、hooks)= 留在各 harness 自己的配置目录,**不进治理文档**(内容分层纪律)。
- **路由层** = 工作台 `AGENTS.md`(域路由 + 资源治理),在其上;治理文档不重复其路由细节。
- **本 skill** = 分发层:文档 + 接线 + 推荐配置清单 + 只读核对报告。不实现 harness 内新功能。

## 2. 落地位置与结构

- **源**:仓库 `skills/harness-config/`;安装到 `~/.agents/skills/harness-config/`(用户级,机器级一次性,与治理文档同住;不随工作台复制)。
- **结构**:
  ```
  skills/harness-config/
    SKILL.md                     # frontmatter(name/description/triggers) + 分阶段流程
    scripts/
      detect.sh                  # 本机 harness 检测(POSIX bash,自包含,输出 TSV)
    references/
      governance.md              # ~/.agents/agents.md 骨架模板 + 内容分层规则
      harnesses.md               # 4 harness 接线细节 + gbrain wiring + 注入 + 推荐配置
  ```
- **与 jspace-bootstrap 分工**:bootstrap = 首次 wiring 视角(仅负责 gbrain MCP/CLI 写入);harness-config = 推荐配置总入口(治理文档 + 全 harness 接线 + 只读核对)。同源底稿 `skills/jspace-bootstrap/references/harnesses.md` 顶部加一行指向(可选小改,保留 bootstrap wiring 视角)。
- **命名纪律**:文档凡写 `~/.agents` 均注明"用户根目录",避免与本仓库项目级 `.agents/`(Trellis skills)混淆。

## 3. 接线流程(数据流)

```
运行 harness-config skill
  → ① 检测本机 harness:`scripts/detect.sh` 输出每 harness 的 binary / config_dir / state
       (installed / config_only / not_found);至少一个 installed 才继续
  → ② 安装/升级自身到 ~/.agents/skills/harness-config/(幂等;不覆盖用户已改文件)
  → ③ 创建/维护 ~/.agents/agents.md(用 governance.md 骨架模板,内容由用户确认)
  → ④ 接线已安装 harness 的全局文件:
       Pi     ~/.pi/agent/AGENTS.md         → symlink → ~/.agents/agents.md
       Codex  ~/.codex/AGENTS.md            → symlink(空 stub 先处置,见 4.2)
       Claude ~/.claude/CLAUDE.md           → symlink(备选 @import,见 4.1)
       Cursor ~/.cursor/rules/agents.mdc    → 指针文件(未装则跳过)
  → ⑤ 推荐配置核对(只读):逐 harness 核对 gbrain MCP / session 注入 / hooks 状态
       → 输出 wired / missing / skipped 三态,**不修改既有配置**
  → ⑥ 验证:ls -la 确认 symlink 目标;Claude Code 内容层验证,其余文件层验证
  → ⑦ 报告:wired / already-OK / skipped 清单,含空 stub 处置与核对 not-OK 项
```

**顺序依赖**:④(接线)先于 ⑥(验证);③(治理文档)先于 ④(接线入口指向它)。①(检测)必须先于 ④,未装 harness 直接跳过。

## 4. 关键机制设计

### 4.1 单源优先(symlink,Claude Code 备选 @import)
- Pi/Codex/Claude Code:symlink 指向 `~/.agents/agents.md`;任何入口编辑都写回单源。
- Claude Code 对 symlink CLAUDE.md 的跟随行为有版本差异,`@import` 为官方明确支持 → skill 默认给 symlink,**实跑对 Claude Code 做内容层验证**;若 symlink 未生效,改用 `@~/.agents/agents.md` import 行并记录(设计决策:本会话活跃 harness 是 Claude Code,内容层验证为硬性验证项)。
- Cursor:.mdc 需 frontmatter(description/globs/alwaysApply),用指针式小文件:正文"遵循 `~/.agents/agents.md`",不复制内容(保单源)。

### 4.2 既有全局文件处置(本机实测)
- `~/.codex/AGENTS.md` 存在但 **0 字节**(mtime 26 May)→ 判定为 Codex 自建空占位,无用户数据 → 删除空 stub 后建 symlink,处置写入报告。
- 若遇**非空**已有全局文件 → 不覆盖:原内容并入治理文档 或 保留原文件 + 追加 import/symlink 入口,二选一并向用户说明。
- 逐目标在实跑前先 `ls -la` 勘察,处置策略记录到任务 notes。

### 4.3 自包含(不硬编码本机路径)
- skill 安装到用户目录后不依赖仓库路径;接线命令用 `$HOME` 或 `<user-home>` 占位,不写死 `jionpz` 绝对路径。
- gbrain 可执行路径按 `$GBRAIN_BIN` → `which gbrain` 解析。
- 质量检查:`grep -rn "jionpz\|/Users/" skills/harness-config/` 应无命中(显式示例除外)。

### 4.4 只读核对边界(MCP 不写入)
- 实跑**不修改** MCP 配置类既有文件:`~/.codex/config.toml`(600 权限)、`~/.claude.json`(52k)、Pi settings.json。
- 核对输出逐 harness 三态:gbrain MCP wired / missing(报告)/ n/a(未装)。本机 Codex config.toml 的 mcp_servers 现无 gbrain 条目 → 核对阶段如实报 missing,不改。
- gbrain MCP 写入由 bootstrap 负责(职责边界);用户如要求补写,另行走 bootstrap。

### 4.5 自动检测机制(detect.sh)
- **定位**:SKILL.md Phase 0 运行,输出驱动接线/跳过;与 bootstrap"询问用户用哪个"不同,harness-config **全量自动检测**。
- **逻辑**(每 harness,pi / claude / codex / cursor):
  - `binary = command -v <name>`
  - `config_dir = $HOME/.pi / .claude / .codex / .cursor`(存在性)
  - `state` 判定:binary 存在 → `installed`;否则 config_dir 存在 → `config_only`(残留配置,提醒人工确认);否则 → `not_found`
- **输出**:TSV `harness\tbinary\tconfig_dir\tstate`,退出码恒 0;自包含,用 `$HOME`,不硬编码本机路径。
- **幂等**:每次运行重测,SKILL.md 据此决定接线/跳过;可被 CI/会话外调用。

### 4.6 配置规则查证(研究先行)
- harnesses.md **不靠既有知识/陈旧底稿**;实现前逐 harness 查官方当前文档并分析,研究产物落入任务 `research/` 目录:
  - **Claude Code**:全局 CLAUDE.md/AGENTS.md 位置与加载、`@import` 支持、symlink 跟随行为、hooks(会话级)、MCP 配置方式(`claude mcp add` / settings.json)。
  - **Codex**:用户级 `AGENTS.md` 全局层级、`config.toml` 的 MCP 与 `features.hooks`、session-start 注入。
  - **Pi**:全局 `AGENTS.md` 路径与 /reload 语义、MCP/CLI、session 注入。
  - **Cursor**:`.cursor/rules/*.mdc` frontmatter(`description`/`globs`/`alwaysApply`)、rules 加载方式、MCP(`mcp.json`)。
- **产出**:`research/<harness>.md` 每 harness 一节(结论 + 来源 URL + 核查日期);harnesses.md 每节标注来源与支持性结论(symlink / @import 等)。
- **与 bootstrap 底稿交叉核对**:gbrain MCP wiring 事实可复用,但路径、symlink 支持等逐条与官方文档核对,不一致以官方文档为准。

## 5. 文档同步(可选小改)

- `skills/jspace-bootstrap/references/harnesses.md` 顶部加一行"完整推荐配置见 harness-config skill"(bootstrap wiring 视角保留)。
- 不改 jspace-bootstrap 核心流程;不引入 `~/.agents` 治理文档到本仓库其他文件。

## 6. 取舍与边界

- **治理文档只放 harness 无关规则**:MCP/hooks/注入/session wiring 不进 `~/.agents/agents.md`,留在各 harness 配置。
- **不做** harness 对 `~/.agents/skills/` 的自动发现机制接线(无原生支持,推迟)。
- **不**安装/卸载 harness 本体(前提:至少一个已装)。
- **不修改既有 MCP 配置**(本任务只读核对)。
- **检测仅发现不改装**:detect.sh 只报告状态,不因检测而安装/升级任何 harness。
- **全局文档不重复工作台 AGENTS.md 的路由细节**(路由层之上是治理层)。
- 代价:与 jspace-bootstrap 的 harnesses.md 存在同源内容,靠"bootstrap=首次 wiring 视角 / harness-config=推荐配置总入口"定位区分。

## 7. 验收环境

- **实跑机 = 本机(jionpz)**:pi / claude / codex 已装,cursor 未装 → 检测预期 3 installed + 1 not_found,实跑 3 wired + 1 skipped。
- **验证命令**:
  ```bash
  bash skills/harness-config/scripts/detect.sh              # 输出与 command -v + 配置目录现状一致
  ls -la ~/.agents/agents.md
  ls -la ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md ~/.claude/CLAUDE.md   # symlink -> ~/.agents/agents.md
  ls -la ~/.cursor/rules/agents.mdc                                     # 未装则跳过
  grep -rn "myhub\|hub-dev\|hub doctor" skills/harness-config/ || echo clean
  grep -rn "jionpz\|/Users/" skills/harness-config/ || echo clean       # 自包含
  # Claude Code 内容层:新会话 /context 或 @import 确认治理文档实际可见
  ```
- **回滚**:先删 symlink 再 `rm -rf ~/.agents`;既有配置(MCP 等)未被触碰,无 MCP 回滚需求。仓库侧仅新增 `skills/harness-config/` + jspace-bootstrap harnesses.md 一行(可还原)。
