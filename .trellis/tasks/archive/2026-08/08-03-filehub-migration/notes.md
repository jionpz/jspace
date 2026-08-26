# 文件中心选址与存量迁移 — 任务记录

## 交付物

- `skills/asset-ingest/references/migration.md` — 存量收编 runbook（新增）。
- `skills/asset-ingest/SKILL.md` — 参考列表 + migration.md 条目。
- `GOAL.md` — 开放问题 #2 闭合（根=本地盘 + 同步策略 + 增量收编）；#4 一并标记闭合。
- `cli/assets.generated.ts` — 再生成（含 migration.md，无 pyc）。

## 决策记录（2026-08-03）

- **#2-1 根位置**：保持本地盘 `/Users/jionpz/filehub`（已注册 hub.json）。理由：现状已用、已有语料；迁网盘/iCloud 有搬迁风险；M5 已证换机可重建记忆层、指针 rel_path 可移植，资产层同步可选做。
- **同步策略**：内容走网盘/Obsidian Sync（重资产不进工作台 git）；根目录本身可由网盘同步或暂不同步。
- **#2-2 存量收编**：增量、按需（新走 inbox，旧按项目/领域收编）。**本轮不实际迁移**——机器上无零散存量素材（Documents/Desktop 干净，Downloads 仅有刚用的 xlsx）；真实使用时代入 runbook 验证。
- 开放问题 #4（office 解析深度）随 #4 子任务交付一并闭合。

## 环境事实

- `~/filehub` 是独立顶层目录，**未被任何网盘/iCloud 同步**（iCloud Drive 存在但不在其中）。
- 报表模块「30GB 存量」是工作项目的数据迁移议题，非本机 filehub 内容（`~/filehub/projects/报表模块/` 仅 8KB）。

## 验收

- assets 再生成含 migration.md、无 pyc；`bun test` 21/21；`tsc` 干净；build 成功。
- 验收以「runbook 可照做 + 决策已记录」为准（本轮无真实迁移）。
