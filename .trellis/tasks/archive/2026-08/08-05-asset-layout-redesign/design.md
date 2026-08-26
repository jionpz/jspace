# Design — 工作台资产布局与文档重构

> 本文件定义父任务的整体技术设计:放置原则、目标布局、升级迁移策略、工作台 AGENTS.md 新结构。子任务按其分工实现,具体到文件粒度在子任务 design/implement 中展开。

## D1 资产放置原则:「入口面在根,其余一律 .jspace/」

**原则**:官方资产放工作台根目录的**唯一判据** = harness 或人类必须在工作台根目录自动发现它。凡 CLI 管理、不需要在根发现的资产,一律放 `.jspace/` 下,按所有权分子区。

**动机**:历史上「哪个官方资产放根」靠拍脑袋(skill 三连跳即此病的体现),且所有权由「逐文件 bundle-key 前缀」决定而非「目录位置」,看目录无法判断升级会动哪些文件。D1 让目录位置直接编码所有权,并给放置一个可检验的判据。

**官方资产决策表**:

| 官方资产 | 位置 | 判据(为什么) |
|---|---|---|
| `AGENTS.md` | 根 | Claude Code / Cursor / Codex / Pi 均从项目根自动发现 |
| `README.md` | 根 | 人类入口,`ls` 即可见 |
| `.gitignore` | 根 | git 只认根 `.gitignore` |
| `.claude/settings.json` | 根 `.claude/` | Claude Code 项目设置必须在此 |
| 官方 skills | `.jspace/skills/` | 内部机器管理资产,harness 不自动发现,非入口面 |
| `hub.json` / `cron.json` | `.jspace/` | 用户数据,CLI 维护,schema 演进走迁移 |
| `marker.json` / `local.json` / `logs/` / `state/` | `.jspace/` | 机器状态,gitignored |

**一句话落地**:官方资产放根目录的只有 AGENTS.md / README.md / .gitignore / .claude/settings.json 四个入口文件;其余一切在 `.jspace/`。

## D2 目标布局(现状保持,原则固化)

```
<workbench>/
├── AGENTS.md              # seed — 工作台专属文档(重写,见 D4)
├── README.md              # seed — 人类入口 + 目录边界 + 升级范围
├── .gitignore             # seed
├── .claude/settings.json  # seed — SessionStart hook
├── workspace/             # user — 域目录(从使用涌现)
├── skills/                # user — 用户自建技能(官方 skill 不在此)
└── .jspace/               # JSpace 管理区
    ├── skills/            # seed — 官方技能(唯一官方非入口资产)
    ├── hub.json           # user
    ├── cron.json          # user
    ├── marker.json        # machine
    ├── local.json         # machine (gitignored)
    ├── logs/              # machine (gitignored)
    └── state/             # machine (gitignored)
```

路径不引入 churn;变化在「原则」落到文档 + 所有权语义与目录位置对齐后不再需要解释性段落。

## D3 升级迁移:stale 从「报告不删」改为「未修改可清理」

### 现状问题

`diffBundle` 的 stale 分支(manifest.ts:113-117)只报告不删;`workspace.test.ts:319` 甚至断言「root skills/ becomes stale, upgrade creates .jspace/skills/ and never deletes」。后果:旧工作台升级后根 `skills/` 永久残留官方孤儿副本,与「根 skills/ 归用户自建」的新规则自相矛盾。

### 新策略

- **可清理**:stale 条目中,若旧 rel 当前内容 hash == materialized journal 记录的 hash(即**未修改**的旧 seed 副本)→ 升级执行 `remove`(unlink),不保留。
- **保留**:旧 rel 内容 ≠ 记录 hash(用户改过)→ 保留为 `stale` 报告,提示用户手动核对迁移。用户内容永不自动删。
- 删除走现有 backup + journal:`upgradeJournal.plan` 增加 `remove` action,backup 已覆盖「删除前备份当前文件」分支(workspace.ts:238-245 对每个 plan 条目若存在则备份——remove 条目同样先备份再删,rollback 恢复)。
- `recreateOnMissing` 语义不受影响(cron.json 删除仍尊重)。

### diffBundle 签名变化

stale 分支需要读「当前文件内容」判断是否未修改——`diffBundle` 已持有 `deps.readFile`,可直接在 stale 分支读取。action 从 `"stale"` 拆成:
- `"remove"`(未修改,升级会删)
- `"stale"`(已修改,报告保留)

dry-run 显示 `[remove]` / `[stale]`;真实升级只执行 `remove`。

### legacy 测试反转

`workspace.test.ts:319` 测试反转:未修改的旧根 `skills/` 副本升级后被清理;新增用例:修改过的旧副本保留并报 `stale`。

## D4 工作台 AGENTS.md 块嵌入:模仿 Trellis,不自带完整文件

> **决策修订(用户指示)**:工作台 `AGENTS.md` **不自带完整独立文件**。模仿 Trellis 的 `<!-- TRELLIS:START -->` 块模式——`jspace init` 只在用户自己的 `AGENTS.md` 里**嵌入一段 JSpace 受管文本块**(`<!-- JSPACE:START -->`…`<!-- JSPACE:END -->`)。块内 = jspace 维护(init 嵌入、upgrade 只更新块内),块外 = 用户完全拥有、永不覆盖。

### 原则

工作台 AGENTS.md 是**用户的文件**,JSpace 只在其内部维护一段受管块。这消除了「工作台 AGENTS.md 是开发仓库 AGENTS.md 派生」的错位——因为 jspace 根本不再"提供"完整 AGENTS.md,只提供一段嵌入文本。用户可自由组织 AGENTS.md 的其他内容(项目说明、个人规则等)。

### 块模板结构(`templates/workbench/AGENTS.md` = 块模板,非完整文件模板)

```
<!-- JSPACE:START -->
<!-- 本块由 jspace 管理:jspace init 嵌入、jspace workspace upgrade 只更新块内;
     块外内容归你所有,永不覆盖、永不删除。 -->
# JSpace 工作台
(精简规则:Core Positioning / Daily Work Intake / Domain / Resource / Skill Governance /
 记忆与资产外指 / cron 行为规则 / 收工写回 / 开发模式一行)
## Brain operations
<!-- TRELLIS-BRAIN-OPS:BEGIN -->…<!-- TRELLIS-BRAIN-OPS:END -->
## Skill Governance
<!-- TRELLIS-SKILL-GOV:BEGIN -->…<!-- TRELLIS-SKILL-GOV:END -->
<!-- JSPACE:END -->
```

- BRAIN-OPS / SKILL-GOV 两个生成子块位于 JSPACE 块内;`renderAgentsBlocks` 按标记替换不受外层影响(标记文本唯一)。
- **不再有"完整独立 AGENTS.md"语义**:模板文件整体就是块;块外不属于 JSpace。

### 机制变化

| 环节 | 现状(整体 seed) | 新(块嵌入) |
|---|---|---|
| 模板 | 完整 AGENTS.md 文件 | JSPACE 块模板(整体被 START/END 包裹) |
| init | 整体写模板文件 | 目标无文件→写含块最小文件;有文件→嵌入/替换块,块外保留 |
| upgrade | seed:未修改整体刷新 | 只对比「目标块」vs「bundle 块」,不同则仅替换块内(整文件备份 + journal + rollback) |
| 所有权 | AGENTS.md = seed | 块内 = managed(机器),块外 = user(用户) |

### 块工具函数(新增,放 manifest.ts 或新文件 agents-block.ts)

```ts
export const JSPACE_BLOCK_START = "<!-- JSPACE:START -->";
export const JSPACE_BLOCK_END = "<!-- JSPACE:END -->";
/** 提取文件中的 JSpace 块(含标记),无则 null。 */
export function extractAgentsBlock(content: string): string | null;
/** 在目标内容中嵌入/替换 JSpace 块;无块时插入到文件顶部(保留原内容)。 */
export function embedAgentsBlock(target: string, block: string): string;
```

`diffBundle` 对 `AGENTS.md` 走特殊分支:提取目标块 → 与 bundle 块对比 → `no-op`(块同) / `block-update`(块异) / `create`(无块,init 兜底嵌入)。`workspaceUpgrade` 对 `block-update` 执行整文件备份 + 块替换。

## D5 运行时 skill 路径单一来源

新增两个纯函数(manifest.ts 或新 core 位置):

```ts
/** 官方 skill 在工作台内的相对路径(.jspace/skills/<name>)。 */
export function skillRel(name: string): string;          // `.jspace/skills/${name}`
/** 官方 skill 在工作台根下的绝对路径。 */
export function skillRoot(root: string, name: string): string; // join(root, skillRel(name))
```

所有运行时消费方改用它:

| 消费方 | 现状 | 改为 |
|---|---|---|
| `application/automation/definitions.ts:68` | `join(wbRoot, "skills", target.skill)` | `skillRoot(wbRoot, target.skill)` |
| `definitions.ts:70` fix 文案 | `skills/<name>/SKILL.md` | `skillRel(name)/SKILL.md`(文案 `.jspace/skills/...`) |
| `definitions.ts:76` diff 前缀 | `skills/${name}/` | `skillRel(name)/` |
| `definitions.ts:81` prompt | `join(skillRoot, "SKILL.md")` | 同(经 skillRoot) |
| `application/automation/execute.ts:127` 守卫 | `join(root, "skills", "asset-ingest")` | `skillRoot(root, "asset-ingest")` |
| `application/registry/filehub.ts:87` notes | `skills/asset-ingest` | `skillRel("asset-ingest")` |

`manifest.ts` 的 `materializedRel` 已是 `.jspace/skills/`,与 `skillRel` 保持一致(可让 `materializedRel` 复用 `skillRel` 派生,避免双写)。

测试(`definitions.test.ts` fixture 的 `endsWith("skills/...")`、prompt 断言)同步改为 `.jspace/skills/`;execute 守卫测试补 `.jspace/skills/` 路径。

## D6 文档与生成物同步(父级集成)

| 文件 | 改动 |
|---|---|
| `templates/workbench/README.md` | 目录边界表按 D1/D2 重写;去掉「与用户数据同目录但所有权不同」解释段(位置即所有权) |
| `templates/workbench/AGENTS.md` | 按 D4 重写(保留生成块) |
| 开发仓库 `AGENTS.md` | Product Vision 摘要中工作台产物描述 `.jspace/skills/`(已同步);「模式边界」段指向工作台新 AGENTS 结构(轻改) |
| 开发仓库 `README.md` | 工作台产物描述核对 `.jspace/skills/` |
| `GOAL.md` | 仅前瞻性表述同步(里程碑历史不改) |
| `.trellis/spec/backend/directory-structure.md` | 工作台布局描述 + 放置原则一句 |
| `application/registry/filehub.ts` | notes 路径(D5) |
| `cli/init.ts` / `init.ts` 文案 | 已指向 `.jspace/skills/`(核对) |

gen-assets 重跑 → `cli/assets.generated.ts` / `manifest.generated.ts` / `skills.generated.ts` 刷新;check-skills 全绿。

## 风险与回滚

- **回归面收敛**:bundle key 不变;核心语义点是 `skillRel`/`skillRoot` 单一来源 + stale 清理。
- **删文件不可逆**:仅「未修改的旧 seed 副本」走 remove,且 backup + journal + rollback 覆盖;用户内容永不自动删。
- **AGENTS.md 重写丢规则**:重写时以「行为规则保留、产品实现外指」为纲,生成块由 gen-assets 兜底。
- **回滚**:实现阶段纯代码 + 文档 + 模板;任何文件粒度 `git checkout` 可回退;发布前验证失败不 bump 不 build。
