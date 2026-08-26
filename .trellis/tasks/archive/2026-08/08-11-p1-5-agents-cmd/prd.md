# #9-06 [P1-5] AGENTS.md 命令面对齐

## Goal

AGENTS.md 命令面与真实 CLI 对齐（移除 registry、补齐 update/inbox）。

## Requirements

- 文件：根 AGENTS.md。
- :9 命令面移除不存在的 `registry`，补上 `update`、`inbox`。
- 决定 :52 registry 去留（建议统一为「domain/resource 分组」不被列入命令面）。

## Acceptance Criteria

- [ ] 命令面与真实 CLI 命令一一对应（用 `jspace --help` 类输出核对）。
- [ ] 文档 review；必要时在 README 同步。
