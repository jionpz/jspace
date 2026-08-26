# workbench ownership 边界 — 执行计划

## 前置

- 分支:feature 分支(不在 main 直接改)。任务状态 `in_progress` 后开始。
- 每次改完 `bun test` 全绿再进入下一步。

## Checklist

### 1. manifest.ts — ownership 映射 + seed/user 语义 ✅
- [x] `ownershipFor` 改为按路径前缀映射:`templates/workbench/AGENTS.md|README.md|.gitignore|.claude/settings.json` → `seed`;`templates/workbench/.jspace/hub.json|cron.json` → `user`;`skills/*` → `seed`;其余默认 `managed`。
- [x] 新增 `recreateOnMissing(rel): boolean`(默认 true;`.jspace/cron.json` → false)。
- [x] `diffBundle`:`seed` recorded 匹配 → `update`(原 `skip`);`user` 分支:未改+前移 → `skip`、修改 → `skip`、缺失 → `recreateOnMissing ? create : skip`。
- [x] 更新文件头注释(ownership 语义说明)。

### 2. workspace.ts — upgrade plan 与阻断策略 ✅
- [x] plan 过滤:`conflict && acceptConflicts` 条件 `!e.rel.startsWith("skills/")` → `e.ownership === "managed"`。
- [x] `user` 的 `create` 仅 `recreateOnMissing` 时进 plan(缺失 cron → skip,不进 plan)。
- [x] schema 迁移前置检查接入(见 step 3)。
- [x] 更新注释说明 `--accept-conflicts` 现仅作用于 `managed`。

### 3. migrations.ts(新增)— hub schema 迁移机制 ✅
- [x] `core/registry/migrations.ts`:`HUB_SCHEMA_VERSION="4"`、迁移表(空,`4→4` 恒等)、`migrateHubSchema(raw, from, to, registered?)`(返回 `unchanged|migrated|no-migration`)。`registered` 可注入;`UpgradeDeps.migrations` 透传,使 migrated 写入路径可测。
- [x] upgrade 前置 `planHubMigration`:比对 bundle 模板 hub 版本 vs 已装版本;`from<to` 无迁移 → fail 且不写文件;`from==to` → 跳过;`migrated` → plan 加 `migrate` 步骤(备份 + journal + 写回迁移文档)。

### 3.5 额外修复 — 材料化 journal 的"保留基线"缺陷 ✅
- [x] 发现并修复 seed 潜藏 bug:被保留的用户修改被 `writeActualMaterializedJournal` 记成已应用基线,下一次升级把它当"未修改"刷新掉(clobber)。新增 `writeUpdatedMaterializedJournal(root, manifest, appliedRels)`:只更新本次实际写入的文件,保留文件维持原基线;无前录的未知来源文件保持未记录(永久保留)。apply 与 rollback 均改用之。

### 4. 测试 ✅
- [x] `manifest.test.ts`:更新 ownershipFor 断言;新增 recreateOnMissing、seed→update-on-unmodified、user→skip/recreate 用例。
- [x] `workspace.test.ts`:改 hub.json 不阻断不覆盖;改 skill → skip(原 conflict 断言更新);删 cron.json 不重建;删 hub.json 重建;`--accept-conflicts` 仅覆盖 managed(合成 bundle);seed 编辑跨多次升级保留(回归 bug);migration no-migration fail + migrated 写回。
- [x] `migrations.test.ts`(新增):v4→v4 恒等;v5 无迁移 → no-migration;单步/链式迁移;链断 → no-migration。
- [x] `cli/init.test.ts`、`assets-reachability.test.ts` 不受影响(全套 267 pass)。

### 5. 文档 ✅
- [x] `templates/workbench/README.md` 新增「目录边界与升级范围」章节(seed/user/machine 分类 + 用户预留区声明 + diff 判断法)。
- [x] `templates/workbench/AGENTS.md` 新增「Workspace Upgrade & Ownership」简短说明(指向 README)。

### 6. 再生与验证 ✅
- [x] `bun run scripts/gen-assets.ts` 再生;ownership 字段正确(hub/cron=user,AGENTS/README/.claude/.gitignore/skills=seed,filehub=managed)。
- [x] `bun test` 全绿(267 pass / 0 fail);`bun build ./cli/main.ts` 全图编译通过。
- [x] 端到端冒烟:init → 改 AGENTS/README/skill/hub、删 cron → `workspace diff` 全 `skip`;`upgrade` 不阻断、不覆盖、不复活 cron;删 hub → upgrade 重建空注册表;二次 upgrade 幂等;doctor 通过。
- [x] gen-assets 二次运行幂等(`git diff cli/` 不变)。

### 7. review gate
- [x] self-review diff(ownership 语义 + 冲突策略 + 迁移机制 + journal 基线修复)。
- [ ] `trellis-check` 或按项目 check 流程过一遍后提交。

## 验证命令

```bash
bun test
bun run scripts/gen-assets.ts && git diff --stat
# 端到端冒烟(临时目录)
J=$(mktemp -d); bin/jspace init "$J" --dir-demo 2>/dev/null || bun run cli/main.ts init "$J"
bun run cli/main.ts workspace diff "$J" --json
```

## 回滚点

- 每步提交可独立回退;upgrade 本身有 journal + `--rollback` 兜底。
- 若迁移机制复杂度超预期,可先落地 ownership 核心(step 1/2/4/5/6),migration 机制(step 3)降级为"设计留档 + 版本比对 fail 保护",单独后续。
