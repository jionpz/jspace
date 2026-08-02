# JSpace

本地工作控制平面（JWorkspace）的**开发仓库**。日常使用的 JWorkspace 由 CLI 生成到其他目录；本仓库只负责开发、验证和发布工作台模板。

## 两个概念：JSpace 与 JWorkspace

- **JSpace** —— 本仓库，设计/开发层。只维护 CLI（`cli/` TypeScript/bun 源码，`bun run build` 产出 `bin/jspace` 编译二进制）、模板（`templates/workbench/`）、skills 的源码；不安装、不作为日常使用环境，只用它生成和校验 JWorkspace。
- **JWorkspace** —— 实际使用的工作目录，由 `jspace init <目录>` 生成（编译二进制在 PATH；源码检出在仓库内 `bun run cli/main.ts`），**目录可由每个用户各自配置**（如 `~/jworkspace`、`~/ws` 等），不同用户互不干扰。产物含 `hub.json`（注册表）、`AGENTS.md`（路由）、`workspace/<domain>/`、`skills/`。日常工作和 AI 会话从这里开始。

> 术语：下文「工作台 / workbench」即 JWorkspace 的正式命名。

## 快速开始

```bash
# 在另一个目录初始化真实工作台（源码运行；或先 `bun run build` 后用编译产物）
bun run cli/main.ts init ~/jworkspace

# 校验工作台
bun run cli/main.ts doctor --dir ~/jworkspace
```

## 目录结构

- `GOAL.md` - 最终目标（North Star），所有迭代的对齐物
- `cli/` - CLI 源码（TypeScript/bun；`bin/jspace` 为 `bun run build` 编译产物）
- `templates/workbench/` - 工作台模板
- `skills/jspace-bootstrap/` - 复制进工作台的首次配置技能
- `AGENTS.md` - 开发模式操作规则

## 开发模式

本仓库默认就是开发模式。非平凡改动先走 Trellis；改完 CLI 后用临时目录做一次 `init` + `doctor` 验证。模板用 `__DEV_ROOT__` 占位符记录本仓库路径，`jspace init` 时会替换为实际绝对路径。
