# 使用里程协议(USAGE-MILEAGE)

> 可复跑的**使用验证**协议:证明记忆、资产、自省三个飞轮在转,而不是“机制已建”。
> 关闭条件必须落在真实命令输出、页读回和文件证据上。
>
> 变量:`<wb>` = 工作台根;`<filehub>` = 本机 filehub 根;`<Monday>` / `<observed_through>` 取自 `jspace memory period --json`（补跑加 `--week <Monday>`）。
> 真实数字与路径填进本机台账和对应 retro 页,不写回本文件。

## 红线

1. **禁伪造 `source:session`**。不手工写入测试页冒充日常收工,不给历史页补 tag 以制造其未曾声明的运行来源。页面写入统一使用结构化 `gbrain call put_page`,运行模式 tag 必须与实际运行方式一致。
2. **提醒不等于写回**。`jspace context turn` 的收工提示与各 harness 的 session-end hook 都不写 gbrain;只有显式执行 `memory-writeback` 才产生会话写回证据。
3. **无法判定不等于未达标或已关闭**。查询失败、keyset 未完成、backlink coverage degraded 或依赖不可达时,记 `unknown/partial + 缺什么 + 怎么补`;不得用 proxy 关闭业务验收。

### 2026-09-17 历史裁决

历史证据记录过一次旧文本 CLI 口径下的 W1 复核:

- W1 = `2026-09-14 ~ 2026-09-20`,截至 `2026-09-17`;
- 业务写入 42,其中当时示例项目 33、非该项目 9;工具写入 5;`source:cron` 窗口内 0;
- 33 条中有 31 条的页内 frontmatter 在写入当时已声明 `session <日期>`;
- 首周“有会话写回”的结论由非该项目 9 条独立支撑,W2 当时尚未到期。

这是**旧文本 CLI 的历史取证,不能按当前结构化 CLI 原样重放**。原记录保存在开发仓库 `docs/GOAL-HISTORY.md`,本文件不改写其数字与效力。当前复核必须重新走 `list_pages` keyset + 逐页 `get_page`;旧 tag 操作“不改 updated_at”的历史观察不自动适用于当前的完整页 + revision CAS。

## 三腿与关闭条件总览

| 腿 | 关闭条件 | 协议 |
|---|---|---|
| 自省 | 无头 `workbench-retro` 首跑产出合格 retro 页 | R1 |
| 记忆 | 连续两个完整周窗口的 `source:session` 业务写回页数 > 0 | R2 |
| 资产 | 近两周至少一次“入库 -> 本体归位 -> gbrain 指针读回”闭环,或显式 deferred 且可见 | R3 |

---

## R1 - workbench-retro 无头首跑

### 前置

1. first-use 已完成或等价:gbrain 可用、`jspace doctor --dir <wb>` 无 error、filehub 已注册。不满足仍可跑,但检查 2/3/5 会大面积 `unknown`。
2. 用户已显式开启:`jspace cron enable workbench-retro --dir <wb>`。模板出厂 `enabled: false`,未开启时本协议不适用。
3. cron harness 已接线且本机可执行;会话级 harness 接线统一使用 `jspace harness wire --harness <name> --dir <wb>`。

### 步骤

| 步 | 动作 | 合格信号 |
|---|---|---|
| 1 | `jspace cron run --id workbench-retro --dir <wb>`(rehearsal,可先于 install) | exit 0;`.jspace/logs/cron/workbench-retro/<ts>.md` 有本次输出 |
| 2 | `gbrain call get_page '{"slug":"records/retro/<Monday>","include_content":true}'` | 页存在;tags 含 `retro`、`weekly` 与恰好一个模式 tag;正文含窗口、`observed_through`、写回率和证据行 |
| 3 | 对比跑前后 `jspace doctor --dir <wb>` | 无因 retro 引入的新 error;无头模式未改 hub、规则、skill 或资产 |
| 4(可选加强) | `jspace cron install --dir <wb>` 后等待自然调度触发 | `.jspace/state/runs` 与 logs 时间戳一致;`jspace cron failures --json` 无未处置项 |

周日 23:00 是调度时间,不是周 id。无论自然触发还是人工重跑,周期身份都取本地周一 `<Monday>`。

周期身份、窗口和 cutoff 一律先由 `jspace memory period --json` 生成;不得在协议步骤里另写日期算法。

### 失败处置

```bash
jspace cron failures --dir <wb> --json
jspace cron run --id workbench-retro --dir <wb>
```

- rehearsal 失败 -> 记录 incident 和聚合项;修前置后重跑,不把失败算成部分关闭。
- 页写成旧 slug `memory/retro/...` -> 不合格;存量 `cron.json` 是用户数据,`workspace upgrade` 不覆盖,按迁移说明人工修正。
- 用执行当天或周日日期作为周 id -> 不合格;canonical 是 `records/retro/<Monday>`。
- 无头却修改其他文件 -> 违反“retro 只提议不改”,协议失败。

### 关闭条件

至少完成步 1-3 一次,并把日期、`<Monday>`、`observed_through`、页 slug、log 路径、doctor 前后摘要写入台账。步 4 是加强项。

**效力边界**:`jspace cron run --id ...` 只证明 skill 在无头模式跑通并产出合格页;它不能替代“系统调度器到点自行拉起”的真机证据。自然触发证据见开发仓库 `docs/PLATFORMS.md`,不随工作台物化。

---

## R2 - 连续两周 `source:session` 取证

计数口径与 `~/.agents/skills/workbench-retro/references/checks.md` 检查 1 同源。

### 页级取证

先用 keyset 列候选,逐页读取;列表行不能证明完整 tags、正文或维护用途:

```bash
gbrain call list_pages '{"tag":"source:session","limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"tag":"source:cron","limit":100,"sort":"updated_asc"}'
gbrain call get_page '{"slug":"<candidate-slug>","include_content":true}'
gbrain call list_pages '{"limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"limit":100,"sort":"updated_asc","updated_after":"<last.updated_at_iso>","updated_after_slug":"<last.slug>"}'
```

- 第一组命令用于发现来源候选;第二组全页 keyset 用于得到无来源 tag 的完整分母。
- 统计单位是页,不是命令运行、提醒或 agent turn 次数。
- 周期使用工作台本地周一,窗口 `[<Monday> 00:00, 下周一 00:00)`,并记录 `observed_through`;不得改用自然日、运行日或“最近 7 天”作为周 id。
- 只把窗口内业务更新的页计入来源比。tags 含 `activity:maintenance` 的页从业务计数中排除并单独报告;下一次真实业务更新应移除该维护用途。
- `source:session|cron` 是运行模式 tag;frontmatter `source` 是 harness;`content_origin` 是内容出处。三者不可互替。
- 无来源 tag 的页单独记桶,不折算进 session 或 cron 腿。
- 新页漏 tag 记写侧纪律缺口,点名 slug/skill,不算达标凑数。
- 来源 tag 查询失败、keyset 中断或窗口内页读失败 -> `unknown/partial`;proxy 只能作估算,不得关闭本条。

### 两周窗口

1. 选定起点周 `W0`:来源 tag 约定已在真实工作台生效,且之后至少有一次真实会话活动。
2. 每个完整周窗口记一行,或在周中记录 `observed_through` 并标 `partial`:

   | 周次 | 窗口起止(本地) | observed_through | session_writes | cron_writes | 维护排除 | 无 tag | retro slug |
   |---|---|---|---|---|---|---|---|
   | W1 | `<Monday>` ~ `<下周一>` | | | | | | `records/retro/<Monday>` |
   | W2 | `<Monday>` ~ `<下周一>` | | | | | | `records/retro/<Monday>` |

3. **达标** = W1 与 W2 两个连续周窗口的 `session_writes > 0`。中断则从新的 W1 重计,不能选两个不相邻的好周拼接。
4. 回写时同时写真实数字、窗口、`observed_through`、对应 retro slug 和覆盖状态;只有一周 > 0 时保持开放。

### 与 doctor 的关系

`jspace doctor --verbose` 的 `memory.writeback_habit_unverified`(info)只提示会话已有里程和轻提示,不查 gbrain,量不到写回率。它出现不等于 `session_writes == 0`,不出现也不等于达标。

---

## R3 - 三飞轮使用里程清单

每条都要能指向命令输出、页读回或路径;感想不算。

### 记忆飞轮

- [ ] 本期至少一次显式收工写回,且 `get_page` 读回该页 tags 恰含 `source:session`
- [ ] 本期 `memory-consolidate` 有成功痕迹(cron log 或 `records/consolidate/<Monday>`),或用户显式 deferred 且 doctor 可见
- [ ] 连续两个完整周窗口 `session_writes > 0`(R2),才可关闭记忆腿

### 资产飞轮

- [ ] filehub 已注册,`_inbox/` 有清晰处置路径(会话整理或 inbox cron)
- [ ] 近两周至少一次闭环:本体进入 `<filehub>/projects|areas/...`,asset 页 `get_page` 可读回,`rel_path` 能解析
- [ ] retro 检查 3 无未解释断指针;重复内容只报告,不自动移动/删除

### 自省飞轮

- [ ] `workbench-retro` 已 enable,或 first-use 记录 deferred 且代价已知
- [ ] 完成 R1;若只做会话模式,须在台账明确“无头首跑仍未做”
- [ ] 连续 >= 2 周存在 `records/retro/<Monday>` 且含写回率、窗口、`observed_through`

### 总控

- [ ] `jspace doctor --dir <wb>` 无 error;`cron.all_disabled` 若存在则用户已知晓
- [ ] 未破坏红线:提醒不代写、retro 只提议不改、维护活动不冒充业务写入

---

## 证据台账

放在本机 `<wb>/.jspace/usage-mileage-ledger.md`:该文件 gitignored、不回填本文件、不写假数字。`records/retro/<Monday>` 是当周审计,不是台账替代位置。

完整模板见同目录 `usage-mileage-ledger-template.md`。

### 用词纪律

| 词 | 含义 | 使用条件 |
|---|---|---|
| **已验证** | 有真实命令输出、页读回或路径 | 能贴证据 |
| **替代关闭** | 用 A 类证据关闭 B 类 claim | 必须附效力边界 |
| **挂账开放** | 已知缺什么、怎么补 | 未达标但不装关闭 |
| **无法判定** | 命令跑不通、coverage 不完整或依赖不可达 | 不猜,不用 proxy 冒充精确数 |

### GOAL M7 回写槽

腿关闭时复制到开发仓库 `GOAL.md` M7:

```markdown
- R1 retro 首跑:<date> / 页 `records/retro/<Monday>` / observed_through=<ISO-8601> / log `<wb>/.jspace/logs/cron/workbench-retro/<ts>.md` / verdict:已验证|部分关闭
- R2 两周 session:<W1 起止> writes=<n> observed_through=<...>; <W2 起止> writes=<n> observed_through=<...>; retro=<Monday slugs>; verdict:已验证|挂账开放
- R3 资产闭环:<date> / 本体 `<filehub>/...` / 指针 `assets/...` / rel_path 读回=是|否 ; 或 deferred:<原因+可见位置>
- Taxonomy freeze: M7 关闭前未扩 slug 根 / 新 routing tag(是|否|N/A)
```

---

## 首周启动清单

在工作台根执行,每步留证据行。

| 步 | 动作 | 合格信号 |
|---|---|---|
| 1 | `jspace workspace upgrade --dir <wb>` | skill/受管块刷新;doctor 无 error |
| 2 | `gbrain models doctor --json` | embedding 可达 |
| 3 | `jspace harness wire --harness <name> --dir <wb>` 后重启 harness | `gbrain check-resolvable` 的官方 skill 可达 |
| 4 | 复制台账模板 | `.jspace/usage-mileage-ledger.md` 存在 |
| 5 | 填机器元数据 | 工作台、filehub、harness、时区、W0 |
| 6 | 显式 enable 周期任务 | 只开启用户确认的 id |
| 7 | R1 rehearsal | `jspace cron run --id workbench-retro --dir <wb>` -> 合格 retro 页 |
| 8 | 约定收工习惯 | 会话结束触发 `memory-writeback`;提醒不等于写入 |
| 9 | 记 W0 | 来源 tag 约定生效后的第一个活动周 |
| 10 | 确认 taxonomy freeze | 台账勾选“M7 关闭前不扩 taxonomy” |

---

## 台账结构摘要

### A. 机器元数据

- 工作台根、filehub 根、主 harness、无头 cron harness、本地时区
- M7 起点日、R2 W0 周窗口
- 升级前页数快照(可选):`gbrain call list_pages '{"limit":100,"sort":"updated_asc"}'` 后按 keyset 统计;不得只取一页宣称总数

### B. R1 - 自省腿

| 项 | 日期 | 证据 | 结论 |
|---|---|---|---|
| rehearsal | | exit + log + `records/retro/<Monday>` get_page + observed_through + doctor 前后 | 合格/不合格/无法判定 |
| 自然触发(可选) | | runs/logs 时间戳 + `jspace cron failures --json` | 已验证/未做/无法判定 |
| 检查 6b 取代链 | | retro 报告或手动 backlinks 分页 + 候选读回 | 健康/带毒/无法判定 |

### C. R2 - 记忆腿

| 周次 | 窗口 | observed_through | session_writes | cron_writes | 维护排除 | 无 tag | retro slug | 达标 |
|---|---|---|---|---|---|---|---|---|
| W0 | | | | | | | | 起点 |
| W1 | | | | | | | `records/retro/<Monday>` | Y/N/partial |
| W2 | | | | | | | `records/retro/<Monday>` | Y/N/partial |

每周用 `list_pages` keyset + 逐页 `get_page` 复核,不以列表行计 tag 或正文。

### D. R3 - 资产腿

| 项 | 日期 | 本体路径 | 指针 slug | rel_path 读回 | 结论 |
|---|---|---|---|---|---|
| 闭环 #1 | | `<filehub>/projects|areas/...` | `assets/...` | 是/否 | 已闭环/待修 |
| deferred(若无) | | — | — | — | 原因 + 可见位置 |

### E. 纪律与冻结

- [ ] 本周有显式 `memory-writeback`,且逐页 `get_page` 证明 `source:session`
- [ ] 无伪造 tag、无 hook 代写、无维护页冒充业务增长
- [ ] retro 只提议,未擅自改 hub/skill
- [ ] taxonomy freeze 遵守或已有 Trellis 例外记录
- [ ] 已完结项目 state 已 `status:archived` 或 hub `archived`
- [ ] consolidate 候选有处置去向;真实复用无证据时只挂账

### F. M7 总判定

| 腿 | 关闭? | 证据指针 |
|---|---|---|
| 自省 R1 | | 台账 B 节 + GOAL 回写槽 |
| 记忆 R2 | | 台账 C 节 W1+W2 |
| 资产 R3 | | 台账 D 节 |
| **M7 整体** | 开放/已关闭 | 复制 GOAL 回写槽 |

---

## 与 retro / consolidate 的分工

| 产出 | 写哪里 | 台账怎么接 |
|---|---|---|
| `records/retro/<Monday>` | gbrain | 记录周一 slug、observed_through 和写回率 |
| `records/consolidate/<Monday>` | gbrain | 候选处置回链到台账 E 节 |
| 本台账 | 本机 `.jspace/usage-mileage-ledger.md` | 三腿关闭的主索引 |

retro 页是当周审计;台账是跨周里程计。两者数字冲突时,以完整 keyset + 逐页读回的证据复核结果为准,不以列表筛选或上次报告为准。
