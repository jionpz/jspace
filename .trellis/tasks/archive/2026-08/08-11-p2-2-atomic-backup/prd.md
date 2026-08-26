# #9-08 [P2-2] 备份原子写

## Goal

回滚/force 覆盖前备份写统一走 writeBytesAtomic（同一原子写红线）。

## Requirements

- 文件：`application/workspace/workspace.ts:282`、`init.ts:73`。
- 备份写统一走 writeBytesAtomic。

## Acceptance Criteria

- [ ] 现有 workspace/init 测试不变（不破坏行为）。
- [ ] 可选：加注入时钟/权限故障模拟。
