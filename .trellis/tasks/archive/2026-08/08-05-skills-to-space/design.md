# Design — 官方 skill 移入 .jspace/skills/

> **决策修订(v1.0.8 覆盖 v1.0.7)**:最初物化到 `.space/skills/`(独立隐藏目录)已随 v1.0.7 发布。用户纠正——应复用现有 `.jspace/` 而非另起 `.space`。所有权是**逐文件**(bundle key 前缀 → seed/user),与目录无关,`.jspace/skills/`(seed)与 `.jspace/hub.json`/`cron.json`(user)共存无技术冲突;复用 `.jspace/` 避免新增顶层点目录、机器管理内容归一。本版映射改 `.jspace/skills/`,发布 v1.0.8。

## D1 物料化映射:改映射,不改 bundle key

官方 skill 在内嵌 bundle 里的 key 保持 `skills/<name>/...`(gen-assets `SOURCES` 与 `walk` baseRel 不变)。核心改动收敛到两个「key → 工作台路径」映射点:

- `application/workspace/manifest.ts` → `materializedRel(key)`:`skills/<name>/...` 分支返回 `.jspace/skills/<name>/...`;`templates/workbench/` 分支不变。
- `cli/embed.ts` → `materializeTree()`:`skills/` 分支由 `rel = key` 改为 `.jspace/skills/` 前缀(统一用 `/` 拼接,`mkdirSync(dirname(out), recursive)` 已覆盖嵌套创建)。

`ownershipFor(key)` 仍按 bundle key `skills/` 前缀判 `seed`,**不变**。

收益:gen-assets、`cli/assets.generated.ts` / `manifest.generated.ts` 的 key、`cli/assets-reachability.test.ts` 与 `cli/lifecycle-and-safety.test.ts`(都断言 bundle key `skills/...`)全部零改动;只有物料化映射这一个语义点变化。

## D2 skill 内交叉引用:按语义分三类改写

`skills/*/SKILL.md` 与 `references/*.md` 内写死的 `skills/<other>/...` 引用逐处分类:

- **(a) 文档指针**(跨 skill 的 references 指引)→ `../<skill>/references/...` 兄弟相对。开发仓库 `skills/` 与工作台 `.jspace/skills/` 两侧均可解析,也是 check-skills C1 已校验的既有约定。
- **(b) run-command 示例**(从工作台根执行,如 `python3 skills/asset-ingest/scripts/extract.py`)→ `.jspace/skills/asset-ingest/scripts/extract.py` 工作台根相对(命令实际运行在物料化后的工作台)。
- **(c) 全局安装引用**(`harness-config` 的 `~/.agents/skills/...`、`~/.pi/...`)→ **不改**(本任务范围外)。

## D3 旧工作台升级:零迁移代码,靠现有 diff 机制

- 新 manifest 物料化 rel `.jspace/skills/...` 在旧工作台缺失 → `diffBundle` 报 `create`。
- 旧 `skills/...` 在 materialized journal 有记录、新 manifest 不再物料化 → 走「recorded but not in bundle」分支报 `stale`(报告,不自动删)。
- 用户改过的官方 skill:旧 `skills/<name>/` 中该文件报 `seed: local content kept`(skip),改动保留;新 `.jspace/skills/` 副本按 bundle 就位。
- 可选轻量:在 `workspaceUpgrade` 返回 lines 附一句「核对 `skills/` 遗留改动后手动清理」提示(不引入文件移动/删除等不可逆操作)。

## D4 治理措辞

工作台 `templates/workbench/AGENTS.md`「Skill Governance」更新为:根 `skills/` = 用户自建 skill 保留地;官方 skill 位于 `.jspace/skills/`(机器管理,seed 语义)。生成块(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV)只含 skill 名 + 触发词/描述、不含路径,不受本任务影响(手改散文不会被 gen-assets 重写覆盖)。

## D5 发布

bump `package.json` 1.0.6 → 1.0.7 → `bun run build`(内部:`gen-version` → `gen-assets` → `bun build --compile` → `clean`)重编译 `bin/jspace`。全平台用 `build:all`。版本由 `gen-version.ts` 从 git tag / `JSPACE_BUILD_VERSION` 读取。

## 波及文件(实现按此核对)

| 类别 | 文件 |
|---|---|
| 核心映射 | `application/workspace/manifest.ts`、`cli/embed.ts` |
| 工作台模板 | `templates/workbench/AGENTS.md`、`templates/workbench/README.md` |
| CLI 文案 | `application/workspace/init.ts` |
| 仓库顶层文档 | `README.md`、`AGENTS.md`、`docs/PLATFORMS.md`、`GOAL.md`(仅前瞻性表述) |
| skill 内交叉引用 | `skills/memory-recall/SKILL.md`、`skills/memory-writeback/SKILL.md`、`skills/jspace-bootstrap/references/gbrain.md`、`skills/asset-ingest/references/deep-extract.md`、`skills/asset-ingest/references/example-ingest.md`、`skills/memory-recall/references/discipline.md`、`skills/memory-recall/references/memory-acceptance.md`、`skills/memory-writeback/references/example-writeback.md` |
| 测试 | `application/workspace/manifest.test.ts`、`application/workspace/workspace.test.ts`、`cli/init.test.ts`(核对) |
| **不改** | `scripts/gen-assets.ts`、`scripts/check-skills.ts`、`scripts/skill-frontmatter.ts`、`cli/assets-reachability.test.ts`、`cli/lifecycle-and-safety.test.ts`、`skills/harness-config/**` |

## 风险与回滚

- **死链残留**(引用遗漏):AC4 + check-skills C1 + 新工作台 reachability 兜底。
- **用户改 skill 的升级边角**:D3 已定行为(不静默丢、保留改动),文档提示。
- **回归面**:bundle key 不变策略把核心改动收敛到 2 个映射点,AC1 单测兜底。
- **回滚**:实现阶段纯代码 + 文档,无不可逆操作 → 任何文件粒度 `git checkout` 可回退;发布前验证失败则不 bump 不 build,版本语义不被污染。
