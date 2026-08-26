# 文件中心选址与存量迁移：runbook + 决策记录

## Goal

GOAL 开放问题 #2：确定 filehub 根位置与存量收编策略，产出可复用的存量迁移 runbook，落地选址/迁移决策记录并更新 GOAL.md，闭合开放问题 #2。

## Requirements

- **选址决策记录**（**已决策 2026-08-03**）：
  - **根位置：保持本地盘** `/Users/jionpz/filehub`（每机一个根，已注册进 `jspace-work` hub.json；不迁到网盘/iCloud）。
  - **同步策略**：内容同步走网盘/Obsidian Sync（重资产不进工作台 git）；根目录本身可由网盘同步或暂不同步；换机按「目标机根 + rel_path」重解析。
  - 决策 + 理由写入 GOAL.md（开放问题 #2 状态 → 闭合）。
- **存量收编 runbook**（**只出文档、本轮不实际迁移**——已决策）：
  - 新增 `skills/asset-ingest/references/migration.md`：增量收编（新走 inbox，旧按项目/领域按需）；步骤复用 asset-ingest 纪律（分类/命名/查重/归位/入脑/登记/自检），不另造流程。
- 遵守纪律：重资产不进工作台 git、失败即停、改动 skills/ 后重跑 gen-assets + build。

## Acceptance Criteria

- [ ] 决策已定并记录：GOAL.md 开放问题 #2 更新为闭合（注明根位置=本地盘 + 同步策略 + 增量收编结论）。
- [ ] `references/migration.md` 就位，与 asset-ingest 纪律一致、无冲突，流程可照做（含：何时用 / 步骤 / 增量 vs 一次性分界 / 决策记录）。
- [ ] runbook 引用 filing/gbrain-write/batch 既有纪律，不重复维护第二套。
- [ ] 改动 skills/ 后重跑 gen-assets + build，编译产物同步。
- [ ] （真实迁移验证留到真实使用时代入 runbook——本轮不做，理由：机器上无零散存量素材。）

## Notes

- 现状（2026-08-03 研究）：filehub 根已注册为 `/Users/jionpz/filehub`（`jspace-work` hub.json，type=filehub/primary）；已有真实语料：`projects/报表模块/`、`areas/周报/`、`areas/机器学习/`；`_inbox` 为空；`~/filehub-b` 是 M5 双机演练副本。`~/filehub` 为独立顶层目录，**当前未被任何网盘/iCloud 同步**（iCloud Drive 存在但不在其中）；`~/Documents`/`~/Desktop` 无零散存量素材。
- 分叉点已决策：#2-1 保持本地盘；#2-2 只出 runbook 不迁移。
