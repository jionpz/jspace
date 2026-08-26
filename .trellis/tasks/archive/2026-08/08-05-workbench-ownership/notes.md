# 实现笔记

## 2026-08-05 — ownership 边界落地

- **三态所有权落地**:`managed`(预留,当前无文件)/ `seed`(模板:未改刷新、改过保留、非阻断)/ `user`(数据:升级永不动)。`ownershipFor` 路径前缀映射 + `recreateOnMissing`。
- **hub.json/cron.json 归 user**:修复原 footgun——用户改注册表/cron 后 upgrade 报 conflict 阻断或 `--accept-conflicts` 覆盖丢数据。现在 user 文件升级完全隐身;hub.json 缺失重建空注册表(恢复),cron.json 删除尊重(不复活)。
- **AGENTS.md/README/.claude/skills 归 seed**:未修改随升级刷新,改过保留且不阻断升级。`--accept-conflicts` 现在只作用于预留的 managed 类。
- **发现并修复潜藏 bug**:材料化 journal 把"被保留的用户修改"记成已应用基线 → 下一次升级当"未修改"刷新掉(混合升级场景复现:第一次保留、第二次覆盖)。修复 = `writeUpdatedMaterializedJournal` 只更新本次实际写入的文件,保留文件维持原基线。
- **hub schema 迁移机制**:`core/registry/migrations.ts`(`migrateHubSchema` 链式迁移,`registered` 可注入)。upgrade 前置 `planHubMigration`:`from<to` 无迁移 → fail 不碰文件;有迁移 → plan 加 migrate 步骤(备份+journal+写回)。真正的 v4→v5 变换等有 v5 再注册。
- **文档**:README「目录边界与升级范围」+ AGENTS「Workspace Upgrade & Ownership」。
- **验证**:267 tests 全绿;CLI 冒烟(init/diff/upgrade/doctor + 删 hub 重建 + 删 cron 不复活)通过;gen-assets 幂等。

## 决策记录

- cron.json 删除即"无 cron"意图,升级不重建 → `recreateOnMissing=false`(与 hub 的恢复重建区别)。
- `managed` 当前无归位文件:它是"用户明确授权可强制覆盖"的逃生舱类,保留枚举+升级逻辑作能力。
- 无 journal 旧工作台:seed 文件与 bundle 不同 → 按未知来源保留(安全默认),不会静默刷新。
