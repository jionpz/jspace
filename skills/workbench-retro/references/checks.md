# workbench-retro — 六条检查细则(取证 + 判读 + 分级)

每条检查三段式:**证据命令**(只读)→ **判读规则**(写死阈值,不靠感觉)→ **分级归属**。
通用约束:证据拿不到(命令失败/输出为空/依赖不可达)→ 该条记「**无法判定** + 缺什么证据 + 怎么补」,**不猜、不省略、不用其它条的结论推断**。

`<filehub>` = `.jspace/hub.json` 中 `type: filehub` 资源 `primary: true` path(经 `local.json` 绑定);解析不到 → 检查 2/3/5 全部记「无法判定(filehub 未注册)」。

---

## 检查 1 · 写回执行率(最重要)

「本周明明有活动,却没有一条持久事实进 gbrain」——这是飞轮停摆最典型的形态,且完全无声。
更隐蔽的一种:**记忆在长,但长的全是 cron 归纳的,没有一条来自日常会话**。所以本检查要分**来源**数,不只数总量。

**证据**
```bash
# 1a 来源量化(B4:写侧按运行模式打来源 tag)
gbrain list --type note --tag source:session -n 50   # 会话写入(memory-writeback 等,含 updated_at)
gbrain list --type note --tag source:cron -n 50      # 定时写入(cron 无头跑的 consolidate/report/retro/ingest)

# 1b 写回面(与来源正交:数哪些页动了)
gbrain list --type note --tag project -n 50   # 看 project/<id>/state 页与 updated_at
gbrain list --type note --tag knowledge -n 20 # 本周有无新知识页(再按 updated_at 滤窗口)

# 1c 活动信号(佐证「这周确实在用」)
ls -la <filehub>/projects/*/ | head -40  # 资产层本周有无文件变动
ls .jspace/logs/cron/*/                  # cron 活动痕迹
```

**判读 · 来源比(先做这一段,它决定报告的第一句话)**

三个计数都只数 `updated_at` **落在本周窗口内**的页:

| 计数 | 取法 |
|---|---|
| `session_writes` | `--tag source:session` 结果中落窗口的页数 |
| `cron_writes` | `--tag source:cron` 结果中落窗口的页数 |
| `untagged_writes` | 落窗口、但两条来源 tag 都没有的页(用 1b 的结果减去上面两组) |

- **写回率 = `session_writes / (session_writes + cron_writes)`**,分母为 0 时记「本周无写入」,不写 0%(0/0 不是 0)。
- `session_writes == 0` 且 `cron_writes > 0` → **会话写回腿停摆**:飞轮只有定时那条腿在转。整体性问题,报告开头单独点出。
- `session_writes == 0` 且 `cron_writes == 0` 且有活动信号 → **写回腿整体停摆**(比上一条更严重)。
- `session_writes > 0` → 记实际条数与比例,**不评价好坏**(基线数据,供跨周对比;单周数字没意义,走向才有)。
- `untagged_writes > 0` → **不要**把它算进任何一条腿。分两种情况写:
  - 页的 `updated_at` 早于本约定上线 → 记「历史页,无来源 tag」,只在基线里标注数量,不进判读;
  - 页是本周新写的却没 tag → **写侧纪律缺口**(某个 skill 没按 `~/.agents/skills/jspace-use/references/gbrain.md`「Provenance tag」打标),归 `需你决策`,指明是哪个 slug/哪个 skill。
- `gbrain list --tag source:session` 在本机 gbrain 版本上取不到结果(tag 解析差异等)→ 本段记「**无法判定** + 缺来源 tag 查询能力」,改用下面的降级 proxy,并把「来源 tag 不可查」本身作为一条 `需你决策` 报出来——**不要**默默用 proxy 冒充精确计数。

**降级 proxy(仅当来源 tag 不可用时)**:cron 写入 ≈ `records/consolidate/*` `records/retro/*` `assets/周报/*` 这些 slug 命名空间里落窗口的页,再叠加 `.jspace/logs/cron/*/` 里成功运行的时间戳;会话写入 ≈ 落窗口的其余页。**这是估算,报告里必须标明「proxy 估算,非精确计数」**。

**判读 · 写回面(来源比之外的缺口定位)**
- 活动信号 = 本周内 filehub 有文件新增/修改,或 cron 成功运行,或域/hub 有变更。
- 本周新知识 = `gbrain list --type note --tag knowledge -n 20` 结果中 `updated_at` 落在本周窗口内的页;没有 → 记「本周无新知识」。
- 某项目有活动信号,但其 `project/<id>/state` 页 `updated_at` ≥7 天未动 → **写回缺口**。
- 全工作台本周 0 个 state 页更新且有活动信号 → **写回腿停摆**(与来源比的结论互为佐证;两者不一致时**两个数都报**,不挑一个顺眼的)。

**判读 · 提醒面是否接上(找根因,不只报现象)**

`session_writes == 0` 时顺手判一句「是没被提醒,还是提醒了没做」:

```bash
jq '.session_count, .writeback_nudge_for_session' .jspace/state/briefing.json   # 会话计数 / 轻提示已用到第几个会话
```
- 文件不存在或 `session_count` 本周没涨 → **session-start hook 没在跑**(提醒面根本没接上):归 `立即可做`,附 `jspace doctor --dir .` 看 `briefing.stale` 与 `harness.session_start_not_wired`。
- `session_count` 在涨、`writeback_nudge_for_session` 也在跟 → 提醒发出去了但没人写回,是**习惯问题不是接线问题**:归 `需你决策`,别去改接线。这一情形下 `jspace doctor --verbose` 也会报 `memory.writeback_habit_unverified`(info 级习惯门禁,不是接线故障;doctor 不查 gbrain,精确计数仍以本检查的来源比为准)。
- 各 harness 的 session-end 能力边界(哪些是 best_effort、哪些只有 turn 轻提示)→ `~/.agents/skills/jspace-use/references/harnesses.md`。

**分级**:单项目缺口 → 需你决策(问「X 项目这周的进展要不要补记」);会话腿/整体停摆 → 需你决策 + 在报告开头单独点出;hook 没接上 → 立即可做。

---

## 检查 2 · 挂接一致性

filehub 有项目、域 README 没挂、hub 没注册 —— 三方漂移,导致 weekly-report 的项目发现源失效。

**证据**
```bash
ls <filehub>/projects/                                   # 资产层真相
rg -n '\|' workspace/<domain>/README.md | head -20        # 域 README 项目表
jspace project list                                       # registry 注册情况
```

**判读**
- `projects/<X>/` 存在但域 README 项目表无 X → **未挂接**。
- 域 README 有 X 但 `projects/<X>/` 不存在 → **悬挂行**(项目被删/改名)。
- 项目表仍含 `<项目id>` 之类占位行 → **占位未清**。

**分级**:全部 → 立即可做(附具体修复动作:在哪个文件加/删哪一行)。

---

## 检查 3 · 指针有效性

gbrain asset 指针页的 `Pointer` 指向资产本体;文件被移动/改名/未同步 → 指针断,召回时才发现就晚了。

**证据**
```bash
gbrain list --type note --tag asset -n 20          # 指针抽样源(v2: asset 指针页)
gbrain list --type reference -n 20                 # 迁移缺口抽样(仅 info,非唯一抽样源)
gbrain get <slug>                                   # 读 Pointer / rel_path 字段
test -f "<Pointer>" && echo OK || echo BROKEN
gbrain stats                                        # pages_by_type:看 type 契约
```

**判读**
- 抽样 ≤5 条(全量扫描成本高、收益低;跨周轮换样本)。
- `test -f` 失败但 `rel_path` 能经「本机 filehub 根 + rel_path」解析到实际文件 → **指针待重解析**(换机场景,非损坏)。
- 两者都失败 → **断指针**。
- 页缺 `rel_path` 字段 → **纪律缺口**(写侧没按 M5 纪律写)。
- **type 契约**:`gbrain stats` 的 `pages_by_type` 只应出现 `note`(first-use 探针可保留 `smoke`);出现 `lesson|decision|reference` → **迁移未完成**(info / 需决策),不是合法 type;出现 `concept|project|knowledge|asset-pointer` → **写侧未按 gbrain.md 的 type 语义写**(需决策)。这条由 retro 承担而不是 `jspace doctor`:doctor 是离线结构化诊断、不碰 gbrain 运行时;retro 本就在读 gbrain,顺手即可判。

**分级**:待重解析 / 断指针 → 立即可做;纪律缺口 / 迁移未完成 / type 契约 → 需你决策(是否回写侧修 asset-ingest 或 memory-* 的写页模板)。

---

## 检查 4 · 流程卡点

**证据**
```bash
jspace cron check          # 未 ack incident + pending 暂存写 + 各 cron 状态
jspace cron list           # 定时层到底启用了没(出厂全 enabled:false)
jspace ingest list         # in-progress / cleanup-pending journal
jspace pending list        # gbrain 锁冲突暂存
ls .jspace/logs/cron/*/ | tail -20
```

**判读**
- 所有 cron 都 `enabled: false`(等价信号:`jspace doctor --verbose` 报 `cron.all_disabled`)→ **定时层从未启用**:资产整理与周自省两条腿根本没在转,本次 retro 必然是会话内手跑的。这条优先于下面所有失败判读——没运行过自然没失败。
- `needs_attention > 0` → **有未处置失败**。
- ingest journal 存在 in-progress/cleanup-pending 且 ≥2 天未推进 → **入库中断未续跑**。
- pending 暂存 ≥1 条且 ≥1 天未 apply → **写入堆积**。
- 同一 cron 本周失败 ≥2 次 → **重复失败**(区别于偶发:偶发=1 次且下次成功)。

**分级**:未处置失败/中断/堆积 → 立即可做(附续跑或 ack 命令);重复失败 → 需你决策(要查根因,可能是配额/网关/契约问题);定时层从未启用 → 需你决策(给 `jspace-use` 第 2 章 4.5 的 enable → rehearsal → install 序列,让用户定开哪几条)。

---

## 检查 5 · inbox 停滞

模糊项每周被第一遍跳过、第二遍又从没人工过目 → 文件永远躺在 `_inbox/`。

**证据**
```bash
jspace inbox status
find <filehub>/_inbox -type f -mtime +7 -not -name '.*'
tail -40 <filehub>/.jspace-logs/inbox-batch.md      # 看是否反复被列为模糊项
```

**判读**
- `_inbox/` 有文件 mtime >7 天 → **停滞**;>21 天 → **长期停滞**(单独点出)。
- 同一文件在 inbox-batch 日志里被列为模糊项 ≥2 次 → **规则缺口**:说明现有归属/命名规则判不了它,不是用户懒。
- `_inbox/` 为空 → 记「无停滞」,同时留意是否**长期为空**(可能是压根没往里放东西,属使用习惯问题,记入观察中)。

**分级**:停滞 → 需你决策(逐个问归属/命名);规则缺口 → 需你决策(提议改 asset-ingest 的判定规则)。

---

## 检查 6 · 规则进化候选(retro 的独有价值)

`jspace-use` §8.3 只回答「何时**新建** skill」;本条补上「何时**修订**已有 skill / 沉淀新惯例」。

**证据**
```bash
gbrain list --type note --tag knowledge -n 20       # 本周新增知识页主题(再按 updated_at 滤窗口)
gbrain query "本周重复出现的问题"                     # 语义面佐证
ls .jspace/logs/cron/*/ && tail -30 .jspace/logs/cron/<id>/<最近>.md   # 无头运行里反复出现的同类处置
rg -n '无法判定|跳过|模糊' <filehub>/.jspace-logs/inbox-batch.md | tail -10
```

**判读(命中 ≥1 即为候选)**
- 同一主题的知识页/教训本周出现 ≥2 次,或跨 ≥2 周重复 → 该沉淀进域 README 或 skill。
- 某 skill 的某一步**每次都要临场判断**(日志里反复出现同类犹豫/跳过)→ 该 skill 缺决策规则,提议**修订**。
- 出现了现有 skill 都不覆盖的重复流程 → 按 §8.3 信号评估**新建**。
- 某条纪律连续 2 周被违反 → 不是人的问题,是**规则不可执行**,提议改规则本身。

**分级**:全部 → 需你决策(给「改哪个文件的哪一节 + 改成什么」的具体提议,不直接改)。

---

## 报告结构(写 gbrain 页与呈现共用)

```markdown
# 周自省 <YYYY-MM-DD>(窗口 <起> ~ <止>)

## 一句话
<本周纪律整体状态;有整体性问题在此点出>

## 写回率(检查 1)
- 会话写入 <N> 条 / 定时写入 <M> 条 → 写回率 <N/(N+M)>(分母为 0 记「本周无写入」)
- 无来源 tag 的页:<K> 条(<历史页 / 本周写侧漏打标,后者要点名 slug>)
- 取证方式:<gbrain --tag 精确计数 / proxy 估算(说明原因)>
- 提醒面:session_count <涨没涨> / 轻提示 <发没发>

## 立即可做(N)
- [问题] 证据:`<命令输出片段>` → 结论:<...>
  修复:`<具体命令或编辑动作>`

## 需你决策(N)
- [问题] 证据:... → 结论:...
  选项:A ... / B ...;推荐 A,因为 ...

## 观察中(N)
- [信号] 证据:... → 出现 1 次,下周复核

## 无法判定(N)
- [检查 X] 缺:<什么证据> → 补法:<怎么拿到>

## 基线数据(供跨周对比)
- 会话写入数 / 定时写入数 / 写回率 / 无来源 tag 页数
- state 页本周更新数 / 未挂接项目数 / 断指针数 / inbox 停滞数 / cron 失败数 / 契约外 type 页数
```

「基线数据」是跨周对比的锚——单周的数字没意义,连续几周的走向才说明飞轮在加速还是在锈住。
