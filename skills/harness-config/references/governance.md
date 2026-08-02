# Governance 文档参考(`~/.agents/agents.md` 骨架模板)

> **命名澄清**:本文所有 `~/.agents` 指 **用户根目录** 下的全局治理目录(`$HOME/.agents`),与任何项目级 `.agents/` 目录(Trellis skills 等)是不同位置。写文档与接线时务必区分。

## 1. 本文件是什么

- **`~/.agents/agents.md` = 所有 AI harness 的单一事实源(治理层)**。Pi / Claude Code / Codex / Cursor 通过各自的全局入口(symlink / @import / .mdc 指针规则)读取它。
- 只放 **harness 无关** 的静态治理规则;MCP、hooks、session 注入等 **会话级** 配置留在各 harness 自己的目录。
- 记忆在 **gbrain**,规则在 **本文件**:事实 / 资产指针进 gbrain,规则与红线进本文件。
- 工作台 `AGENTS.md` 是 **路由层**(域路由 + 资源治理),在其上;本文件不重复其路由细节。

## 2. 内容分层表

| 放(harness 无关,写进本文件) | 不放(会话级,留各 harness 目录) |
|---|---|
| 安全 / 隐私红线 | MCP server 配置(`gbrain serve` 等) |
| 通用规范(默认中文等) | SessionStart hooks / 注入 |
| 工作台入口路由骨架 | 模型 / provider 设置 |
| 与 gbrain 的分工声明 | 域路由细节(那是工作台 `AGENTS.md` 的事) |
| 维护约定(单源) | 各 harness 专属语法 / 特性 |

## 3. 骨架模板(可直接复制为 `~/.agents/agents.md`)

```markdown
# 全局治理文档(用户根目录 ~/.agents)

> 本文件是**所有 AI harness 的单一事实源**。各 harness 通过 symlink / @import / 指针规则读取本文件。
> 维护约定:只编辑本文件;各 harness 入口只读 / 写回本文件,不要在入口处维护内容。

## 1. 定位
- 本文件 = harness 无关的静态治理层,约束所有 AI 会话(Pi / Claude Code / Codex / Cursor)。
- 记忆在 gbrain,规则在此文档:事实与资产指针进 gbrain,规则与红线进本文件。
- 工作台 `AGENTS.md` 是路由层(域路由 + 资源治理),在其上;本文件不重复其细节。

## 2. 安全与隐私红线
- 未经确认不执行破坏性操作(删除 / 覆盖 / 推送)。
- 不在会话中粘贴完整密钥 / 令牌;敏感配置走密钥管理。
- 向外部服务发送内容前先确认。
- <!-- 按需补充更多红线 -->

## 3. 通用规范(默认中文)
- 默认使用中文交流与写作;代码、命令、技术术语保留英文原文。
- 遵守项目级 `AGENTS.md` / `CLAUDE.md` 与本文件的层级关系(本项目 > 本文件)。
- <!-- 按需补充更多通用规范 -->

## 4. 工作台入口路由
- 说明如何找到 / 进入当前工作台(如 `jspace` 注册表 / 工作台路径 / 入口命令)。
- <!-- 按实际填写 -->

## 5. 维护约定
- 单一事实源:只编辑本文件,编辑即对所有 harness 生效。
- harness 接线(symlink / @import / .mdc 指针)由 `harness-config` skill 维护,
  接线细节见该 skill 的 `references/harnesses.md`。
```

## 4. 修改与回滚

- 改治理规则:编辑 `~/.agents/agents.md`(symlink 入口自动跟随,无需动各 harness 文件)。
- 接线动作(建 / 删 symlink、.mdc 指针)见 `references/harnesses.md`;撤销接线即删对应入口文件并可选删除 `~/.agents`。
- 若某 harness 原本有非空全局文件,不覆盖:内容并入本文件,或保留原文件 + 追加 import / 接线行(见 harnesses.md 对应节)。

## 5. 自包含约束

- 本参考只描述 `~/.agents/agents.md` 的内容与维护;不含任何本仓库相对路径引用,可随 skill 独立分发。
