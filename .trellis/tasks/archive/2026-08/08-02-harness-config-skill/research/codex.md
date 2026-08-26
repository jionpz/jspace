# Codex — config research (2026-08-02)

> 官方文档现托管在 **learn.chatgpt.com/codex**（`developers.openai.com/codex` 已 308 重定向到 `learn.chatgpt.com/docs`）。GitHub `openai/codex` 仓库 `docs/agents_md.md` 与 `docs/config.md` 已瘦身为「见外部文档」的占位页，正文只在 learn.chatgpt.com。源码证据来自 `openai/codex` main 分支 `codex-rs/core/src/agents_md.rs`、`agents_md_manager.rs`。

## 全局 AGENTS.md

**支持用户级全局 AGENTS.md：`~/.codex/AGENTS.md`（或 `CODEX_HOME` 指向的目录）。**

文档原文（AGENTS.md 页）：
- 两个作用域：global scope（Codex home 目录）+ project scope。
- 「Codex reads `AGENTS.override.md` if it exists. Otherwise, Codex reads `AGENTS.md`.」（在 home 目录层级）
- 「Codex uses only the first non-empty file at this level.」
- 示例：创建 `~/.codex/AGENTS.md` 放可复用偏好，任意目录运行 `codex --ask-for-approval never "Summarize the current instructions."` 验证全局文件被加载。

**优先级（global vs project）：**
- 顺序为 global scope 先，project scope 后；最终提示为从 root 向下拼接，靠后的覆盖靠前的。
- 文档原文：「Codex concatenates files from the root down, joining them with blank lines.」「Files closer to your current directory override earlier guidance because they appear later in the combined prompt.」
- project scope：从项目根（通常 git root）向下走到当前工作目录，每层只取一个文件（override > AGENTS.md > `project_doc_fallback_filenames` 回退名）。
- 「Codex stops searching once it reaches your current directory」；不越过项目根（源码 doc comment：「We do **not** walk past the project root.」）。
- 文档示例输出确认顺序：global 文件第一、repo root AGENTS.md 第二、override 最后。

**Symlink：支持。**
- 源码证据（`agents_md.rs` 的 `agents_md_paths` doc comment，原文）：「Discovers AGENTS.md files from the project root to the current working directory, inclusive. Symlinks are allowed.」
- 读取用 `fs::read_file`（默认跟随 symlink），无 canonicalize 限制。因此 `~/.codex/AGENTS.md` 与项目 AGENTS.md 均可做成 symlink 指向外部文件。
- 注意：官方文档页本身未提 symlink，此结论来自源码，属于实现级事实。

## config.toml(MCP/hooks)

**位置**（config reference / config basics 页）：
- 用户级：`~/.codex/config.toml`
- 项目级：`<repo>/.codex/config.toml`（仅受信任项目加载；不可覆盖 `model_provider`/`model_providers`/`notify`/`profiles`/`otel` 等键）
- 系统级：`/etc/codex/config.toml`（Unix）
- 加载优先级（高到低）：CLI flags/`--config` > 项目 config（root 到 cwd，最近者胜）> `--profile` 文件 > 用户 config > 系统 config > 内置默认。

**顶层键：**
- `model` — 模型名（如 `gpt-5.5`）
- `model_provider` — 来自 `model_providers` 的 provider id（默认 `openai`）
- `model_providers.<id>` — 自定义 provider（`base_url`、`env_key`、`wire_api` = `"responses"`、`http_headers`、`auth` 等）；内建 id（openai/ollama/lmstudio）保留不可覆盖
- `approval_policy`、`sandbox_mode`、`model_reasoning_effort`、`personality`、`log_dir`、`model_catalog_json`、`model_instructions_file` 等

**MCP server（当前文档形态）** — `[mcp_servers.<name>]` 表，stdio 用 `command`+`args`：
```toml
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env_vars = ["LOCAL_TOKEN"]

[mcp_servers.context7.env]
MY_ENV_VAR = "MY_ENV_VALUE"
```
- stdio 键：`command`（必填）、`args`、`env`/`env_vars`、`cwd`、`experimental_environment`
- HTTP 键：`url`（必填）、`auth`、`bearer_token_env_var`、`http_headers`、`env_http_headers`
- 通用：`enabled`、`required`（true 则启动失败时中断）、`startup_timeout_sec`（默认 10s）、`tool_timeout_sec`（默认 60s）、`enabled_tools`、`disabled_tools`、`default_tools_approval_mode`、per-tool `tools.<tool>.approval_mode`
- CLI 等价：`codex mcp add <name> --env VAR=VALUE ... -- <stdio command>`
- 「The ChatGPT desktop app, Codex CLI, and IDE extension share this configuration.」

**Hooks 开关** — `[features]` 表：
```toml
[features]
hooks = true   # 默认即 true（Stable）；false 关闭
memories = true   # 默认 off
```
- 文档原文：「Enable lifecycle hooks loaded from `hooks.json` or inline `[hooks]` config.」以 `hooks` 为 canonical feature key。

## session-start 注入

**机制：SessionStart hook（命令式）——通过 `hooks.json` 或 config.toml 内联 `[hooks]`。**

- 发现位置（hooks 页）：`~/.codex/hooks.json`、`~/.codex/config.toml`、`<repo>/.codex/hooks.json`、`<repo>/.codex/config.toml`（多源会合并，非替换；项目级仅受信任项目加载）。
- 事件：`SessionStart` 是受支持事件，在 session 或 subagent 启动时触发；`matcher` 应用于 `source`（`startup`/`resume`/`clear`/`compact`）。
- 输出：stdout 纯文本或 `hookSpecificOutput.additionalContext` 会作为额外 developer context 注入；`additionalContextLimit`（默认约 2500 token）控制溢写阈值；`continue: false` 可终止该轮。
- 官方示例（`~/.codex/hooks.json`）：
```json
"SessionStart": [
  {
    "matcher": "startup|resume",
    "hooks": [
      {
        "type": "command",
        "command": "python3 ~/.codex/hooks/session_start.py",
        "statusMessage": "Loading session notes",
        "additionalContextLimit": 5000
      }
    ]
  }
]
```
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Load the workspace conventions before editing."
  }
}
```
- 内联 `[hooks]` 表与 hooks.json 同一套事件 schema（config reference 提到 `[hooks.PreToolUse]` matcher group + `.hooks` 数组；event 含 `SessionStart`、`SessionEnd`、`PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`Stop` 等）。当前仅 command 型 handler 生效。
- 另有内置的 AGENTS.md 首轮注入（「includes a limited amount of project guidance in the first turn of a session」，`project_doc_max_bytes`/`project_doc_fallback_filenames` 可调）以及 Memories 注入（见下）。

**Memories（补充的会话开始注入）：**
- `~/.codex/memories/` 存记忆文件；`[features] memories = true` 开启（默认 off）。
- `memories.use_memories` 控制「injects existing memories into future sessions」。
- 文档建议：团队必需规则放 AGENTS.md / 检入库文档，memories 只是 recall 层。

## 0 字节 AGENTS.md

**Codex 不会创建占位 AGENTS.md；空文件会被忽略/跳过。**

- 文档（AGENTS.md 页）：「Codex skips empty files」「Ensure instruction files contain content; Codex ignores empty files.」troubleshooting 节。
- 源码（`agents_md.rs`）：`read_agents_md` 中 `if !text.trim().is_empty() { ... }` 才采用；`new_user` 对纯空白输入直接 `return Self::default()`。
- 源码：`agents_md.rs` / `agents_md_manager.rs` 只有 `fs.read_file` / `get_metadata`，**无任何写文件/创建占位逻辑**。
- 全局层语义上等同：「Codex uses only the first non-empty file at this level」——空 AGENTS.override.md 会被跳过。

## 其他：把全局 context 指向外部文件

- **AGENTS.md symlink**：源码明确「Symlinks are allowed」；`~/.codex/AGENTS.md` 或项目 AGENTS.md 均可用 symlink 指到外部/共享文件（如 dotfiles 管理的 `~/.codex/AGENTS.md -> ~/dotfiles/codex/AGENTS.md`）。这是官方文档未明说、但实现支持的做法。
- **`model_instructions_file`** config 键：引用外部指令文件路径（config advanced 页提到；项目 config 内相对路径相对 `.codex/` 目录解析）。
- **`project_doc_fallback_filenames`**：某层缺 AGENTS.md 时追加尝试的文件名。
- **SessionStart hook** 是「运行脚本产出上下文」的注入通道（见上），常配合 symlink 的外部说明文件由脚本读取。
- 没有 `@import` 之类指令（config advanced 页无任何 include/import 语法）。
- 验证加载情况的命令：`codex --ask-for-approval never "Summarize the current instructions."`（文档示例）。

## 来源汇总
- https://learn.chatgpt.com/codex/agent-configuration/agents-md — AGENTS.md 全局/项目作用域、优先级合并、空文件跳过（注意：`developers.openai.com/codex/guides/agents-md` 是同一文档的旧地址）
- https://learn.chatgpt.com/codex/config-file/config-reference — config.toml 键：model/model_provider、[mcp_servers]、[features]、[hooks] 语义与文件位置
- https://learn.chatgpt.com/codex/config-file/config-basic — 配置文件层级与优先级、[features] 开关方式
- https://learn.chatgpt.com/codex/config-file/config-advanced — 内联 [hooks]、model_instructions_file、project_doc_fallback_filenames；无 @import
- https://learn.chatgpt.com/codex/extend/mcp — MCP server TOML 形态（command+args）、CLI `codex mcp add`、全局/项目范围
- https://learn.chatgpt.com/codex/hooks — hooks 发现位置（~/.codex/hooks.json 等）、SessionStart 事件、additionalContext 注入、官方 hooks.json 示例
- https://learn.chatgpt.com/codex/customization/memories — Memories（~/.codex/memories/、features.memories、use_memories）
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md.rs — 「Symlinks are allowed」、空文件跳过、无创建逻辑
- https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/agents_md_manager.rs — 用户指令空文本过滤、缓存
- https://github.com/openai/codex/blob/main/README.md — README 无配置细节，仅指向外部文档
- https://raw.githubusercontent.com/openai/codex/main/docs/agents_md.md / docs/config.md — GitHub 侧已改为指向 learn.chatgpt.com 的占位页
