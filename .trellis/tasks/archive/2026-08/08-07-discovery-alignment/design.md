# Design — 发现层对齐

> 子任务 A of `08-06-workbench-context-wiring`。需求见同目录 `prd.md`。
> 方法论依据：`../08-06-workbench-context-wiring/research/trellis-injection-methodology.md` §5、§8。

## 1. 问题的技术形态

现有物化是**一个 bundle key → 一个工作台路径**的 1:1 映射，两处实现：

```ts
// application/workspace/manifest.ts:50-54
export function materializedRel(key: string): string | null {
  if (key.startsWith("templates/workbench/")) return key.slice("templates/workbench/".length);
  if (key.startsWith("skills/")) return skillRel(key.slice("skills/".length)); // → .jspace/skills/
  return null;
}

// cli/embed.ts:97-107（materializeTree 内的等价分支）
else if (key.startsWith("skills/")) {
  rel = `.jspace/skills/${key.slice("skills/".length)}`;
}
```

要让同一份 skill 同时落到 `.jspace/skills/` 和 `.claude/skills/`，
必须把这个映射从 1:1 改成 **1:N**。这是本任务唯一的结构性改动，其余都是增量。

## 2. 方案选型

| | 方案 1｜`materializedRel` 返回数组 | 方案 2｜gen-assets 为投影多发一行 manifest |
|---|---|---|
| manifest 行数 | 不变（1 源文件 1 行） | 翻倍 |
| `diffBundle` 改动 | 内层循环展开为 N 个 entry | 无 |
| `ASSETS` 体积 | 不变 | 不变（需刻意避免内容重复） |
| 新增投影目标（Codex/Cursor） | 改一个纯函数 | 改生成器 + manifest 膨胀 |
| 语义 | "一份资产，多个投影" — 与事实相符 | "两份独立资产" — 与事实不符，易漂移 |

**选方案 1。** 投影关系在类型层面显式，未来加 harness 只改一个纯函数；
manifest 保持"一源文件一行"，sha256 语义不变（两份投影同内容 → 同 sha，天然满足 A3 同字节要求）。

## 3. 接口变更

### 3.1 `materializedRel` → `materializedRels`

```ts
/** Map a bundle manifest key to every workbench-relative path it materializes
 *  to. Empty array = not materialized into the workbench (filehub is created on
 *  demand by `filehub init`).
 *
 *  Official skills materialize twice: `.jspace/skills/` is the harness-agnostic
 *  source of truth; `.claude/skills/` is its Claude Code projection so the
 *  official skill selector can discover them. Both copies are byte-identical by
 *  construction — they come from the same ASSETS entry. */
export function materializedRels(key: string): string[] {
  if (key.startsWith("templates/workbench/")) return [key.slice("templates/workbench/".length)];
  if (key.startsWith("skills/")) {
    const name = key.slice("skills/".length);
    return [skillRel(name), ...SKILL_PROJECTIONS.map((p) => `${p}/${name}`)];
  }
  return [];
}

/** Harness-specific skill projection dirs. Add a harness by adding its dir. */
const SKILL_PROJECTIONS = [".claude/skills"] as const;
```

保留 `materializedRel` 作为薄封装（返回首个元素或 null）以免一次改动面过大——
**由 implement 阶段决定是否需要**：若全仓库调用点 ≤3 处，直接替换更干净，不留兼容层。

### 3.2 `diffBundle` 展开

两处循环各改一行语义：

```ts
for (const f of manifest.files) {
  for (const rel of materializedRels(f.path)) {   // ← 原来是 const rel = materializedRel(...)
    // ...原有逻辑整体不变...
  }
}
```

`AGENTS.md` 的特判基于 `rel === "AGENTS.md"`，展开后仍只命中唯一那条，不受影响。

"recorded 但已不在 bundle" 的清理循环：

```ts
if (!manifest.files.some((f) => materializedRels(f.path).includes(rel))) { ... }
```

**这条顺带解决一个历史包袱**：`~/jspace-work` 根 `skills/` 的旧副本若在 journal 里有记录，
会被判为 `remove`（未改动）或 `stale`（改过）——正好是 A6 想要的语义。
需在 implement 阶段验证该工作台的 journal 实际记录情况。

### 3.3 `materializeTree` 对齐

`cli/embed.ts` 里的分支改为复用 `materializedRels`，消除两处映射逻辑的重复
（当前 embed.ts:102 与 manifest.ts:52 是**同一规则的两份手写实现**，本身就是漂移面）：

```ts
for (const [key, content] of Object.entries(ASSETS)) {
  if (key.startsWith("templates/filehub/")) continue;
  const rels = materializedRels(key);
  if (rels.length === 0) throw new Error(`unexpected asset key: ${key}`);
  for (const rel of rels) { /* 写入，AGENTS.md 保持块合并特判 */ }
}
```

### 3.4 `CLAUDE.md`：零代码改动

新增 `templates/workbench/CLAUDE.md`，内容：

```markdown
@AGENTS.md
```

`ownershipFor`（manifest.ts:25）已有 `templates/workbench/` → `seed` 分支，
`materializedRels` 已有 `templates/workbench/` → 同名路径分支。
**加文件 + 重跑 gen-assets 即可**，无需改任何逻辑。

设计要点：
- 用 import 不用 symlink（父任务 D1）
- **根启动时** `@AGENTS.md` 解析在 CWD 内，不触发官方的"外部 import 审批对话框"。
  **从子目录（如 `workspace/<domain>/`）启动**：官方"向上遍历"会加载根 `CLAUDE.md`，
  但其 import 指向 CWD 之外 → 按官方机制属"外部 import"，首次会弹审批对话框，
  拒绝则永久禁用该 import。官方未明确判定基准，该子目录场景标**推测**，
  不在 AC 承诺内；若需支持，另行评估绝对路径/符号链接方案。
- Claude Code 向上遍历目录树加载 `CLAUDE.md`，从子目录启动也能拿到根指针（但见上条的审批对话框）
- 正文只放 import，**不放任何规则**——规则的唯一位置是 AGENTS.md 的 JSPACE 块，
  避免造出第二个事实源

## 4. doctor 诊断

新增三条，全部 `warning` 级（不阻断，符合现有 doctor 的噪音纪律）。
插入位置：`application/workspace/doctor.ts` 现有 `skills.orphan_dir` 区块之后。

| code | 触发条件 | message 要点 |
|---|---|---|
| `claude.pointer_missing` | 根无 `CLAUDE.md`，或有但不含 `@AGENTS.md` | 提示 Claude Code 不读 AGENTS.md；修复用 `jspace workspace upgrade` |
| `skills.projection_drift` | 某官方 skill 在 `.jspace/skills/` 与 `.claude/skills/` 下内容不一致 | 列出分叉文件；修复用 upgrade |
| `skills.legacy_root_copy` | 根 `skills/<name>` 的 `<name>` ∈ `officialSkillNames()` | 历史布局遗留；官方 skill 不应在根 `skills/`，建议手工移除 |

`skills.legacy_root_copy` 是对现有盲区的补充——`doctor.ts:97-98` 注释明写
"Root skills/ (user-created) is never scanned"。该假设在**官方 skill 曾经放在根 `skills/`**
的历史版本下不成立，`~/jspace-work` 就是活样本（4 个旧副本，doctor 当前报 0 error）。
新诊断只匹配官方 skill 名，用户自建 skill 仍不扫描，不破坏原有约定。

## 5. 影响面与兼容性

| 面 | 影响 |
|---|---|
| 全新 `init` | 多出 `CLAUDE.md` 与 `.claude/skills/`（4 个 skill 的副本） |
| 既有工作台 `upgrade` | 新路径走 `create`；已有文件不受影响；`hub.json`/`cron.json` 不触碰 |
| 二进制体积 | `ASSETS` 不变（投影复用同一份内容），仅磁盘多一份副本 |
| `workspace diff --json` | 每个 skill 文件多出一条 entry（rel 指向 `.claude/skills/…`） |
| journal | 每份投影独立记录，天然支持后续清理 |
| 其它 harness | `SKILL_PROJECTIONS` 加一个目录即可，无需再动结构 |

## 6. 回滚

- 代码层：`SKILL_PROJECTIONS` 置空数组 → 退回 1:1 行为（`CLAUDE.md` 仍会生成，无害）
- 工作台层：`jspace workspace upgrade --rollback <id>`（现有能力）
- 新增 doctor 诊断均为 warning，最坏情况是噪音，不阻断任何流程

## 7. 待验证（implement 阶段确认）

- `~/jspace-work` 的 materialization journal 是否记录了根 `skills/` 的旧副本
  （决定它走 `remove`/`stale` 还是只能靠 `skills.legacy_root_copy` 提示手工处理）
- `materializedRel` 的全仓库调用点数量（决定是否保留兼容封装）
- Claude Code 是否对 `.claude/skills/` 下**新出现**的目录需要重启会话才发现
  （影响 AC-A5 的验证步骤描述，不影响实现）
