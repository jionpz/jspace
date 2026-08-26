# Research: upgrade/ownership/journal 对 skill 名的依赖形态

- **Query**: templates/workbench/AGENTS.md、README.md 指向 bootstrap 的入口指引；application/workspace/workspace.ts 与 upgrade 相关逻辑（材料化 journal、ownership、diff/upgrade）对 skill 名是硬编码还是仅按 manifest 泛化。
- **Scope**: internal
- **Date**: 2026-08-06

## 结论先行

**升级/所有权/journal 链对 skill 名零硬编码——全部按 manifest 泛化。** 唯一的运行时硬编码 skill 路径在 `application/workspace/init.ts:117`（init 成功提示串）。模板中的旧名引用只存在于手写散文（AGENTS.md:129,158,185、README.md:36）与生成块（会随 gen-assets 自动更新）。

## 1. 所有权规则（ownership）— 前缀泛化

`application/workspace/manifest.ts:25-30` `ownershipFor(key)`：
- `skills/` → `"seed"`；`templates/workbench/.jspace/` → `"user"`；`templates/workbench/` → `"seed"`；其余 → `"managed"`。
- **纯路径前缀匹配，无名字逻辑**。改名为 `skills/jspace-use/...` 仍是 `seed`。

## 2. 路径映射 — 前缀泛化

`manifest.ts:41-57`：
- `skillRel(name) = .jspace/skills/${name}`（:41-43）。
- `skillRoot(root, name) = join(root, skillRel(name))`（:46-48）。
- `materializedRel(key)`（:53-57）：`templates/workbench/` → 剥前缀；`skills/` → `.jspace/skills/<name>/...`；`templates/filehub/` → `null`（不物化）。
- 全部按 bundle key 前缀泛化。改名后新键自动映射到 `.jspace/skills/jspace-use/...`。

## 3. diff/upgrade — 全 manifest 驱动

`application/workspace/manifest.ts:82-178` `diffBundle`：
- 对 `manifest.files` 逐条：`rel = materializedRel(f.path)`；缺失 → create/skip（:88-98）；哈希匹配 → no-op（:135-136）；与 journal 记录一致而 bundle 前进 → seed update / user skip（:137-147）；本地改过 → seed skip / managed conflict（:148-160）。
- **"recorded but no longer in bundle" 分支（:165-176）**：journal 里有、新 manifest 没有的 rel → 未改动 `remove`、本地改过 `stale`。这是改名/移除旧 skill 时清理旧 `.jspace/skills/jspace-bootstrap/` 的通用机制。
- AGENTS.md 特殊处理：只对比/替换 JSPACE 块（:102-134），块外用户内容永不触碰（agents-block.ts:1-41）。

`application/workspace/workspace.ts` `workspaceUpgrade`（:168-317）：
- 计划筛选、备份、journal、rollback 全按 `DiffEntry.rel` 泛化（:181-308）。
- `pathByRel` 把 rel 反向映射回 bundle key（:259-263），写内容时 `deps.assets[key]`（:297-300）。
- **无任何 `jspace-bootstrap` 字面量**。

`application/workspace/journal.ts`：
- `writeActualMaterializedJournal`（:61-70）与 `writeUpdatedMaterializedJournal`（:80-98）都按 `manifest.files` + `materializedRel` 遍历，**无名字逻辑**。
- 记录的是"实际落盘哈希"，不是名字；改名后旧 rel 的记录仍在，upgrade 靠它区分 remove vs stale。

## 4. cron skill-target 校验 — 泛化

`application/automation/definitions.ts:63-83` `compileSkillTarget`：
- `ctx.skillsManifest.workbench.find((s) => s.name === target.skill)`（:64）。
- `skillRoot(wbRoot, target.skill)` + `diffBundle` 前缀 `skillRel(target.skill)/`（:68-77）。
- 无硬编码名。改名后 cron 里 `skill: jspace-bootstrap` 的目标会报 `unknown skill`（:66），需用户侧更新 cron.json —— 但这是**数据**（user 所有权），upgrade 永不覆盖，改名需单独处理存量 cron 目标。

## 5. 模板入口指引（指向 bootstrap 的旧名引用）

| 文件:行 | 类型 | 改名影响 |
|---|---|---|
| `templates/workbench/AGENTS.md:117` | 生成块（SKILL-GOV） | gen-assets 自动更新 |
| `templates/workbench/AGENTS.md:192` | 生成块（BRAIN-OPS） | gen-assets 自动更新 |
| `templates/workbench/AGENTS.md:129` | 手写散文 | **需手工改**（`.jspace/skills/jspace-bootstrap/references/gbrain.md`） |
| `templates/workbench/AGENTS.md:158` | 手写散文 | **需手工改**（skill 名单里的 `jspace-bootstrap`） |
| `templates/workbench/AGENTS.md:185` | 手写散文 | **需手工改**（harnesses.md / headless-ops.md 两处） |
| `templates/workbench/README.md:36` | 手写 | **需手工改**（`.jspace/skills/jspace-bootstrap/SKILL.md`） |

既有工作台侧：AGENTS.md 经 `block-update` 只刷新 JSPACE 块（含两个生成子块），README.md 是 seed（未修改随升级刷新）→ 模板改完后，`jspace workspace upgrade` 会把旧名引用从既有工作台收敛掉（只要用户没改过这些文件）。若用户改过 README/skills → `skip`，旧名保留在用户侧。

## 6. 改名后既有工作台的迁移行为（升级视角）

对存量工作台（已物化 `.jspace/skills/jspace-bootstrap/`）：
- 旧 7 文件在 journal 有记录、磁盘未改动 → `remove`（diffBundle:165-176 的通用分支，manifest.ts:287-295 执行 unlink + 备份）。
- 任一旧文件被用户改过 → `stale`（保留，不删）。
- 新 `.jspace/skills/jspace-use/*` → `create`。
- 根目录残留 `skills/jspace-bootstrap/`（更早的 legacy 布局）同理走 remove/stale —— workspace.test.ts:349-429 正是这个机制的既有回归测试。

## 依赖形态小结

- **硬编码**：`init.ts:117`（提示串）；`execute.ts:128`（asset-ingest，另一个 skill）。
- **泛化**：ownership / 路径映射 / diff / upgrade / journal / cron skill-target 全部 manifest 驱动。
- 因此改名对升级机制本身零改动；要动的只是：skill 目录与名字、模板手写散文、skills-manifest.json 依赖、init 提示串、以及存量 cron 的 skill target 数据（user 数据，工具不替你改）。
