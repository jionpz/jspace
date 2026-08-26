# 开放问题攻坚（#4 + #2）— 任务记录

## 父任务集成评审（2026-08-03）

两子任务均交付、验收通过、已提交 main：

| 子任务 | 交付 | 验收 | 提交 |
|---|---|---|---|
| #4 office 深度解析（`08-03-office-deep-extract`） | 零依赖抽取器 + 深入路径 + 文档 + 协议节 | 自测 15/15；bun test 21/21；tsc 干净；真实 52期回访表端到端 query/search 双 top-1（关键数字 6988） | `31ea8e7` |
| #2 文件中心选址迁移（`08-03-filehub-migration`） | migration.md runbook + 选址决策 + GOAL 闭合 | runbook 可照做；决策已记录；assets 再生成无 pyc | `803470b` |

**互不冲突检查**：deep-extract.md（office 深入）与 migration.md（存量收编）同属 asset-ingest 参考集、互补不重叠；均复用 filing/gbrain-write 纪律、不另造第二套；filing.md excel/ppt 行、gbrain-write.md 策展纪律、SKILL.md 步骤 6/参考列表三处改动一致。

**GOAL 开放问题状态**：#1 已闭（M5）/#2 已闭（本轮）/#3 无头运维仍开放（不在本轮范围）/#4 已闭（本轮）。

## 遗留 / 待办

- 开放问题 #3（无头执行的运维：账号/配额、失败通知落地）——下一轮候选。
- 真实迁移、语料增长后复跑 MEMORY-ACCEPTANCE——随真实使用。
- 本轮中 gbrain 锁经历：serve 退出→陈旧锁→CLI 窗口；后又见新 serve 持锁——与 M4 记忆一致，非异常。
