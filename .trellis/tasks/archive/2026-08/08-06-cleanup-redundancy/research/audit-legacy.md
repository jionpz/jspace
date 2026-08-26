# Research: 历史遗留代码分类（必要通用机制 vs 可清过渡代码）

- **Query**: init legacy-layout guard、workspace.test.ts legacy 迁移测试、assets-reachability 旧布局处理——哪些是必要通用机制（保留），哪些是为已删除布局服务的过渡代码（可清）。注意 PRD 红线「不提供旧布局兼容迁移」，但要区分「通用机制的回归测试」≠「兼容层」。
- **Scope**: internal
- **Date**: 2026-08-06

## 分类框架

- **必要通用机制**：不绑定任何具体旧版本/旧布局名字，为「任意文件被移除/改名/损坏」提供安全兜底。保留。
- **过渡代码**：只为本产品已删除的旧布局/旧名字提供读写路径。可清。
- **通用机制的回归测试**：用旧布局 fixture 验证通用机制行为（不是让产品去兼容旧布局）。保留，但 fixture 名是测试数据。

## 结论一：生产代码全部是通用机制（无过渡代码）

### 1.1 `init.ts:53-62` legacy-layout residue guard —— 保留

```ts
const legacyRoot = [join(target, "hub.json"), join(target, ".jspace.json")].some((p) => existsSync(p));
if (legacyRoot && !existsSync(join(target, CONFIG_DIR, "marker.json"))) {
  fail(`legacy layout files present at ${target} (root hub.json/.jspace.json); remove them and re-run init`);
}
```

- 作用：拒绝向「根残留旧布局文件（root hub.json/.jspace.json）且无 `.jspace/marker.json`」的目录静默初始化，避免产生双注册表。
- 性质：**fail-fast 安全哨兵**，不是迁移、不写旧路径。它防的是「用户拿旧版本工作台目录再 init」的误操作。属于通用防御（任何不再支持的根布局残留都靠它拦）。
- **判定：保留**。PRD「不提供旧布局兼容迁移」正是指不写旧→新的迁移代码，而此 guard 是**拒绝**而非兼容。

### 1.2 `manifest.ts:165-176`「recorded but no longer in bundle」→ remove/stale 分支 —— 保留

- 注释明示：「journal 里有、新 manifest 没有的 rel → 未改动 remove、本地改过 stale」。
- 这是升级机制对「任何被移除/改名的资产」的通用清理分支（上轮 jspace-bootstrap→jspace-use 改名正是靠它清掉旧 `.jspace/skills/jspace-bootstrap/`）。
- 它不硬编码任何旧名字/旧路径（`materializedRel` 全前缀泛化）。改名/删 skill/删模板都走这里。
- **判定：保留**。是通用机制，不是旧布局兼容。

### 1.3 `workspace.ts:287-296` remove 动作 —— 保留

- `remove` 分支 best-effort unlink + 备份（rollback 可恢复），是 1.2 的执行侧。通用。

### 1.4 `core/registry/migrations.ts` hub schema 迁移机制 —— 保留

- `MIGRATIONS` 注册表当前为空（:17），`migrateHubSchema` 永远返回 unchanged 或 no-migration。这是**面向未来的机制**（v5 及以上注册链式迁移），且已被 `workspaceUpgrade`（workspace.ts:64,194,219-234）与 dry-run 的 migrate/manual 展示消费。
- **判定：保留**（必要的通用机制；虽然当前惰性，但删除需连带删 upgrade 的迁移计划逻辑）。

### 1.5 scheduler adapters 的 legacy untagged 守卫 —— 保留

- `adapters/scheduler/darwin.ts:29,82`「a mismatched (or legacy untagged) plist is never ours」
- `adapters/scheduler/linux.ts:54,64`「crontab has a legacy untagged jspace block... remove manually」
- 性质：跨工作台安全（绝不触碰别人/旧无 tag 的调度任务）。通用机制，保留。

### 1.6 `doctor.ts:91-124` orphan skill 目录诊断 —— 保留

- 对 `.jspace/skills/` 下「既非官方 skill 又无 journal 记录」的目录告警（如 pre-journal 初始化遗留）。只告警、不删除。通用诊断机制，保留。

## 结论二：通用机制的回归测试（保留，fixture 是旧名数据）

| 测试 | 位置 | 验证的机制 | 判定 |
|---|---|---|---|
| legacy 迁移测试 | `application/workspace/workspace.test.ts:355-438`（文件头 :4-8 声明 approved jspace-bootstrap exemption） | remove/stale/create 对「旧名 root skills/ 副本 + 旧 journal」的行为；rollback 恢复 | 保留（通用机制回归测试） |
| orphan 诊断 fixture | `application/workspace/doctor.test.ts:119-143` | doctor 对 pre-journal `.jspace/skills/jspace-bootstrap/` 的 orphan 告警 | 保留 |
| 升级失败/回滚测试 | `workspace.test.ts:440-476` | block-update / failed apply → rollback | 保留 |

这些不是「兼容旧布局」——它们验证的是通用机制对任意旧 rel 的行为，只是用真实历史旧名 `jspace-bootstrap` 当 fixture 使回归更真实。

## 结论三：可清/可收敛的 legacy 措辞与别名

### 3.1 `core/contracts/files.ts:5-6` REGISTRY_FILE 旧名别名 —— 需确认

```ts
/** Legacy alias for the hub registry file path (v3-era naming). */
export const REGISTRY_FILE = HUB_FILE;
```

- 仅 `application/workspace/state.ts:7,16` 一处使用（error message 文案）。别名本身是 v3-era 命名残留。
- **判定**：需确认（可安全内联 `HUB_FILE` 到 state.ts 并删别名；行为零变化，纯命名收敛）。

### 3.2 `core/contracts/upgrade.ts:22` UPGRADE_ACTIONS 含 "delete" —— 保留

- 注释「`delete` = legacy alias, kept for decode compatibility」。
- 升级 journal 是**恢复关键**数据（drives `--rollback`）；老版本可能写入过 `delete` action。解码兼容是必要的，**保留**。

### 3.3 注释/措辞残留（纯文案，低优先）

| 位置 | 措辞 | 判定 |
|---|---|---|
| `.trellis/spec/backend/index.md:7`、`directory-structure.md:18,37` | 「legacy cron/update」 | 过时（cron/update 是当前实现），可改 |
| `cli/scheduler.ts:43` | 注释「Replaces the legacy untagged plist existence check」 | 准确的历史注记，保留 |
| `state.ts:2-3` | 注释「the cli facade is deleted after migration」 | 迁移期残留，可改 |
| `application/commands/command.ts:91` | 「mirrors the legacy cli/args.ts ArgError」 | 历史注记，保留（准确） |
| `workspace.ts:288`、`manifest.ts:173` | 「legacy seed copy」reason 文案 | 描述通用 remove 动作的语义，可保留（措辞可泛化为「recorded copy no longer in bundle」） |

## 判定汇总

- **保留（必要通用机制）**：init legacyRoot guard、remove/stale 通用分支、hub migration 机制、scheduler legacy untagged 守卫、doctor orphan 诊断、UPGRADE_ACTIONS "delete" 解码兼容。
- **保留（通用机制回归测试）**：workspace.test.ts:355-438、doctor.test.ts:119-143。
- **需确认（可收敛的旧名别名）**：`REGISTRY_FILE`（files.ts:6，仅 state.ts 用）。
- **可改（纯措辞）**：spec「legacy cron/update」、state.ts:2-3 注释；「legacy seed copy」reason 可泛化。
