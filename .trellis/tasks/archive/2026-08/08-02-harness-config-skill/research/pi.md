# Pi — config research (2026-08-02)

> 官方来源已确认：Pi 是 Earendil Works 出品的开源 terminal 编码 agent（GitHub: `earendil-works/pi`，npm: `@earendil-works/pi-coding-agent`），官方文档站 `https://pi.dev/docs/latest/`（对应源码文档 `packages/coding-agent/docs/*.md`）。本文所有事实均从官方文档站与 GitHub 源码直接抓取核实（2026-08-02），非凭记忆。置信度标注：**官方文档** = 直接在 pi.dev/README 抓到；**源码推断** = 从 `resource-loader.ts` 源码读出的行为，官方文档未明确写。

---

## 全局 AGENTS.md 与 /reload

**全局路径**：`~/.pi/agent/AGENTS.md`。agent 配置目录 = `~/.pi/agent/`，可用环境变量 `PI_CODING_AGENT_DIR` 覆盖（见 environment-variables.md：`PI_CODING_AGENT_DIR` — "Override the config directory; default is `~/.pi/agent`"）。因此全局 AGENTS.md 实际是 `<agentDir>/AGENTS.md`。

**加载方式**（官方 usage.md / README.md，原文引用）：

> "Pi loads `AGENTS.md` (or `CLAUDE.md`) at startup from: `~/.pi/agent/AGENTS.md` for global instructions; parent directories and the current directory." … "All matching files are concatenated."

即三层：全局 `~/.pi/agent/AGENTS.md` → 从 cwd 逐级向上找父目录 → 当前目录；**所有命中的文件按顺序拼接**进入 system prompt。禁用：`--no-context-files` / `-nc`。

**源码确认**（`packages/coding-agent/src/core/resource-loader.ts`，`loadContextFileFromDir` + `loadProjectContextFiles`）：
- 每个目录按候选名取第一个命中的文件：`["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]`。
- 拼接顺序：全局文件在最前，然后祖先目录从最外层到 cwd（`unshift`），路径去重（`seenPaths`）。
- 安全文档（security.md）明确：context files 与项目信任无关——"`AGENTS.md` and `CLAUDE.md` context files are loaded regardless of project trust unless context loading is disabled."

**/reload 语义**（usage.md 交互命令表，原文）："Reload keybindings, extensions, skills, prompts, themes, and context files." 即 reload 会重载：keybindings、extensions、skills、prompts、themes、**context files**。资源发现事件 reason 为 `"reload"`（extensions.md 中 `resources_discover` 说明）。

**symlink 行为（源码推断，官方未文档化）**：`loadContextFileFromDir` 用 `existsSync()` + `statSync(filePath).isFile()` + `readFileSync(filePath, "utf-8")` 读取——三者都跟随符号链接（Node 的 statSync/readFileSync 默认 follow symlink，全程无 `lstat`、无 `isSymbolicLink` 跳过）。因此 **symlink 指向的 AGENTS.md 会被正常读取**。唯一的 realpath 逻辑是 git worktree 场景下的 shadow 去重（`canonicalizePath`，避免 `git worktree add` 的 linked worktree 与其主 repo 同一份 AGENTS.md 被加载两次）。注意去重 set `seenPaths` 用的是拼接原路径而非 canonical 路径，若两个不同路径 symlink 到同一文件，理论上可能加载两次（worktree 场景有专门兜底）。

## MCP 配置

**核心结论：Pi 官方核心无内置 MCP。** README 原文（`packages/coding-agent/README.md`）：

> "**No MCP.** Build CLI tools with READMEs (see Skills), or build an extension that adds MCP support. [Why?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)"

- settings.json **没有** `mcp` / `mcpServers` key（官方 settings 文档全表无此键）。
- MCP 是 extension 能力之一（extensions.md "What's possible" 列表含 "MCP server integration"）。
- 作者 rationale 博文：https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/ — 主张用"CLI 脚本 + README"替代 MCP server（token 开销、不可组合性）。

**社区标准方案：`pi-mcp-adapter`（第三方 extension，非官方核心）**
- 安装：`pi install npm:pi-mcp-adapter`，然后重启 Pi。（pi.dev/packages 收录，作者 nicopreme，~234.6K 下载/月。）
- 配置文件（优先级从高到低，来源：unpkg 上 pi-mcp-adapter 的 README）：
  1. `~/.config/mcp/mcp.json` — 用户级共享（首次运行自动读取）
  2. `~/.agents/mcp.json`
  3. `~/.agents/mcp/mcp.json`
  4. `~/.pi/agent/mcp.json` — Pi 全局覆盖（默认 agent 目录下）
  5. `.mcp.json` — 项目级共享（自动读取）
  6. `.pi/mcp.json` — Pi 项目覆盖
- JSON 形状（stdio）：

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

- **stdio** 支持：用 `command` + 可选 `args`（"mutually exclusive with `url` and `socket`"）。字段：`env`（支持 `${VAR}` / `$env:VAR` 插值，`!command` 取密钥）、`cwd`、`lifecycle`（默认 `lazy`，可选 `eager`/`keep-alive`/`lazy-keep-alive`）、`idleTimeout`、`requestTimeoutMs`、`directTools`、`includeTools`/`excludeTools`、`debug`、`disabled`。另有全局 `settings` 对象（`toolPrefix`、`idleTimeout`、`directTools`、`disableProxyTool`、`outputGuard`、`trace`）。
- server 默认 lazy（首次工具调用才连接），tool 元数据缓存到磁盘；统一通过单个 `mcp` proxy tool 调用。

## session-start 注入

**官方"文件式"注入机制（文档化，推荐给本 skill 使用）：**
1. **Context files**：`AGENTS.md` / `CLAUDE.md`（全局 + 祖先 + cwd，见上）在启动时注入 system prompt，源码中渲染为 `<project_instructions path="...">...</project_instructions>` 块（system-prompt.ts 的 `buildSystemPrompt`）。
2. **System prompt 文件**：`~/.pi/agent/SYSTEM.md`（全局）或 `.pi/SYSTEM.md`（项目）— "Replace the default system prompt"；`APPEND_SYSTEM.md`（同样两个位置）— "Append without replacing"。
3. **CLI**：`--system-prompt <text>` 替换默认 prompt（context files 和 skills 仍追加）；`--append-system-prompt <text>` 追加。
4. **文件参数**：`@` 前缀 = CLI 消息文件参数（`pi @prompt.md "..."`），不是 import。

**官方 extension 事件式注入（extensions.md 文档化）：**
- `session_start` — 会话启动/加载/切换时触发：`event.reason` = `"startup" | "reload" | "new" | "resume" | "fork"`，`event.previousSessionFile`（new/resume/fork 时）。
- `before_agent_start` — "Fired after user submits prompt, before agent loop. **Can inject a message and/or modify the system prompt.**" 可 return `{ message: {...}, systemPrompt: ... }`；`event.systemPromptOptions.contextFiles` 就是已加载的 AGENTS.md 列表。示例扩展 `claude-rules.ts` = "Load rules from files" 用 `on("session_start")` + `on("before_agent_start")`。
- `context` — 每次 LLM 调用前触发，可改 messages。

**注意**：官方文档中**没有** Claude Code 风格、可配置的 `hooks.json`/SessionStart 钩子文件；Pi 的注入是"context/SYSTEM/APPEND_SYSTEM 文件 + extension 事件"两条路。内部设计文档 `packages/agent/docs/hooks.md`（非用户文档）提到 `before_agent_start`、`"context"` 事件可注入消息，与上面对应。

## 其他推荐配置

**settings.json**（官方 settings.md；全局 `~/.pi/agent/settings.json`，项目 `.pi/settings.json`，项目覆盖全局、嵌套对象 deep-merge，JSON 格式——示例里有 `//` 注释，实际容忍 JSONC；资源路径：全局相对 `~/.pi/agent`，项目相对 `.pi`，支持绝对路径与 `~`，数组支持 glob 与 `!`/`+`/`-` 排除）：

- 模型：`defaultProvider`、`defaultModel`（例：`{ "defaultProvider": "anthropic", "defaultModel": "claude-sonnet-4-20250514" }`）、`defaultThinkingLevel`、`thinkingBudgets`、`enabledModels`（glob，如 `["claude-*", "gpt-4o"]`）。
- 行为：`defaultProjectTrust`（`"ask"|"always"|"never"`，仅全局）、`theme`、`externalEditor`、`uiMode`、`transport`、`compaction.{enabled,reserveTokens,keepRecentTokens}`、`retry.*`、`sessionDir`、`httpProxy`（仅全局）、`shellPath`、`npmCommand`、`quietStartup` 等。
- 资源数组：`packages`、`extensions`、`skills`、`prompts`、`themes`（在 settings 里声明要加载的资源）。
- 编辑方式：直接改 JSON 或 `/settings` 命令。

**凭据与 auth**：`~/.pi/agent/auth.json`，格式 `{ "provider": { "type": "api_key", "key": "..." } }`（0600 权限）；解析优先级 CLI `--api-key` → auth.json → 环境变量 → models.json 自定义 key。OAuth 订阅走 `/login`。信任决策存 `~/.pi/agent/trust.json`。自定义 provider 写 `~/.pi/agent/models.json`。

**环境变量**（environment-variables.md）：`PI_CODING_AGENT_DIR`（覆盖配置目录，默认 `~/.pi/agent`）、`PI_CODING_AGENT_SESSION_DIR`（会话目录，优先级低于 `--session-dir`）、`PI_CODING_AGENT=true`（子进程检测标记）、bash 工具会话注入 `PI_SESSION_ID` / `PI_SESSION_FILE` / `PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`。会话默认目录 `~/.pi/agent/sessions/`；优先级 `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > settings `sessionDir`。

**skills 目录**（skills.md）：全局 `~/.pi/agent/skills/` 与 `~/.agents/skills/`（后者忽略根级 `.md`）；项目 `.pi/skills/` 与 `.agents/skills/`（cwd 及祖先，到 git root；需项目信任后加载）。目录含 `SKILL.md` 即递归发现，`SKILL.md` frontmatter 需 `name` + `description`。可把 `"~/.claude/skills"`、`"~/.codex/skills"` 配进 settings 的 `skills` 数组复用。Pi 的 skills 无 `@import`。

## 来源汇总

- https://pi.dev/docs/latest/usage — context files 三层加载、`/reload` 语义、无内置 MCP、SYSTEM.md/APPEND_SYSTEM.md、`@` 文件参数、session 选项
- https://pi.dev/docs/latest/settings — settings.json 全部键（defaultProvider/defaultModel 等）、全局/项目合并、资源路径解析
- https://pi.dev/docs/latest/skills — skills 目录（`~/.pi/agent/skills/`、`~/.agents/skills/`、`.pi/skills/`）、SKILL.md 结构、跨 harness 复用
- https://pi.dev/docs/latest/extensions — extension 加载位置（`~/.pi/agent/extensions/*.ts`、`.pi/extensions/*.ts`）、无 MCP 配置
- https://pi.dev/docs/latest/sdk — SDK 事件流（message_start/agent_start/turn_start 等）
- https://pi.dev/docs/latest/providers — auth.json 格式、provider ID/环境变量表、解析优先级
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md — "**No MCP.**" 原文、context files 描述、settings 路径、"What's possible"（MCP server integration 属 extension 能力）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md — `PI_CODING_AGENT_DIR`（覆盖 `~/.pi/agent`）、`PI_CODING_AGENT_SESSION_DIR`、bash 会话注入变量
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts — context file 加载源码（`loadContextFileFromDir`/`loadProjectContextFiles`；`existsSync`+`statSync().isFile()`+`readFileSync` → 跟随 symlink；worktree shadow 去重用 canonicalizePath）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md — `session_start` / `before_agent_start`（可注入 message + 改 system prompt）/ `context` 事件；claude-rules.ts 示例
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md — context files 与项目信任无关
- https://www.npmjs.com/package/pi-mcp-adapter（经 unpkg README 抓取）— MCP 配置优先级、`mcpServers` JSON 形状、stdio（command+args）、lifecycle/env/工具过滤字段
- https://pi.dev/packages — 包列表（pi-mcp-adapter、context-mode 为仅有的 MCP 相关包）
- https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/ — "为什么不用 MCP" 官方 rationale
