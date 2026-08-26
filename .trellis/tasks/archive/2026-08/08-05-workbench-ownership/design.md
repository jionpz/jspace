# workbench ownership 边界 — 技术设计

## 1. Ownership 语义模型（4 类）

ownership 是**每文件的升级策略**,不是目录策略。upgrade 只动 manifest 列出的文件 + 机器生成状态;不在 manifest 里的任何东西(用户预留区)永不触碰。

| ownership | 未修改+bundle前移 | 本地修改 | 缺失(被删除) | 是否阻断升级 | 归位文件 |
|---|---|---|---|---|---|
| `managed` | `update` 刷新 | `conflict`,默认阻断,`--accept-conflicts` 强制覆盖 | 重建 | 是 | (预留,暂无) |
| `seed` | `update` 刷新 | `skip` 保留(报告) | 重建 | 否 | `AGENTS.md`、`README.md`、`.claude/settings.json`、`skills/*` |
| `user` | `skip` 永不刷新 | `skip` 保留 | 依 `recreateOnMissing`:`hub.json` 重建 / `cron.json` 尊重删除 | 否 | `.jspace/hub.json`、`.jspace/cron.json` |
| machine(不在 manifest) | — | — | — | — | `marker.json`、`local.json`、`logs/`、`state/` |

关键语义变化:
- **`seed` 从"创建一次永不覆盖"改为"未改刷新、改过保留"**(对齐 Child D 对 skills 的既有意图,去 hack)。
- **`user` 是全新激活的语义**:升级对用户数据文件完全隐身。
- **`managed` 保留为逃生舱类**:当前无文件归它;`--accept-conflicts` 仍按 ownership(而非 skills 路径前缀)决定覆盖范围。

## 2. 每文件归位（`ownershipFor` 映射）

`ownershipFor` 接收 bundle key(`templates/workbench/...` 或 `skills/...`),按路径前缀返回:

```
templates/workbench/AGENTS.md                       -> seed
templates/workbench/README.md                       -> seed
templates/workbench/.gitignore                      -> seed
templates/workbench/.claude/settings.json           -> seed
templates/workbench/.jspace/hub.json                -> user
templates/workbench/.jspace/cron.json               -> user
skills/<name>/**                                    -> seed
其余(未来新增 managed 文件时)                        -> managed(默认值)
```

新增 `recreateOnMissing(rel): boolean`(同文件,`cron.json` → `false`,其余 → `true`),**不加 manifest 契约字段**,由 manifest.ts 内部路径映射表达。

## 3. `diffBundle` 变更（`application/workspace/manifest.ts`）

现逻辑对 `seed` 的"未改+bundle前移"返回 `skip`(永不刷新)——改为 `update`。对 `user`:

| 场景 | 现 action(managed) | 新 action(user) |
|---|---|---|
| 未改 + bundle前移 | `update` | `skip`(reason: `user: never refresh`) |
| 本地修改 | `conflict` | `skip`(reason: `user: local content kept`) |
| 缺失 | `create` | `recreateOnMissing ? "create" : "skip"` |
| 哈希= bundle(未改) | `no-op` | `no-op`(不变) |

`seed` 缺失仍 `create`(重建模板)。`managed` 保持现行为。`ownershipFor` 返回 `seed`/`user` 后,`diffBundle` 的 `f.ownership === "seed"` 分支改为:recorded 匹配 → `update`;未匹配 → `skip`。`user` 分支新增。

## 4. `workspaceUpgrade` 变更（`application/workspace/workspace.ts`）

- **plan 过滤**:`conflict && acceptConflicts` 的覆盖条件从 `!e.rel.startsWith("skills/")` 改为 `e.ownership === "managed"`(仅 managed 可被强制覆盖)。`user` 的 `create` 仅在 `recreateOnMissing` 时进入 plan(即 hub.json 缺失重建)。
- **冲突阻断**:`conflicts = entries.filter(conflict)` 现在只含 `managed`(seed/user 已映射为 skip),阻断逻辑不变;`--accept-conflicts` 对 seed/user 修改永远不覆盖。
- **schema 迁移前置检查**(见 §5):进入文件替换前,检查 bundle hub 模板版本 vs 已装 hub.json 版本;需迁移且无可用迁移 → fail,不触碰 hub.json。

## 5. hub schema 迁移机制（`core/registry/migrations.ts` 新增）

- 导出 `HUB_SCHEMA_VERSION = "4"` 与迁移表 `{ from: to: transform }`,当前仅 `4 → 4` 恒等(identity)。
- `upgrade` 前置步骤:读 bundle 内 `templates/workbench/.jspace/hub.json` 模板的 `version`(来自 ASSETS),与工作台 `hub.json` 的 `version` 比对;`from < to` 时按迁移表链式执行(读→迁移→写回,保留 domains/resources/projects);`from < to` 且无迁移 → fail("registry schema X→Y requires manual migration") 并**不改写文件**。
- `hub.ts` decoder 保持只接受当前版本;迁移层在 decoder 之外,负责"旧版本 → 当前版本"的写回。

## 6. gen-assets 与 bundle 再生

`scripts/gen-assets.ts` 已调用 `ownershipFor`;改映射后重跑生成,`cli/manifest.generated.ts` 的 ownership 字段随之更新(`hub.json`/`cron.json` → `user`,其余 → `seed`)。`assets.generated.ts` 内容不变。

## 7. 兼容性与行为变更

| 场景 | 旧行为 | 新行为 |
|---|---|---|
| 用户改 hub.json 后 upgrade | conflict 阻断或覆盖丢失 | 跳过,不阻断,数据保留 |
| 用户改 cron.json 后 upgrade | 同上 | 跳过 |
| 用户删 cron.json 后 upgrade | 重建默认 cron | 尊重删除,不重建 |
| 用户改 AGENTS.md/README/.claude/settings.json/skill 后 upgrade | conflict 阻断(--accept-conflicts 覆盖,除 skills) | skip 保留,不阻断 |
| `--accept-conflicts` | 覆盖所有 managed 冲突(除 skills) | 仅覆盖 `managed`(当前无文件) |
| 旧 workbench(无 journal)升级 | 全部按 managed | seed 文件未记录 → 视为本地修改? **否**——无 journal 时 `recorded` 为空,`currentSha !== bundleSha` 且无 recorded → 走 `conflict`(managed)/`skip`(seed)。seed 无 recorded 的本地差异被当作"用户修改"保留,不自动刷新 |

> 无 journal 的旧 workbench:seed 文件(AGENTS/README 等)若与 bundle 不同会显示 `skip` 保留而非刷新——这是安全默认(宁可保守保留,不静默覆盖)。全新 init 的 workbench 有 journal,行为正确。

## 8. 测试策略

- `manifest.test.ts`:ownershipFor 路径映射;recreateOnMissing;diffBundle 的 seed→update-on-unmodified、user→skip/recreate 分支。
- `workspace.test.ts`:更新既有 fixture(改 hub.json 不阻断/不覆盖;改 skill→skip;旧 fixture hub.json 缺失重建);新增 `--accept-conflicts` 只覆盖 managed;cron.json 删除不重建。
- `migrations.test.ts`(新增):v4→v4 恒等;v5 无迁移 → upgrade fail 且 hub.json 未变。
- 夹具:复用 `workspace.test.ts` 的 upgradeDeps 注入模式。
