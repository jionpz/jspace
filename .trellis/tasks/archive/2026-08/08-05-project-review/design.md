# 设计：全项目 8 维专家评审

## 评审方法论

三阶段工作流（Workflow 工具，多 agent 编排）：

```
Phase A 发现（8 名专家并行，结构化输出）
   ↓
Phase B 对抗验证（逐维怀疑者 attempt-to-refute，仅验证 P0/P1）
   ↓
Phase C 综合（主循环完成：去重 → 定级 → report.md）
```

评审原则：

- **只读**：所有 agent 仅读取与分析，禁止 Edit/Write/执行真实副作用。
- **证据驱动**：findings 必须带 `file:line` + 引用片段 + 失败场景；无证据不立案。
- **对抗验证**：P0/P1 一律经独立怀疑者尝试推翻（核验行号、构造反例、查前置条件），避免「看起来对但错」的假阳性。
- **对齐基准**：以 `.trellis/spec/backend/` 声明的约定为准绳检查代码一致性；不一致记入报告，不改动。

## Phase A：发现（8 专家）

| # | 维度 | agentType | 关注点（提示词注入） |
|---|------|-----------|---------------------|
| 1 | 架构分层 | `everything-claude-code:architect` | 层依赖单向性、application 禁 import cli、core 纯净性、重复/无效抽象、测试分层 |
| 2 | 正确性/边界 | `everything-claude-code:typescript-reviewer` | 类型安全、async 竞态、null/空、错误路径、CmdResult/fail 约定 |
| 3 | 安全红线 | `everything-claude-code:security-reviewer` | 密钥泄漏、路径注入/traversal、破坏性操作（rm/覆盖/推送）防护、网络出口、远程代码执行、日志敏感字段 |
| 4 | 测试质量 | `everything-claude-code:code-reviewer` | 覆盖缺口、弱断言、测试隔离（不碰真实 home/cron/filehub）、纯测试 vs 集成 |
| 5 | 数据一致性 | `everything-claude-code:typescript-reviewer` | journal 原子写/补偿、pending envelope、迁移幂等与 schema 版本、ownership 三态、cron 幂等与升级保护 |
| 6 | 跨平台 | `general-purpose` | scheduler darwin/linux/win32 契约一致、路径/shell/PATH 差异、CI 6 平台脚本 |
| 7 | CLI·UX·文档 | `general-purpose` | 命令面一致性、错误信息可读性、README/docs/模板/帮助文本与实现漂移 |
| 8 | 发布分发 | `everything-claude-code:typescript-reviewer` | version.generated 同步、gen-assets 确定性、build 产物、install 下载/校验/回滚 |

**findings schema**：

```json
{
  "findings": [{
    "dimension": 1, "severity": "P0|P1|P2|P3",
    "file": "path/to/file.ts", "line": 42,
    "title": "一句话标题", "summary": "缺陷描述",
    "evidence": "引用片段(与文件原文一致)",
    "failure_scenario": "具体输入/状态 → 错误输出/崩溃",
    "suggested_fix": "修复方向(不执行)"
  }],
  "coverage_notes": "审了什么、用什么方法、哪些无法验证"
}
```

## Phase B：对抗验证（8 怀疑者）

每维一名怀疑者 agent 收到该维全部 P0/P1 findings，逐条 **attempt-to-refute**：

- 行号与引用片段是否真实存在（Read 核验）
- 前置条件是否真被违反；能否构造反例
- 不确定即标 `PLAUSIBLE`（不吞不吹）
- 输出 verdict：`CONFIRMED / REFUTED / PLAUSIBLE` + 一句话理由

## Phase C：综合（主循环内）

- 跨维度去重：同文件同点合并，严重度取 max，备注跨维视角。
- 定级：P0（阻断/高危）> P1（重要）> P2（一般）> P3（建议）。
- 输出 `.trellis/tasks/08-05-project-review/report.md`：
  1. 总结论（健康度一句话 + 关键风险）
  2. P0/P1 清单（含验证 verdict）
  3. P2/P3 清单（简表）
  4. 红线冲突专项
  5. 每维覆盖说明与未验证项
  6. 修复优先级建议（分批：立即/近期/规划）

## 失败兜底

- 某维专家返回空/异常 → 该维补一次重试；仍空则该维标「未覆盖」进报告。
- 验证 agent 对某条无法核验 → 主循环人工核验（Read 定位）后定 verdict。
