# 执行：全项目 8 维专家评审

## 前置（Phase 1）

- [x] task 创建：`.trellis/tasks/08-05-project-review`（planning）
- [x] prd.md（范围/约束/验收）
- [x] design.md（评审方法论/专家名册/验证策略）
- [ ] **用户审阅规划 → 确认后 `task.py start`** ← 评审门禁 G0

## Checklist

### 1. 激活与基线
- [ ] `task.py start`（status → in_progress）
- [ ] 记录基线：`git rev-parse HEAD`、`git status --short`（应干净）

### 2. Phase A 发现（Workflow，8 专家并行）
- [ ] 8 维各一名专家 agent，只读审仓库，按 schema 输出 findings
- [ ] 校验：8 维全部有产出（缺失维补审）

### 3. 汇总与筛选
- [ ] 合并 8 份 findings，跨维去重（同文件同点）
- [ ] 抽出全部 P0/P1 交验证

### 4. Phase B 对抗验证（8 怀疑者）
- [ ] 每维怀疑者 attempt-to-refute 该维 P0/P1，标注 verdict
- [ ] 无法核验的 → 主循环 Read 人工核验

### 5. Phase C 综合
- [ ] 写 `report.md`（总结论 + P0/P1 清单 + P2/P3 简表 + 红线专项 + 覆盖说明 + 修复优先级）
- [ ] 报告给用户摘要

### 6. 收尾校验
- [ ] `git status` / `git diff --stat` 确认**无源码改动**
- [ ] 若评审暴露值得沉淀的规范 → 走 3.3 更新 spec（先与用户确认）
- [ ] 提交：仅任务产物（prd/design/implement/report/notes）
- [ ] `task.py finish` + 归档

## 验证命令

```bash
git status --short          # 基线 & 收尾：必须干净
git diff --stat             # 确认无源码改动
git rev-parse HEAD          # 基线 commit
bunx tsc --noEmit           # 可选：验证 agent 失败场景时核验类型
bun test                    # 可选：验证失败场景可复现
```

## 评审门禁

- **G0（规划）**：prd/design/implement 用户审阅通过才 `task.py start`。
- **G1（发现）**：8 维全部产出 findings，否则补审，不进入验证。
- **G2（验证）**：所有 P0/P1 都带 verdict（CONFIRMED/REFUTED/PLAUSIBLE），缺则补核验。
- **G3（收尾）**：`git diff` 无源码改动才 finish；报告写入 report.md。

## 风险与回滚

- 评审 agent 可能把「repo 开发层事实」误报为缺陷 → 对抗验证 + 主循环以 spec 为准绳二次判断。
- 评审可能发现大量 P2/P3 → 报告以简表呈现，重点保 P0/P1 质量。
- 本任务无代码回滚点（不改代码）；最坏情况重跑 Phase A。
