# memory-writeback — 写回纪律细则

纪律源 = `~/.agents/skills/jspace-use/references/gbrain.md`（引用不复制）。本文件把 gbrain.md 的写回纪律固化为收工场景的细则。

## 1. 分类表与写语义

| 类别 | 目标 slug | 写语义 | 例 |
|---|---|---|---|
| 状态记忆 | `project/<id>/state` | 固定 slug **覆盖**,`tags: [project]` | 进展 / 待办 / 开放问题 |
| 项目决策 | `project/<id>/decisions/<主题>` | **append-only 新页** | 已定决策留痕 |
| 项目经验 | `project/<id>/lessons/<主题>` | **append-only 新页** | 教训 / 项目专属要点 |
| 跨项目知识 | `knowledge/<域>/<主题>` | **append-only 新页** | 跨项目可复用认识(域=通用知识域) |
| 工作台偏好 | `profile/<主题>` | 固定 slug **覆盖**,`tags: [profile]` | 协作约定 / 默认格式 |
| 项目事件 | `records/project/<id>/<date>-<主题>` | **append-only 新页** | 里程碑 / 事故 / 范围变更(稀疏,非会话日志) |
| 周快照 | `records/consolidate/<日期>` | **转 memory-consolidate** | 本周汇总（本 skill 不写） |

- **绝不覆盖追加页**：decisions / lessons / knowledge / project events 只追加新页；更新「现状」只写 state 页或 profile 页。
- **state 页是全局固定 slug**：多会话覆盖同一页 → 归属（project id）必须准，防串页。
- **覆盖 state 前**：被删信息未来可能解释「为什么」→ 先写 decision 或 project event，再覆盖 state。

## 2. 分类决策树

```
这条事实值得下次会话还知道吗？
├─ 否 → 不写(静默)
└─ 是
   ├─ 指向文件/资产？ → assets/(转 asset-ingest)
   ├─ 任务/bug/迭代细节？ → 不进 gbrain;state「执行层」留指针
   ├─ 可执行流程且已重复 ≥3 次？ → skill 化;gbrain 只写决策留痕
   ├─ 工作台偏好/协作约定？ → profile/<主题>(覆盖)
   ├─ 归属某项目？
   │   ├─ 现在到哪/下一步/开放问题 → state(覆盖)
   │   ├─ 已定的行动承诺 → decisions/<主题>(新页)
   │   ├─ 需审计/解释时间线的事件 → records/project/<id>/<date>-<主题>
   │   └─ 可复用规律？
   │       ├─ 仅本项目 → lessons/<主题>
   │       └─ 跨项目 → knowledge/<域>/<主题>
   ├─ 跨项目规律/事实？ → knowledge/<域>/<主题>
   └─ 周期横切归纳？ → 转 memory-consolidate
```

**歧义裁决：**
- decision vs lesson：有备选方案被否 → decision；被现实教育、无正式选择 → lesson
- 项目 lesson vs 跨项目 knowledge：**先写 lessons**，第二项目实际用到再晋升 knowledge
- 犯错不是顶级类型：单次错误 → event 或 state 候选区；可复用模式 → lesson（`kind:pitfall` / `kind:failure-mode`）

## 3. slug 派生（不发明）

- 状态：`project/<project id>/state`（稳定标识，不随会话变化）。
- 项目决策/经验/事件：`project/<id>/decisions|lessons/<主题>` 或 `records/project/<id>/<YYYY-MM-DD>-<主题>`。
- 跨项目知识：`knowledge/<域>/<主题>`（域 = 通用知识域，如 governance / architecture；**不含项目名**）。
- 工作台偏好：`profile/<主题>`（语义名，ascii slug）。
- 从活跃项目（`hub.json` + 域 README + 既有 state 页）派生 project id（**ascii slug**，代码项目 = 仓库名），不臆造。

## 4. 晋升（状态 → 决策/经验/知识）

**信号**（满足其一即可考虑晋升）：
- 同一事实**跨会话重复出现**（两次以上出现在不同 state 页/会话）。
- **决策已定**不再变（从「待定」变「已定」）。
- 提炼成**教训/要点**（可复用的怎么做、别怎么做）。

**处置**：
- 项目决策 → `project/<id>/decisions/<主题>`
- 项目专属教训 → `project/<id>/lessons/<主题>`
- 跨项目可复用认识 → `knowledge/<域>/<主题>`（**第二项目实际用到**时才晋升，非「看起来通用」）

state 页保持「现状」不承载历史。晋升 = 复制蒸馏 + wikilink 回链，**不移动/不删除**原页。

**决策草案不进 decisions**：留在 state 的「开放问题」；进入 decisions = 已 settled。

## 5. 取代协议（decisions / knowledge）

推翻旧决策或旧知识时：
1. 写**新页**，正文含 `Supersedes: [[旧 slug]]`
2. 给旧页**追加** `status:superseded` tag（正文不动）
3. state 卡「当前决策」指向新页

## 6. 每页纪律

- `project` + `tags` + `source`（harness 出处）必带。
- `type` 统一 `note`（分类由 slug 承载）；检索用 `tags` 路由（state=`[project]`、profile=`[profile]`、决策/经验/知识=`[knowledge]`）。
- 形态不明确时追加一个 `kind:*` tag（见 gbrain.md「Epistemic kind tags」）。
- 未验证的主张/启发式 → `status:provisional`；有充分证据 → `status:settled`。
- `project` 归属 = 活跃项目发现结果；无项目归属的通用事实 → 用 `knowledge/<通用域>/` + 打 tags；工作台偏好 → `profile/`。
- **来源 tag 必带**（B4，见下节）：本 skill 的每一次写页都追加 `source:session`。

## 6b. 来源 tag（`source:session`）——写回率的取证基础

飞轮的核心问题是「记忆在长，但长的是 cron 归纳的，还是会话沉淀的」。这个问题**只有写侧打标才答得出来**，所以本 skill 写的每一页都追加一条来源 tag：

```yaml
---
type: note
project: acme
tags: [project, source:session]     # 路由 tag + 来源 tag,两条都要
source: claude                       # 仍是 harness 出处,语义不变、不要挪用
---
```

- **为什么是 tag 不是 frontmatter 字段**：`gbrain list` 只能按 `--type` / `--tag` 过滤，`workbench-retro` 检查 1 要数「本周会话写入 vs cron 写入」，只有 tag 数得出来。frontmatter `source:` 的语义是 **harness 出处**（`claude` / `codex` / …），是另一个问题，**不要覆盖它**。
- **本 skill 恒为 `source:session`**：memory-writeback 定义上就是「会话收工写回」，无头 cron 不跑它。会话/无头都可能跑的 skill（asset-ingest / weekly-report / memory-consolidate / workbench-retro）按**运行模式**选 `source:session` 或 `source:cron`。
- **纪律源**：`~/.agents/skills/jspace-use/references/gbrain.md`「Provenance tag」；本节只是收工场景的落地。
- **自检**：写完 `gbrain list --type note --tag source:session -n 5`，刚写的页应当在列表里。若这条查询在你的 gbrain 版本上取不到（tag 解析差异），**照实报告**给用户，不要改成「大概写进去了」——写回率取证依赖它。

**与 hook 提醒的关系**：`jspace context session-end`（claude / grok / cursor）与 `jspace context turn` 的每会话一次轻提示都只是**提醒**——它们不写 gbrain，也不打这条 tag。tag 只在你真的执行了本 skill 时产生，所以「本周 `source:session` 计数」量的正是**写回动作本身**，不是提醒次数。提醒的能力边界见 `~/.agents/skills/jspace-use/references/harnesses.md`。

## 7. embedding 降级

- 不可达 → 写仍成功（`embed_skip: true`），固定提示「写入成功,embedding 不可用,检索降级」（不得静默、不得失败）。
- 写失败非 embedding 原因 → 失败即停，不留半成品页。

## 8. 与相关文档关系

| 文档 | 角色 |
|---|---|
| `~/.agents/skills/jspace-use/references/gbrain.md` | 纪律源（维度模型 / state 覆盖 vs 知识追加 / 晋升 / 来源 tag / status / kind） |
| `~/.agents/skills/memory-writeback/SKILL.md` | 日常流程（触发 + 6 步） |
| `~/.agents/skills/asset-ingest/SKILL.md` | 资产写侧（文件归位 / reference 页，转引用） |
| `~/.agents/skills/workbench-retro/references/checks.md` 检查 1 | 来源 tag 的消费者（写回率取证） |
| `~/.agents/skills/jspace-use/references/harnesses.md` | session-end / turn 提醒的能力边界（提醒 ≠ 写入） |
| `templates/workbench/AGENTS.md` End-of-Work Capture | 何时触发的提示（引用本 skill，不双写纪律） |
