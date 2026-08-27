# 使用里程协议(USAGE-MILEAGE)

> 可复跑的**使用验证**协议:证明记忆 / 资产 / 自省三个飞轮**在转**,而不是「机制已建」。
> 关闭条件全部落在**真实命令输出**上——机制存在不算、感想不算、CI 假绿不算。
> 本文件为**中性版**(`<wb>` = 工作台根、`<filehub>` = 文件中心根、`<date>` = `YYYY-MM-DD`)。某台机器的真实证据(数字/路径/日期)填进本机的证据台账与对应 retro 页,不写回本文件。

## 红线(先读,三条)

1. **禁伪造** `source:session`:不手工 `gbrain put` 灌假会话页、不给历史页补 tag、不用测试页冒充日常收工。
2. **提醒 ≠ 写回**:`jspace context turn` 的收工轻提示、claude/cursor 的 session-end hook 都**不写 gbrain**。它们发了多少次和 `source:session` 计数无关;只有显式跑 `memory-writeback` 才产生分子。
3. **无法判定 ≠ 未达标 ≠ 已关闭**:证据拿不到就记「无法判定 + 缺什么 + 怎么补」,既不猜、也不用降级 proxy 冒充精确数去关闭任何一条腿。

## 三腿与关闭条件总览

| 腿 | 关闭条件 | 协议 |
|---|---|---|
| 自省 | 无头 `workbench-retro` 首跑产出合格 retro 页 | R1 |
| 记忆 | 连续两周 `source:session` 落窗口计数 > 0 | R2 |
| 资产 | 近两周至少一次「入库 → 本体归位 → gbrain 指针」闭环,或显式 deferred 且可见 | R3 资产飞轮 |

---

## R1 · workbench-retro 无头首跑协议

### 前置

1. first-use 已完成或等价:gbrain 可用、`jspace doctor --dir <wb>` 无 error、filehub 已注册。**不满足仍可跑**,但 retro 的检查 2/3/5 会大面积「无法判定」,报告里必须标明。
2. 用户已显式开启:`jspace cron enable workbench-retro --dir <wb>`(模板出厂 `enabled: false`,不开则本协议不适用)。
3. harness / 配额已接线(同 `~/.agents/skills/jspace-use/SKILL.md` 第 2 章 4.5:**未接线先别装调度**);`.jspace/cron.json` 的 `harness` 字段与本机实际可执行的无头 harness 一致。

### 步骤(有序)

| 步 | 动作 | 合格信号 |
|---|---|---|
| 1 | `jspace cron run workbench-retro --dir <wb>`(rehearsal,可先于 `install`) | exit 0;`.jspace/logs/cron/workbench-retro/<ts>.md` 有本次输出 |
| 2 | `gbrain get records/retro/<date>` | 页存在;`tags` 含 `retro` + **`source:cron`**;含「写回率」一节;每条结论都有证据行 |
| 3 | 对比跑前后 `jspace doctor --dir <wb>` | 无因 retro 引入的新 error;无头模式**未改**任何 hub / 规则 / skill 文件 |
| 4(可选加强) | `jspace cron install --dir <wb>` 后等到周日 23:00 **自然触发**一次 | `.jspace/state/runs` 与 logs 时间戳同调度一致;`jspace cron check` 无未处理失败 |

### 失败处置

- rehearsal 失败 → 记 incident,跑 `jspace cron check --dir <wb>` 看聚合;修前置后重跑。**不**把失败算成部分关闭。
- 页写成旧 slug `memory/retro/...` → **不合格**(canonical 是 `records/retro/`)。存量 `cron.json` 若仍指旧路径,按 user 数据手工改(`workspace upgrade` 永不覆盖 cron.json)。
- 无头却改了文件 → 违反「retro 只提议不改」红线,协议失败;先修 skill / 运行配置再验。

### 本协议关闭条件

至少完成步 1–3 一次,并把日期、页 slug、log 路径、doctor 前后摘要写入证据台账。步 4 是加强项,可标注「部分关闭 / 全部关闭」。

**术语防混用**:这里的 `jspace cron run` 只支撑一个 claim —— **skill 在无头模式下跑通并产出合格 retro 页**。它**不能**用来关闭「系统调度器到点把任务拉起」(那条要真机自然触发,台账在开发仓库的外部文档 `docs/PLATFORMS.md`,不随工作台物化)。GOAL / 台账回写时两者必须分开表述。

---

## R2 · 连续两周 `source:session` 取证

### 计数口径(与 `~/.agents/skills/workbench-retro/references/checks.md` 检查 1 同源)

```bash
gbrain list --type note --tag source:session -n 50   # 会话写入(分子)
gbrain list --type note --tag source:cron -n 50      # 定时写入(对照)
```

- 只数 `updated_at` **落在该周窗口**内的页 → `session_writes`(窗口默认自然周或近 7 天,**与当周 retro 报告窗口一致**,不另起一套日历)。
- **不得**把无来源 tag 的历史页折算进 session 腿(retro 把它们单独记成「无来源 tag」桶)。
- 新写的页却漏 tag → 记**写侧纪律缺口**(点名 slug / skill),不算达标凑数。
- tag 查询在本机 gbrain 版本上不可用 → 记「无法判定 + 缺来源 tag 查询能力」;可用 checks.md 的降级 proxy 做基线,但**必须标明「proxy 估算」且不得用它关闭本条**。

### 两周窗口

1. 选定起点周 `W0`:来源 tag 约定已在真实工作台生效、且此后至少有一次真实会话活动。不必对齐日历上的任意特定日。
2. 每周日(或与 retro 同窗)记一行:

   | 周次 | 窗口起止 | `session_writes` | `cron_writes` | 取证命令输出摘要 | retro 页 slug |
   |---|---|---|---|---|---|
   | W1 | | | | | `records/retro/<date>` |
   | W2 | | | | | `records/retro/<date>` |

3. **达标** = W1 与 W2 **连续两周**均 `session_writes > 0`。中断则重新计起点,不允许挑两个不相邻的好周拼起来。
4. **回写**(达标与未达标都要诚实写):真实数字 + 窗口日期 + 对应 retro 页 slug;仅一周 >0 或仍为 0 时保持开放,写清现状,**不**用工程交付假装关闭。

### 与 doctor 的关系(别把两者当同一件事)

`jspace doctor --verbose` 的 **`memory.writeback_habit_unverified`(info)** 只说明「会话已有里程、轻提示发出过,请自己核对写回腿」——doctor **不查 gbrain**,量不到写回率。它出现不等于 `session_writes == 0`,不出现也不等于达标。精确计数只有两个来源:本协议的 `gbrain list --tag` 与 retro 检查 1。诊断码释义见 `~/.agents/skills/jspace-use/SKILL.md` 第 6 章。

---

## R3 · 三飞轮使用里程清单

人跑,每周或关闭前勾选。**每条都要能指向命令输出或路径**,感想不算。

### 记忆飞轮

- [ ] 本周至少一次显式收工写回(`memory-writeback`),且 `gbrain list --type note --tag source:session` 能列到新页
- [ ] 周日 `memory-consolidate` 有成功痕迹(cron log 或 `records/consolidate/<date>`),或用户显式 deferred 且 doctor 可见
- [ ] (跨周)连续两周 `session_writes > 0`(接 R2)——**记忆腿关闭条件**

### 资产飞轮

- [ ] filehub 已注册;`_inbox/` 有清晰处置路径(会话整理或 `inbox-tidy` cron)
- [ ] 近两周至少一次入库闭环:本体进 `<filehub>/projects|areas/...` + gbrain asset 指针页(`tags` 含 `asset` + 来源 tag)
- [ ] retro 检查 3 抽样无未解释断指针;或已记「立即可做」并在跟踪

### 自省飞轮

- [ ] `workbench-retro` 已 enable(或 first-use 记录 deferred 且代价已知)
- [ ] 完成 R1 无头首跑;等价降级 = 会话模式跑通六条检查并产出合格 retro 页(**无头首跑仍是加强项,须在台账里标明用了哪条**)
- [ ] 连续 ≥2 周存在 `records/retro/<date>` 且含写回率一节;「观察中」项按周复现升级规则处理

### 总控(不是飞轮,但挡转速)

- [ ] `jspace doctor --dir <wb>` 无 error;`cron.all_disabled` 若存在则用户已知晓
- [ ] 未破坏红线:提醒不代写;retro 只提议不改

---

## 证据台账模板(每台机器各填一份)

放进本机记录(如 gbrain `records/retro/<date>` 页的附节,或工作台内的使用记录),**不回填本文件**。

| 项 | 日期 | 证据(命令 / 路径 / 数字) | 结论 |
|---|---|---|---|
| R1 rehearsal | | `cron run` exit + log 路径 + retro 页 slug | 合格 / 不合格 / 无法判定 |
| R1 自然触发(可选) | | runs 与 logs 时间戳 + `cron check` | 已验证 / 未做 |
| R2 W1 `session_writes` | | `gbrain list --tag source:session` 摘要 | N = ? |
| R2 W2 `session_writes` | | 同上 | N = ? |
| R3 资产闭环 | | 本体路径 + 指针页 slug | 已闭环 / deferred |
| 总控 | | `jspace doctor` 摘要 | 无 error / 有 error(列出) |

用词纪律:**已验证**(有真实证据行)/ **替代关闭**(必须附一句效力边界)/ **挂账开放**(写清缺什么)。三者不可混用,也不许把第三种写成前两种。
