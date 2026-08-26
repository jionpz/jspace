# Cursor — config research (2026-08-02)

> 说明：docs.cursor.com 已于 2026-08-02 探测时 308 重定向至 **cursor.com/docs**（旧域名所有路径均指向新站根）。以下所有事实均来自对新站实际抓取的页面原文，注明来源 URL。抓取日期：2026-08-02。

## Rules(.mdc frontmatter/globs/alwaysApply)

**存放位置（三层）**
- Project Rules：`<project>/.cursor/rules/*.mdc`，纳入 git 版本控制；必须使用 `.mdc` 扩展名——"A plain `.md` file in `.cursor/rules` is ignored by the rules system because it has no frontmatter"（纯 `.md` 无 frontmatter 会被忽略）。支持子目录（`.cursor/rules/frontend/components.mdc`），导入的远程规则落在 `.cursor/rules/imported/<repoName>/`。Cursor 按完整文件路径识别规则（同名不同目录不会冲突）。
- User Rules：全局，存于本地 Cursor 设置（Customize → Rules），跨项目生效；**只作用于 Agent (Chat)，不作用于 Inline Edit (Cmd/Ctrl+K)**。
- Team Rules：团队/企业计划，托管在 Cursor 服务器（dashboard），自动同步；free-form 文本，不支持项目规则的文件结构，但支持 glob 作用域。

**frontmatter schema（仅 3 个字段，原文）**

```markdown
---
description: "This rule provides standards for frontend components and API validation"
alwaysApply: false
---
```

| 字段 | 类型 | 作用 |
|---|---|---|
| `description` | string | "Shown to the Agent, which decides whether to pull the rule in when relevant." 智能应用时给 Agent 判断相关性 |
| `globs` | string(逗号分隔) | 文件路径模式，如 `src/**`、`**/*.ts`、`docs/**/*.md, docs/**/*.mdx`；匹配文件在上下文时自动附加 |
| `alwaysApply` | boolean | `true` → 应用到每个会话，忽略 globs 和 description |

**行为矩阵（原文表格）**
- `alwaysApply: true` — "Always included. Globs and description are ignored."
- `alwaysApply: false` + 有 `globs` — "Auto-attached when a matching file is in context."
- `alwaysApply: false` + 有 `description` 无 globs — "Agent reads the description and pulls the rule in when relevant."
- `alwaysApply: false` + 两者皆无 — "Included only when you `@`-mention the rule in chat."（如 `@my-rule`）

**加载方式与优先级**
- "When applied, rule contents are included at the start of the model context."（规则内容在模型上下文开头加载）
- 合并优先级："Rules are applied in this order: **Team Rules → Project Rules → User Rules**. All applicable rules are merged; earlier sources take precedence when guidance conflicts."
- 仅作用于 Agent (Chat)；不影响 Cursor Tab 及其他 AI 功能。
- 最佳实践：单条规则 <500 行；"Split large rules into multiple, composable rules."

## 指针式规则可行性

**可行，且是官方文档明确推荐的模式。**

- 原文（`/docs/rules`）："Can rules reference other rules or files? Yes. Use `@filename.ts` to include files in your rule's context."
- 官方明确推荐引用而非复制："Reference files instead of copying their contents—this keeps rules short and prevents them from becoming stale as code changes."（引用文件保持规则短小，且避免代码变更后规则过时）
- 文档中的示例规则即使用 `@express-service-template.ts`、`@component-template.tsx`、`@migration-template.sql` 等指针引用外部模板/示例文件。
- 帮助中心同口径："Include concrete examples or reference files with `@filename` in your rule content."
- 拆分/委派指导："Keep rules under 500 lines. Split large rules into smaller, focused files." "Each file should cover a single concern." 避免复制风格指南/常见命令，指向规范示例即可。
- 结论：**指针式规则（.mdc 正文仅引用外部文档/文件）是官方认可且被推荐的模式**，可用于把详细规范放在 repo 内文档、规则保持薄层。

## MCP(mcp.json)

**配置文件位置（两级）**
- Project：`.cursor/mcp.json` — "Create `.cursor/mcp.json` in your project for project-specific tools."
- User/global：`~/.cursor/mcp.json` — "Create `~/.cursor/mcp.json` in your home directory for tools available everywhere."

**JSON 形状（所有 server 放在 `mcpServers` 对象下）**

本地 stdio server：
```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-server"],
      "env": { "API_KEY": "value" }
    }
  }
}
```
远程 server（url 代替 command）：
```json
{
  "mcpServers": {
    "server-name": {
      "url": "http://localhost:3000/mcp",
      "headers": { "API_KEY": "value" }
    }
  }
}
```

**stdio 字段表（原文）**
- `type`（必填）：连接类型，如 `"stdio"`
- `command`（必填）：启动可执行文件的命令（`npx`/`node`/`python`/`docker`），须在 PATH 或全路径
- `args`（可选）：参数数组
- `env`（可选）：环境变量
- `envFile`（可选）：env 文件路径，"only available for STDIO servers"

**传输方式**：`stdio`（本地，Cursor 管理进程，输入为 shell 命令）、`SSE`（本地/远程，输入为 SSE endpoint URL）、`Streamable HTTP`（本地/远程，输入为 HTTP endpoint URL）。

**变量插值**（`command`/`args`/`env`/`url`/`headers` 中均可用）：`${env:NAME}`、`${userHome}`、`${workspaceFolder}`、`${workspaceFolderBasename}`、`${pathSeparator}`、`${/}`。示例：`"args": ["${workspaceFolder}/tools/mcp_server.py"]`、`"API_KEY": "${env:API_KEY}"`。

**认证**："MCP servers use environment variables for authentication." 远程 server 支持静态 OAuth `auth` 对象（`CLIENT_ID` 必填，`CLIENT_SECRET`/`scopes` 可选；省略 scopes 时从 `/.well-known/oauth-authorization-server` 发现）。OAuth 回调固定为 `https://www.cursor.com/agents/mcp/oauth/callback`（web/agents）和 `http://localhost:8787/callback`（desktop）。

**加载/管理**：可在 Customize 页开关；被禁用的 server "won't load or appear in chat"。Chat 中默认需批准后使用 MCP 工具。排障：Output 面板（Cmd+Shift+U）→ "MCP Logs"。

## session-start 注入

**Rules 本身即会话开始注入的机制（已确认）**
- "When applied, rule contents are included at the start of the model context." — 规则在会话开始时作为模型上下文前置注入。

**Hooks（脚本机制，官方支持）**
- Hooks 是"spawned processes that communicate over stdio using JSON in both directions"，在 agent 循环的既定阶段前后运行，可 "observe, block, or modify behavior"。
- 配置文件 `hooks.json`，优先级 **Enterprise → Team → Project → User**；位置：项目 `<project-root>/.cursor/hooks.json`、用户 `~/.cursor/hooks.json`（还有 MDM/团队级）。
- Schema：
```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [{ "command": "./hooks/format.sh" }]
  }
}
```
- 事件：`sessionStart`/`sessionEnd`、`preToolUse`/`postToolUse`、`beforeSubmitPrompt`、`preCompact`、`stop`、`afterFileEdit` 等；还有 app 级 `workspaceOpen`。
- **`sessionStart` 是上下文注入的关键 hook**："called when a new composer conversation is created"，输出支持：
```json
{
  "env": { "<key>": "<value>" },
  "additional_context": "<context to add to conversation>"
}
```
  其中 `additional_context` = "Additional context to add to the conversation's initial system context"（注入会话初始系统上下文）；`env` 对该会话后续所有 hook 生效。接收 `session_id`、`is_background_agent`、`composer_mode`。
- hook 脚本环境变量含 `CURSOR_PROJECT_DIR`、`CURSOR_VERSION`、`CURSOR_USER_EMAIL`、`CLAUDE_PROJECT_DIR`。
- 注意：Cloud agents 只运行 command 型 hook；`sessionStart` 等部分 hook 不在 cloud agents 中运行。

## AGENTS.md / CLAUDE.md 支持

- **支持**。帮助中心原文："Create an `AGENTS.md` file in your project root. Write instructions in plain markdown. Cursor picks it up automatically." 纯 markdown、无需 frontmatter，项目根目录或子目录均可。
- 嵌套 `AGENTS.md`："more specific instructions take precedence"（更具体的子目录指令优先于父目录）。
- **`CLAUDE.md` 同机制**："Cursor reads `CLAUDE.md` files the same way it reads `AGENTS.md`," 且 "`CLAUDE.md` files are always applied to every conversation, regardless of any `alwaysApply` frontmatter setting."（始终应用）
- 选择建议：需要控制"何时应用"时用 `.cursor/rules/` 项目规则；AGENTS.md 适合简单常驻指令。
- 旧 `.cursorrules` 已废弃，迁移方式是复制内容到新的 Always Apply 规则并删除旧文件。

## 来源汇总
- https://cursor.com/docs/rules — rules(.mdc) frontmatter（description/globs/alwaysApply）、三层存放、加载顺序（Team→Project→User）、上下文开头加载、@file 指针引用、<500 行/拆分建议
- https://cursor.com/help/customization/rules — 帮助中心：project/user/team 规则存放、AGENTS.md/CLAUDE.md 自动读取与始终应用、规则按完整路径识别、@filename 引用、.cursorrules 废弃迁移
- https://cursor.com/docs/context/mcp 与 https://cursor.com/docs/mcp — MCP：.cursor/mcp.json 与 ~/.cursor/mcp.json、mcpServers JSON 形状（command/args/env/envFile、url/headers/auth）、stdio/SSE/Streamable HTTP、变量插值
- https://cursor.com/docs/hooks — Hooks：hooks.json 分层配置、sessionStart 事件 + additional_context 注入会话初始上下文、事件列表与退出码语义
- https://cursor.com/docs/sitemap.xml — 文档站结构（docs.cursor.com → cursor.com/docs 迁移后的全部页面清单）
- https://cursor.com/docs/subagents — 子代理文件位置优先级（.cursor/ > .claude/ > .codex/；未涉规则/AGENTS.md）
