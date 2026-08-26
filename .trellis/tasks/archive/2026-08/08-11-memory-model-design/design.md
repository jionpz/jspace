# design.md — 记忆模型重构

> 复杂任务:本文件定技术边界/契约/迁移/回滚。需求与验收见 prd.md。

## 1. 记忆模型(权威定义,落地到 gbrain.md)

### 1.1 六命名空间

| 命名空间 | 写语义 | 页面角色 |
|---|---|---|
| `project/<id>/state` | 覆盖 | 项目现状卡(固定 slug,唯一「现在」视图) |
| `project/<id>/decisions/<主题>` | 追加·不可变 | 项目决策史(每决策一页) |
| `project/<id>/lessons/<主题>` | 追加·不可变 | 项目专属经验(每主题一页) |
| `knowledge/<域>/<主题>` | 追加·不可变 | 跨项目可复用认识(域=通用知识域,不含项目名) |
| `assets/<项目id\|领域>/<语义名>` | 覆盖/升版 | 资产指针页(领域资产归属合法) |
| `records/consolidate\|retro/<date>` | 日期 slug·同周覆盖 | 周期快照/自省(时间投影,非独立一类) |

**slug 即类型**:分类由 slug 承载。`type` 字段一律 `note`,不参与分类。

### 1.2 检索区分(type 归一后的兜底方案)

`gbrain list` 只有 `--type` / `--tag` 过滤(无 slug 前缀过滤);type 归一 note 后,注入与检索用 **tags** 区分:

| tags | 页面角色 | 检索用途 |
|---|---|---|
| `tags: [project]` | `project/<id>/state` 现状卡 | 项目注入 / 俯瞰(list --tag project) |
| `tags: [knowledge]` | `project/<id>/lessons`、`project/<id>/decisions`、`knowledge/` | 稳定知识 Q&A |
| `tags: [asset]` | `assets/` 指针页 | 资产查找 |
| `tags: [weekly]` | `records/consolidate|retro/<date>` 快照 | 周报/回溯;注入时排除 |

- 周期快照沿用既有 `tags: [weekly]`(gbrain.md 已用于缓解 dated snapshot 混入注入),consolidate 保留 `consolidate` tag
- **recent-injection 过滤**:`gbrain list --type note --tag project -n 50`(state 卡)+ 排除 `weekly`;Q&A 用 `--tag knowledge|asset`
- slug 前缀过滤(`project/` 等)作为 CLI 侧补充,在 collectActiveProjects / listProjectStates 内实现

### 1.3 project id 规范

- 代码项目 = 仓库 ascii slug(`jspace`/`wms`/`kukasdkcsharp`);业务项目 = hub.json 注册的 ascii id(`tiyanying-52`/`baobiao-module`)
- gbrain slug 一律用 ascii id(机器标识);人读中文名在 state 卡正文或资产目录(`projects/52期体验营/` 经 `--asset-rel-path` 绑定)
- 领域/技术主题**不**拥有 project id(只认项目决策 #6)

### 1.4 state 卡 schema

```markdown
---
type: note
project: <ascii project id>
tags: [project]
source: <harness|skill>
---

# <项目> 现状

## 这个项目是什么·解决什么
…

## 现在到哪了
…

## 下一步
…

## 相关项目
- [[project/<其他id>/state]]   # 交集 wikilink,有则列

## 执行层
- 框架: Trellis / 其他   # 执行细节的存放处,不复制内容
- 入口: <指针,如仓库路径/任务看板 URL>
```

更新 = `gbrain put project/<id>/state` 覆盖同一 slug,不新建。

## 2. 写侧对齐(R2,各 skill 改动点)

| Skill | 改动 |
|---|---|
| **gbrain.md**(R1 落位) | 重写 §Page type semantics:type 归一 note,移除 lesson/decision/reference 分类语义;dated memory record 节 `memory/consolidate/` → `records/consolidate/`;新增「记忆模型权威定义」节(design §1.1-1.4) |
| **memory-writeback** SKILL.md | 决策表:决策行 `decision/<主题>` → `project/<id>/decisions/<主题>`;晋升信号:项目专属 → `project/<id>/lessons/<主题>`,跨项目 → `knowledge/<域>/<主题>`;state 卡 `tags: [project]` |
| **memory-writeback** references/writeback.md | 同步决策表 + 晋升细则 + slug 派生(ascii id) |
| **asset-ingest** SKILL.md + references/gbrain-write.md | 写页 `type: reference` → `type: note` + `tags: [asset]`;`assets/<项目\|领域>/` 保持(领域资产合法,项目用 ascii id) |
| **weekly-report** SKILL.md | 指针页 type 归一 note + `tags: [asset]`;引用 `memory/consolidate/` → `records/consolidate/` |
| **memory-consolidate** SKILL.md | `memory/consolidate/<date>` → `records/consolidate/<date>`;日期取法/幂等逻辑不变;`tags: [consolidate, weekly]` 保持 |
| **workbench-retro** SKILL.md | `memory/retro/<date>` → `records/retro/<date>`;`tags: [weekly]` 保持;`memory/consolidate` 引用同步 |
| **memory-recall** references/memory-acceptance.md | 基线文档 slug 形态对齐新模型(`assets/<领域\|项目>/<语义名>` 中文/ascii 说明)——随迁移执行一并 |
| **全局 §4** | 「state 卡三段骨架 + wikilink + 执行细节边界」对齐新模型(命名空间表 + lessons/decisions 归属 + tags 约定) |

**gen-assets**:改 skill 后 `bun run scripts/gen-assets.ts` 重新生成嵌入式资产(含 AGENTS.md Brain-ops 块)。

## 3. 注入腿(R3)

### 3.1 现状

`application/context/collect.ts` 定义 `WorkbenchState` + 独立 collector;`payload.ts` `stateLines()` 逐行渲染「有事才说」+ `nextAction()` 优先级。注入 ≈ 210 tokens/会话。

### 3.2 设计

- **collect**:加 `collectActiveProjects()`——调用 `gbrain list --type note --tag project -n 50`,过滤 `project/*/state`,按 updated_at 取最近活跃的 `MAX_PROJECTS=8`,输出 `{id, stateSummary}`(summary 取 state 卡「现在到哪了」首行或标题)
- **渲染**:`stateLines()` 加一行——`项目: N 个活跃 — tiyanying-52（…）/ jspace（…）`;无活跃项目该行省略
- **预算**:每项目行 ≤ 40 tokens,≤ 8 行 ≈ ≤ 320 tokens 增量(远低于 AC 的 500)
- **降级(含超时保护)**:gbrain CLI 不可达 → collector 静默返回空(沿用 failLines 模式),不阻塞会话;**子进程调用设独立超时 2s**(settings.json session-start hook 总超时 10s,防 gbrain 冷启动/锁拖死整个注入——超时静默省略项目行,不丢既有域/pending 行)
- **gate**:复用 session-start 事件 gate,非工作台不注入

### 3.3 契约

`WorkbenchState` 增加 `projects: { id: string; summary: string }[]`(空数组 = 无/不可达/超时)。payload 渲染按需;gbrain 子进程调用带 2s 超时,超时返回空不抛错。

## 4. 俯瞰视图(R4)

- **形态**:`jspace project list --status` 旗标——默认保持现有(列出 hub.json 注册项目),`--status` 追加俯瞰视图
- **集合定义**:`--status` 以 **gbrain 全部 `project/*/state` 卡为主体**(含不在 hub 的代码项目,如 `jspace`/`wms`),另附 **hub 注册但无 state 卡的项目**(标记「无状态卡」)——两个来源并集,满足「俯瞰几十个项目」
- **实现**:`listProjectStates()`(与 collectActiveProjects 分离:注入要活跃 ≤8 + 一行,俯瞰要全部 + 三段 + 交集,不共用一个活跃子集函数),逐页 `gbrain get` 取三段首行 + 解析正文 `## 相关项目` 的 `[[project/<id>/state]]` wikilink
- **输出示例**:
  ```
  tiyanying-52  体验营同修回访 — 进行中,8/3 更新  [相关: 报表模块]
  jspace        记忆模型重构 — 设计期,P1 任务
  wms           (无状态卡 — hub 已注册)
  ```
- **单测**:payload/collect 单元测试覆盖(纯函数,无 gbrain 依赖 mock);cli 层集成测试验证并集逻辑

## 5. 迁移脚本(R6)

### 5.1 映射表(存量 14 页)

| 旧 slug | 新 slug | 处置 |
|---|---|---|
| project/jspace/state | project/jspace/state | 不变(已是 ascii + note) |
| project/52期体验营/state | project/tiyanying-52/state | 中文 id → ascii |
| project/报表模块/state | project/baobiao-module/state | 中文 id → ascii |
| project/机器学习/state | knowledge/机器学习/机器学习基础 | 领域不建卡 → 转领域知识(主题段补全) |
| project/gbrain/state | knowledge/gbrain/架构与运维 | 技术主题 → 转主题知识(主题段补全) |
| knowledge/governance/记忆积累全局规则 | 不变 | 已是干净形态 |
| knowledge/jspace/单一事实源架构… | project/jspace/lessons/单一事实源架构… | **项目专属教训 → 独立 lessons 命名空间**(review 修正:非跨项目认识,不升 knowledge/) |
| memory/consolidate/2026-08-09 | records/consolidate/2026-08-09 | 前缀改 |
| memory/consolidate/2026-08-03 | records/consolidate/2026-08-03 | 前缀改 |
| memory/retro/2026-08-10 | records/retro/2026-08-10 | 前缀改 |
| assets/周报/2026-08-03 | assets/周报/2026-08-03 | 不变(type 归一 + tags: [asset]) |
| assets/52期体验营/同修回访登记-v1 | assets/tiyanying-52/同修回访登记-v1 | 中文 id → ascii |
| assets/机器学习/机器学习基础-第二章笔记 | assets/机器学习/… | 不变(领域资产,type 归一) |
| assets/报表模块/会议沟通记录 | assets/baobiao-module/会议沟通记录 | 中文 id → ascii |
| assets/foo/doc | (删除) | 测试残留,删除前确认 |

### 5.2 脚本契约

- `scripts/migrate-memory-model.ts`(或 .py):`--dry-run`(默认)输出映射清单;`--apply --confirm` 执行(重命名 slug + type 归一 + 内容改编字段)
- 幂等:写 `state/migrations/memory-model-v2.jsonl` 记录已迁移 slug,重跑跳过
- 门控:apply 前校验 gbrain serve 未持锁(或走 jspace pending stage 暂存路径)
- 迁移**执行**不在本任务(`--apply` 交付但部署留待锁释放后,见 PRD Deferred)

## 6. 影响面与回滚

| 面 | 文件 | 风险 |
|---|---|---|
| R1 | ~/.agents/skills/jspace-use/references/gbrain.md(源在 skills/jspace-use/references/) | 低(文档) |
| R2 | skills/{memory-writeback,asset-ingest,weekly-report,memory-consolidate,workbench-retro}/{SKILL.md,references/} + memory-recall/references/memory-acceptance.md | 中(契约,靠 grep 断言验收) |
| R3 | application/context/{collect.ts,payload.ts} + collect.test.ts/payload.test.ts | 中(注入契约,单测兜底) |
| R4 | cli/commands/project.ts + application/context/ 复用 | 低(新增 --status 不破坏默认) |
| R6 | scripts/migrate-memory-model.* + 测试 | 低(--apply 门控,dry-run 默认) |
| 全局 | ~/.agents/agents.md §4(工作台模板同步) | 低 |

**回滚点**:R2 改动全部在 skill 文档/gbrain.md,可整体 revert;R3/R4 是新增逻辑,不影响既有注入路径;R6 未执行 `--apply` 前零副作用。

**验收命令**:
```bash
bun run scripts/gen-assets.ts          # skill 改动后重新生成
bun test                               # 全量单测(含 context collect/payload)
bun run tsc -- --noEmit               # 类型门禁
# R2 grep 断言:skills/ 无旧形态 slug/type
grep -rn "memory/consolidate\|memory/retro\|type: decision\|type: reference\|type: lesson" skills/ | grep -v gbrain-write.md || echo clean
# R3 实测
jspace context session-start --plain  # 含「项目」行
# R4 实测
jspace project list --status          # 含 state 摘要 + 相关项目
# R6 实测
bun run scripts/migrate-memory-model.ts --dry-run   # 输出 = 14 行映射
```
