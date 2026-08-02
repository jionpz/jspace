# JSpace Workbench

本目录由 JSpace 开发仓库的 `bin/jspace init` 生成，是日常工作的控制平面；它不是 JSpace 开发仓库。

## 结构

- `hub.json` - domain/resource 注册表
- `AGENTS.md` - 工作模式操作规则
- `workspace/jspace-dev/` - 指向 JSpace 开发仓库的 domain
- `workspace/agent-infra/` - AI 资源管理 domain
- `skills/jspace-bootstrap/` - 首次配置技能
- `skills/asset-ingest/` - 资料转知识资产技能
- `.jspace.json` - 初始化标记

## 使用

1. 先读 `AGENTS.md`。
2. 首次使用按 `skills/jspace-bootstrap/SKILL.md` 配置 gbrain 与所选 AI harness。
3. 用 JSpace 开发仓库的 CLI 校验本目录：

```bash
__DEV_ROOT__/bin/jspace doctor --dir .
```

## 与开发仓库的关系

- 开发仓库：`__DEV_ROOT__`
- 开发模式：去开发仓库修改 CLI、模板或技能，再重新初始化或同步本目录。

## 任务管理

本工作台不内置任务管理。如需任务管理，可在工作台运行 `trellis init` 初始化。
