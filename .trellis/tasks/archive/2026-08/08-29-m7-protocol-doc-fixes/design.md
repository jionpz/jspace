# design.md — M7 协议修正 + profile session-start 接线

需求与验收见 `prd.md`。本文件只定边界、契约、数据流与回滚。

## 1. 边界

| 进 | 出 |
|---|---|
| `skills/jspace-use/references/{usage-mileage,example-first-use,gbrain}.md` 口径 | doctor 代码、`cron enable` 多元 arity |
| `application/context/{project-states,collect,payload}.ts` + `cli/commands/context.ts` session-start | `listProjectStates`、turn/pre-compact/session-end 的 gbrain 收集 |
| 单测 + `scripts/gen-assets.ts` | 项目卡内部串行 `get` 循环（A4） |

不新增 slug 根 / routing tag。`profile/` 与 `tags: [profile]` 已冻结，只补消费方。

## 2. 文档契约（R1 / R2）

- kickoff 第 6 步：与 `SKILL.md:62-64` 同形。

```bash
for id in memory-consolidate workbench-retro weekly-report inbox-tidy; do jspace cron enable "$id" --dir <wb>; done
```

注明可按需 subset；不要写多 positional。

- 台账：删除「gbrain retro 附节或文件」二选一。实例路径唯一为 `<wb>/.jspace/usage-mileage-ledger.md`。kickoff 第 4 步去掉「或等价路径」。retro 页仍是当周审计（`:229` 表格保持：retro slug vs 台账主索引）。
- first-use 断言拆成两条：复制 → 无 `usage.mileage_ledger_missing`；明确跳过 M7 跟踪 → 该 info 仍在且 doctor 不失败。

## 3. Profile 注入契约（R3）

### 3.1 数据流

```
session-start
  → collectWorkbenchState (sync)
  → Promise.all(
        collectActiveProjects(gbrain, { excludeProjectIds }),
        collectActiveProfiles(gbrain),
      )
  → state.projects / state.profiles
  → renderSessionStart → stateLines 有事才说
```

同一 `realGbrain(undefined, PROJECT_COLLECT_TIMEOUT_MS)` 实例并行两次 list。失败各自降级 `[]`，互不影响。hook 仍 exit 0。

### 3.2 `collectActiveProfiles`

放在 `application/context/project-states.ts`（与项目注入同腿：同一 timeout、同一 tag 解析、同一「永不抛错」）。不抽通用 collector（slug / 摘要规则不同，两处复制过滤循环可接受）。

| 规则 | 值 |
|---|---|
| list | `{ type: "note", tag: "profile", limit: 100 }` |
| slug | `/^profile\/[^/]+$/`（单段主题；嵌套丢弃） |
| 排除 | `status:archived` 或 tags 含 `weekly`（需 `get`）；跳过不占名额 |
| 上限 | `MAX_ACTIVE_PROFILES = 4`；list 已 recency 序 |
| `get` 失败 | 仍收录（空 summary），与项目卡一致 |
| list 失败 | `[]`，不抛 |

`ProfileState`: `{ theme: string; summary: string; updatedAt: string }`。`theme` = slug 去掉 `profile/`（可中文）。

摘要：frontmatter 后第一条非标题内容行，截断 80 + `…`。不走 `summarizeStateCard`（那会找「现在到哪了」）。

复用已有 `parseNoteTags` / `isArchivedGbrainNote`；`weekly` 用 `parseNoteTags(body).includes("weekly")`。

### 3.3 WorkbenchState / 渲染

`collect.ts` 增加 `profiles: ProfileState[]`，sync collector 初始 `[]`（与 `projects` 相同：只有 session-start 异步填充）。

`stateLines` 在「项目:」之后追加（空则省略）：

```
偏好: 沟通偏好（一句话） / 报告格式
```

形状对齐项目行。turn 不画此行（`renderTurn` 不走 `stateLines`）。pre-compact / session-end 走 `stateLines`，但 CLI 不收集，故线上这两钩子仍无偏好行——与今天项目卡行为一致。

4KiB 预算：摘要已截断，一行 ≤ 数百分字节；既有 oversized 用例必须继续绿。

### 3.4 gbrain.md 对齐

保留「always present / with state cards / `--tag profile`」。补上实现事实，避免再漂移：

- CLI：`collectActiveProfiles()`；与 `collectActiveProjects` 并行。
- 独立于 `MAX_ACTIVE_PROJECTS=8`；`MAX_ACTIVE_PROFILES=4`；archived/weekly 不占名额。
- 排除 `weekly` 与 `status:archived`（与 `:234` 一致）。

不把 profile 写进 `listProjectStates`。

## 4. 兼容与回滚

- 无 schema / hub / 迁移。无 profile 页的工作台：行为与现在相同（无「偏好:」行）。
- 回滚：revert 本任务提交。session-start 多一次并行 list，失败即空，无持久状态。

## 5. 权衡

- **独立 4 vs 混进 max-8**：用户已选独立，避免偏好挤掉项目。
- **同文件 vs `profile-states.ts`**：同文件复用 tag helper、timeout、测试 fake；文件名略偏 project，不值得为 40 行拆模块。
- **不修项目串行 `get`**：A4 明确范围外；并行只缩短「项目+偏好」墙钟为 `max(两者)`，项目最坏路径不变。
