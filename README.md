# JSpace

本地工作控制平面的开发仓库。日常使用的工作台由 CLI 生成到其他目录；本仓库只负责开发、验证和发布工作台模板。

## 快速开始

```bash
# 在另一个目录初始化真实工作台
/Users/jionpz/mycode/jspace/bin/jspace init ~/jworkspace

# 校验工作台
/Users/jionpz/mycode/jspace/bin/jspace doctor --dir ~/jworkspace
```

## 目录结构

- `GOAL.md` - 最终目标（North Star），所有迭代的对齐物
- `bin/jspace` - CLI（`init` / `doctor`）
- `templates/workbench/` - 工作台模板
- `skills/jspace-bootstrap/` - 复制进工作台的首次配置技能
- `AGENTS.md` - 开发模式操作规则

## 开发模式

本仓库默认就是开发模式。非平凡改动先走 Trellis；改完 CLI 后用临时目录做一次 `init` + `doctor` 验证。模板用 `__DEV_ROOT__` 占位符记录本仓库路径，`jspace init` 时会替换为实际绝对路径。
