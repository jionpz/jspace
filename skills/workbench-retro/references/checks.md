# workbench-retro — 六条检查细则(取证 + 判读 + 分级)

每条检查三段式:**证据命令**(只读)→ **判读规则**(写死阈值,不靠感觉)→ **分级归属**。
通用约束:证据拿不到(命令失败/输出为空/依赖不可达)→ 该条记「**无法判定** + 缺什么证据 + 怎么补」,**不猜、不省略、不用其它条的结论推断**。

`<filehub>` = `.jspace/hub.json` 中 `type: filehub` 资源 `primary: true` path(经 `local.json` 绑定);解析不到 → 检查 2/3/5 全部记「无法判定(filehub 未注册)」。

---

## 检查 1 · 写回执行率(最重要)

「本周明明有活动,却没有一条持久事实进 gbrain」——这是飞轮停摆最典型的形态,且完全无声。

**证据**
```bash
gbrain list --type note -n 50            # 看 project/<id>/state 页与 updated_at
gbrain list --type lesson -n 20          # 本周有无新知识页
ls -la <filehub>/projects/*/ | head -40  # 资产层本周有无文件变动
ls .jspace/logs/cron/*/                  # cron 活动痕迹(佐证「这周确实在用」)
```

**判读**
- 活动信号 = 本周内 filehub 有文件新增/修改,或 cron 成功运行,或域/hub 有变更。
- 某项目有活动信号,但其 `project/<id>/state` 页 `updated_at` ≥7 天未动 → **写回缺口**。
- 全工作台本周 0 个 state 页更新且有活动信号 → **写回腿停摆**(整体性问题,优先级最高)。
- 本周有 ≥1 条 state 更新 → 记录实际条数,不评价好坏(基线数据,供跨周对比)。

**分级**:单项目缺口 → 需你决策(问「X 项目这周的进展要不要补记」);整体停摆 → 需你决策 + 在报告开头单独点出。

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

gbrain reference 页的 `Pointer` 指向资产本体;文件被移动/改名/未同步 → 指针断,召回时才发现就晚了。

**证据**
```bash
gbrain list --type reference -n 20                 # 取样本(≤5 个,优先本周新增)
gbrain get <slug>                                   # 读 Pointer / rel_path 字段
test -f "<Pointer>" && echo OK || echo BROKEN
```

**判读**
- 抽样 ≤5 条(全量扫描成本高、收益低;跨周轮换样本)。
- `test -f` 失败但 `rel_path` 能经「本机 filehub 根 + rel_path」解析到实际文件 → **指针待重解析**(换机场景,非损坏)。
- 两者都失败 → **断指针**。
- 页缺 `rel_path` 字段 → **纪律缺口**(写侧没按 M5 纪律写)。

**分级**:待重解析 / 断指针 → 立即可做;纪律缺口 → 需你决策(是否回写侧修 asset-ingest)。

---

## 检查 4 · 流程卡点

**证据**
```bash
jspace cron check          # 未 ack incident + pending 暂存写 + 各 cron 状态
jspace ingest list         # in-progress / cleanup-pending journal
jspace pending list        # gbrain 锁冲突暂存
ls .jspace/logs/cron/*/ | tail -20
```

**判读**
- `needs_attention > 0` → **有未处置失败**。
- ingest journal 存在 in-progress/cleanup-pending 且 ≥2 天未推进 → **入库中断未续跑**。
- pending 暂存 ≥1 条且 ≥1 天未 apply → **写入堆积**。
- 同一 cron 本周失败 ≥2 次 → **重复失败**(区别于偶发:偶发=1 次且下次成功)。

**分级**:未处置失败/中断/堆积 → 立即可做(附续跑或 ack 命令);重复失败 → 需你决策(要查根因,可能是配额/网关/契约问题)。

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
gbrain list --type lesson -n 20                     # 本周新增知识页主题
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
- state 页本周更新数 / 未挂接项目数 / 断指针数 / inbox 停滞数 / cron 失败数
```

「基线数据」是跨周对比的锚——单周的数字没意义,连续几周的走向才说明飞轮在加速还是在锈住。
