# Harness wiring reference(接线与推荐配置)

> 面向 **4 个 AI harness**:Pi / Claude Code / Codex / Cursor。单一事实源 = **用户根目录** `~/.agents/agents.md`(治理文档,内容分层见 `governance.md`)。
> 本文所有配置规则均以 **官方当前文档查证为准**(研究日期 2026-08-02),每节标注来源;与既有假设不一致处以官方文档为准并注明差异。
> 接线目标由 `scripts/detect.sh` 检测决定(installed 接线 / not_found 跳过)。会话级配置(gbrain MCP、session 注入)只核对报告,不修改既有配置。

## 速查表

| Harness | 全局文件 | 接线方式 | 官方对 symlink | gbrain 接入 | Session 注入 |
|---|---|---|---|---|---|
| Pi | `~/.pi/agent/AGENTS.md` | symlink(源码确认可跟随) | 源码级支持 | 无原生 MCP → CLI 或 `pi-mcp-adapter` | context 文件 + `SYSTEM.md`/`APPEND_SYSTEM.md` |
| Claude Code | `~/.claude/CLAUDE.md` | symlink(官方推荐) / `@import` 备选 | ✅ 官方推荐 | `claude mcp add --scope user` → `~/.claude.json` | `~/.claude/settings.json` hooks.SessionStart |
| Codex | `~/.codex/AGENTS.md` | symlink(源码确认允许) | 源码级支持 | `~/.codex/config.toml` `[mcp_servers.<name>]` | `~/.codex/hooks.json` SessionStart |
| Cursor | 用户规则在 UI;文件式规则为**项目级** | 指针式 `.mdc`(项目级)+ AGENTS.md/CLAUDE.md | n/a(无用户级规则文件) | `~/.cursor/mcp.json` 或 `.cursor/mcp.json` | Rules 自动加载 + `~/.cursor/hooks.json` sessionStart |

---

## Pi

**官方来源**:https://pi.dev/docs/latest/usage · settings · skills · extensions · GitHub `earendil-works/pi`(研究见 `research/pi.md`)

### ① 全局文件接线

- 路径:`~/.pi/agent/AGENTS.md`(配置目录可用环境变量 `PI_CODING_AGENT_DIR` 覆盖)。
- 加载:启动时读取全局 `~/.pi/agent/AGENTS.md` + 祖先目录 + cwd 的 `AGENTS.md`/`CLAUDE.md`,**全部拼接**注入;禁用 `--no-context-files`。
- `/reload`:重载 keybindings/extensions/skills/prompts/themes/**context files**,无需重启即生效。
- **symlink 跟随**:官方未文档化,但源码(`resource-loader.ts` 用 `existsSync`+`statSync().isFile()`+`readFileSync`,全程无 `lstat`)确认 symlink 会被正常读取。
- **接线命令**:
  ```bash
  # 若 ~/.pi/agent/AGENTS.md 不存在(或为无内容空文件):直接建 symlink
  ln -s "$HOME/.agents/agents.md" "$HOME/.pi/agent/AGENTS.md"
  # 若已存在非空内容:不覆盖——把原内容并入治理文档,或保留原文件并在其中加入对治理文档的指引
  ```
- **无 `@import`**;`@` 前缀是 CLI 文件参数(`pi @prompt.md`),不是导入指令。

### ② gbrain MCP/CLI

- **Pi 核心无内置 MCP**(README 原文:"**No MCP.** Build CLI tools with READMEs… or build an extension that adds MCP support.");settings.json **没有** `mcp`/`mcpServers` 键。
- gbrain 接入两条路:
  1. **CLI**(最简):直接在会话中调用 `gbrain put / get / query / list`(gbrain 二进制经 `$GBRAIN_BIN` → `which gbrain` 解析)。
  2. **扩展 `pi-mcp-adapter`**(第三方,社区标准):`pi install npm:pi-mcp-adapter`,配置 `mcpServers`(stdio `command`+`args`)。配置优先级:`~/.config/mcp/mcp.json` > `~/.agents/mcp.json` > `~/.agents/mcp/mcp.json` > `~/.pi/agent/mcp.json` > `.mcp.json` > `.pi/mcp.json`。
- 核对:报告 `wired(CLI 可用) / missing(CLI 不可用)`;不修改既有配置。

### ③ Session-start 注入

- **文件式**(推荐):`~/.pi/agent/SYSTEM.md`(替换默认 system prompt)与 `~/.pi/agent/APPEND_SYSTEM.md`(追加),或项目 `.pi/SYSTEM.md`;context files(AGENTS.md/CLAUDE.md)本身即在启动时注入。
- **扩展事件式**:`session_start`(reason = startup/reload/new/resume/fork)与 `before_agent_start`("Can inject a message and/or modify the system prompt")。
- 注意:Pi **无** Claude Code 风格可配置 `hooks.json`;注入靠 context/SYSTEM 文件 + 扩展事件。

### ④ 推荐配置备注

- `~/.pi/agent/settings.json`:`defaultProvider` / `defaultModel` / `defaultThinkingLevel` / `theme` / `defaultProjectTrust`(仅全局)等;项目 `.pi/settings.json` 覆盖,嵌套 deep-merge。
- 凭据 `~/.pi/agent/auth.json`(0600);信任 `~/.pi/agent/trust.json`。
- skills 目录含 `~/.agents/skills/`(与 `~/.pi/agent/skills/` 并列)——本 skill 安装到 `~/.agents/skills/harness-config/` 可被 Pi 发现(需 `SKILL.md` frontmatter 含 `name`+`description`)。

---

## Claude Code

**官方来源**:https://code.claude.com/docs/en/memory · mcp · settings · hooks · permission-modes(研究见 `research/claude-code.md`)

### ① 全局文件接线

- 路径:`~/.claude/CLAUDE.md`(用户级)。Claude Code **读 CLAUDE.md**,不直接读 AGENTS.md(仅 `@import` 或 symlink 时加载)。
- 加载顺序(由宽到窄):managed policy → 用户 `~/.claude/CLAUDE.md` → 项目 `./CLAUDE.md`/`./.claude/CLAUDE.md` → 本地 `./CLAUDE.local.md`,全部拼接。
- **symlink:官方推荐**。文档示例 `ln -s AGENTS.md CLAUDE.md`,并在下一会话 `/context` 确认显示在 Memory files。Windows 需管理员/开发者模式(本 skill 默认 macOS/Unix)。
- **接线命令**:
  ```bash
  ln -s "$HOME/.agents/agents.md" "$HOME/.claude/CLAUDE.md"   # 默认:symlink
  # 备选 @import(若 symlink 内容层验证不生效):在 ~/.claude/CLAUDE.md 首行写
  #   @~/.agents/agents.md
  ```
  - 内容层验证:新会话运行 `/context`,确认治理文档出现在 Memory files;不生效则改用 `@import`。
- `@import` 支持相对/绝对路径与 `~` 展开,递归 ≤4 层;**不支持 glob**。
- 注意:`/rewind` 不恢复 symlink/hard-link 文件(不影响读取,仅影响检查点恢复)。

### ② gbrain MCP/CLI

- 用户级 MCP 配置:`claude mcp add --scope user`,存入 **`~/.claude.json`** 顶层 `mcpServers`(**不是** `settings.json`)。
  ```json
  { "mcpServers": { "gbrain": { "type": "stdio", "command": "<gbrain>", "args": ["serve"] } } }
  ```
  命令等价:`claude mcp add-json gbrain '{"type":"stdio","command":"<gbrain>","args":["serve"]}' --scope user`
- 核对:报告 `wired(MCP 或 CLI 可用) / missing`;不修改既有配置。

### ③ Session-start 注入

- 配置在 `~/.claude/settings.json` 的 `hooks` 键:
  ```json
  {
    "hooks": {
      "SessionStart": [
        { "matcher": "startup", "hooks": [
          { "type": "command", "command": "<hook-script>", "args": [] }
        ] }
      ]
    }
  }
  ```
- 注入:脚本退出 0 并输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<text>"}}`,Claude Code 将其作为 system reminder 插入会话首条 prompt 前。写事实陈述,不用祈使句(防 prompt-injection 触发)。

### ④ 推荐配置备注

- 权限模式:`permissions.defaultMode`(如 `acceptEdits`)只在用户/managed 设置生效;`disableAutoMode`/`disableBypassPermissionsMode` 供治理收紧。
- 保护路径(`.git`、`.claude`、`~/.claude.json` 等)不自动批准。
- 单文件建议 <200 行(内容即上下文)。

---

## Codex

**官方来源**:https://learn.chatgpt.com/codex/agent-configuration/agents-md · config-reference · hooks · extend/mcp;源码 `openai/codex` `agents_md.rs`(研究见 `research/codex.md`)

### ① 全局文件接线

- 路径:`~/.codex/AGENTS.md`(或 `CODEX_HOME` 指向目录);同层 `AGENTS.override.md` 存在则优先。
- 加载顺序:global 先,project 后(从 root 向下拼接,靠后覆盖靠前);每层只取第一个非空文件;**Codex 跳过空文件**。
- **symlink:源码确认允许**("Symlinks are allowed",`agents_md.rs`;读取用 `fs::read_file` 跟随)。官方文档未明说,属实现级事实。
- **接线命令**:
  ```bash
  # 若 ~/.codex/AGENTS.md 不存在、或为 0 字节空文件(Codex 视空文件为 no-op,从不自建占位):删除后建 symlink
  rm -f "$HOME/.codex/AGENTS.md"        # 仅当文件为空/无用户内容时
  ln -s "$HOME/.agents/agents.md" "$HOME/.codex/AGENTS.md"
  # 若已存在非空内容:不覆盖——并入治理文档或保留 + 附加指引
  ```
- **无 `@import`**;指向外部文件的替代:`model_instructions_file` config 键、`project_doc_fallback_filenames`。
- 验证加载:`codex --ask-for-approval never "Summarize the current instructions."`

### ② gbrain MCP/CLI

- 配置在 `~/.codex/config.toml` 的 `[mcp_servers.<name>]`(stdio `command`+`args`):
  ```toml
  [mcp_servers.gbrain]
  command = "<gbrain>"
  args = ["serve"]
  ```
- CLI 等价:`codex mcp add gbrain -- <gbrain> serve`。
- 核对:报告 `wired(MCP 或 CLI 可用) / missing`;不修改既有配置。

### ③ Session-start 注入

- 开关:`[features] hooks = true`(Stable 默认 true)。
- 配置 `~/.codex/hooks.json`(或 config.toml 内联 `[hooks.SessionStart]`):
  ```json
  {
    "SessionStart": [
      { "matcher": "startup|resume", "hooks": [
        { "type": "command", "command": "<hook-script>", "statusMessage": "Loading session notes" }
      ] }
    ]
  }
  ```
- 注入:stdout 纯文本或 `hookSpecificOutput.additionalContext` 作为额外 developer context;`additionalContextLimit`(默认 ~2500 token)控阈值。
- 补充:Memories(`[features] memories = true`,`~/.codex/memories/`)为 recall 层,团队必需规则仍放 AGENTS.md。

### ④ 推荐配置备注

- `model` / `model_provider` / `model_providers.<id>`(自定义 provider)在 config.toml。
- `approval_policy`、`sandbox_mode` 等治理键。
- 项目级 `.codex/config.toml` 仅受信任项目加载,且不可覆盖 `model_provider` 等键。

---

## Cursor

**官方来源**:https://cursor.com/docs/rules · help/customization/rules · docs/mcp · docs/hooks(研究见 `research/cursor.md`)

> **⚠️ 与早期假设的差异**:文件式 Rules(`.cursor/rules/*.mdc`)是 **项目级**;**用户级 User Rules 存于 Cursor UI 设置(Customize → Rules),没有对应的用户级规则文件目录**。因此"全局治理文档接进 Cursor"没有与 Pi/Codex/Claude Code 对等的用户级文件入口;接线以项目级指针 `.mdc` + Cursor 对 `AGENTS.md`/`CLAUDE.md` 的原生读取为主。本机 Cursor 未安装时整节跳过。

### ① 全局文件接线

- **User Rules(全局)**:Cursor 设置 → Customize → Rules 中添加(作用于 Agent/Chat,不作用于 Inline Edit);无文件入口。
- **Project Rules**:`<project>/.cursor/rules/*.mdc`,frontmatter 恰好 3 字段:
  ```markdown
  ---
  description: "遵循用户根目录治理文档 ~/.agents/agents.md"
  alwaysApply: true
  ---
  ```
  - `description`(string):给 Agent 判断相关性的说明;`globs`(逗号分隔路径模式);`alwaysApply`(boolean,true 则每个会话都应用,忽略 globs/description)。
  - 纯 `.md`(无 frontmatter)在 `.cursor/rules/` 下被忽略,必须 `.mdc`。
- **指针式规则:官方推荐**("Reference files instead of copying their contents";规则可用 `@filename.ts` 引用外部文件)。治理文档指针 `.mdc` 正文可含 `@$HOME/.agents/agents.md` 或对治理文档的遵循声明。
- **Cursor 原生读取 AGENTS.md/CLAUDE.md**:项目根/子目录的纯 markdown `AGENTS.md`/`CLAUDE.md` 自动读取,更具体子目录优先;`CLAUDE.md` 始终应用。旧 `.cursorrules` 已废弃。
- 全局治理的现实路径:① 把指针规则粘贴到 UI User Rules;② 每个项目放一个指针 `.mdc`(或项目 `AGENTS.md` 顶部 `@~/.agents/agents.md` 式引用)。

### ② gbrain MCP/CLI

- 配置 `mcp.json`:用户级 `~/.cursor/mcp.json` 或项目 `.cursor/mcp.json`:
  ```json
  { "mcpServers": { "gbrain": { "type": "stdio", "command": "<gbrain>", "args": ["serve"] } } }
  ```
- 支持 `${env:NAME}`、`${userHome}`、`${workspaceFolder}` 插值;Chat 中 MCP 工具默认需批准。
- 核对:报告 `wired(MCP 或 CLI 可用) / missing`;不修改既有配置。

### ③ Session-start 注入

- **Rules 本身即会话开始注入**:应用时规则内容在模型上下文开头加载。
- **Hooks**(脚本):`~/.cursor/hooks.json`(用户)或 `.cursor/hooks.json`(项目),`sessionStart` 事件输出 `{"additional_context":"<text>"}` 注入会话初始系统上下文;`env` 对该会话后续 hook 生效。
- 优先级:Enterprise → Team → Project → User。

### ④ 推荐配置备注

- 单条规则 <500 行,拆分为单一职责的多个规则;优先引用文件而非复制内容。
- MCP 认证走环境变量;远程 server 支持 `url`+`headers`+OAuth `auth`。

---

## 治理文档接线通用要点

- **单一事实源**:只编辑 `~/.agents/agents.md`;symlink 入口自动跟随,`@import`/指针 `.mdc` 只读指向。
- **不覆盖非空既有文件**:原内容并入治理文档,或保留原文件 + 附加接线,二选一向用户说明。
- **跳过**:detect.sh 报 `not_found`/`config_only` 的 harness 不接线,列入报告。
- **会话级配置只核对不写入**:gbrain MCP、session 注入逐 harness 报 `wired/missing/n/a`;写入由 bootstrap 或其他流程负责。

## 交叉核对说明(与 jspace-bootstrap 底稿的差异)

- **Pi**:底稿假设"Pi 用 stdio MCP wire gbrain"——**修正**:Pi 无内置 MCP,走 CLI 或 `pi-mcp-adapter` 扩展。
- **Cursor**:底稿假设"用户级 `~/.cursor/mcp.json`"(MCP 部分一致);治理文档接线底稿假设"Cursor 用 .mdc 指针文件"——**修正**:文件式 rules 是项目级,用户级无规则文件,见上文差异说明。
- **Claude Code MCP**:底稿写 `~/.claude.json`(一致,已确认顶层 `mcpServers`)。
- **Codex**:底稿写 `~/.codex/config.toml` `[mcp_servers.gbrain]`(一致);symlink 接线为新增事实(源码级支持)。
