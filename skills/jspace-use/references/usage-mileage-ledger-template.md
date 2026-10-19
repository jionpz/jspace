# M7 使用里程 - 证据台账(本机实例)

> 本文件是模板。复制到工作台:
>
> ```bash
> cp .jspace/skills/jspace-use/references/usage-mileage-ledger-template.md .jspace/usage-mileage-ledger.md
> ```
>
> 填真实数字与路径。禁止伪造 `source:session`;协议全文见 `usage-mileage.md`。

---

## 0. 机器元数据

| 字段 | 值 |
|---|---|
| 工作台根 `<wb>` | |
| filehub 根 `<filehub>` | |
| 本地时区 | |
| 主会话 harness | claude / cursor / grok / opencode / pi |
| 无头 cron harness | |
| M7 起点日 | YYYY-MM-DD |
| R2 计数起点 W0 | `<Monday>` ~ `<下周一>` |
| jspace 版本 / 升级日 | |
| gbrain 版本 / 页数快照(可选) | |

**Taxonomy freeze 确认**

- [ ] M7 关闭前不新增 slug 根或 routing tag(除非有 Trellis 证据与用户确认)
- [ ] 允许纪律修复、enforcement 和 retro 检查;`entity/` 仍按需

---

## 1. 首周启动

| 步 | 日期 | 动作 | 证据 / 结论 |
|---|---|---|---|
| 1 | | `jspace workspace upgrade --dir <wb>` | doctor 无 error:是/否 |
| 2 | | `gbrain models doctor --json` | embedding 可达:是/否 |
| 3 | | `jspace harness wire --harness <name> --dir <wb>` | check-resolvable:是/否 |
| 4 | | 本台账已复制到 `.jspace/usage-mileage-ledger.md` | 是/否 |
| 5 | | 显式 cron enable(列 id) | 已确认 id: |
| 6 | | `jspace cron run --id workbench-retro --dir <wb>` | `<Monday>` / slug: |
| 7 | | 约定收工触发 `memory-writeback` | 已约定 |

---

## 2. R1 - 自省腿

### 2a. rehearsal

| 字段 | 值 |
|---|---|
| 日期 | |
| 目标周周一 `<Monday>` | |
| 窗口 | `[<Monday> 00:00, <下周一> 00:00)` |
| observed_through | `<ISO-8601 with offset>` |
| 命令 | `jspace cron run --id workbench-retro --dir <wb>` |
| exit code | |
| log 路径 | `<wb>/.jspace/logs/cron/workbench-retro/` |
| retro 页 slug | `records/retro/<Monday>` |
| get_page 读回 revision | |
| tags 含 `retro`、`weekly`、恰好一个模式 tag | 是/否 |
| 含窗口、observed_through、写回率 | 是/否 |
| doctor 跑前 | |
| doctor 跑后 | |
| **结论** | 合格 / 不合格 / 无法判定 |

### 2b. 自然触发(可选加强)

| 字段 | 值 |
|---|---|
| 日期 | |
| 调度器证据 | runs/logs 时间戳 |
| `jspace cron failures --json` | |
| **结论** | 已验证 / 未做 / 无法判定 |

效力边界:`cron run --id ...` 只证明无头跑通,不等于系统调度器到点拉起。自然触发见开发仓库 `docs/PLATFORMS.md`。

### 2c. 取代链健康

| 字段 | 值 |
|---|---|
| 日期 | |
| 起点旧 slug | |
| `get_backlinks` 是否分页完成 / coverage | complete / partial / unknown |
| 候选 `get_page` 数 | |
| 正文 `Supersedes` 方向核对 | 通过 / 分叉 / 环 / 缺页 / 无法判定 |
| 处置 | 待裁决 / 已转交原生产者 |

只从旧页调用 `get_backlinks`;不得从旧页正文反向跟随。

---

## 3. R2 - 记忆腿

### 3a. 页级计数

```bash
gbrain call list_pages '{"tag":"source:session","limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"tag":"source:cron","limit":100,"sort":"updated_asc"}'
gbrain call get_page '{"slug":"<candidate-slug>","include_content":true}'
```

无 tag 桶必须用全页 keyset 扫描后逐页读取,不能由两个 tagged 查询相减:

```bash
gbrain call list_pages '{"limit":100,"sort":"updated_asc"}'
gbrain call list_pages '{"limit":100,"sort":"updated_asc","updated_after":"<last.updated_at_iso>","updated_after_slug":"<last.slug>"}'
```

只数窗口内发生业务更新的页。`activity:maintenance` 页从业务计数排除并单列。`source:session|cron` 是运行模式 tag;frontmatter `source` 是 harness;`content_origin` 是内容出处。

| 周次 | 窗口(本地) | observed_through | session_writes | cron_writes | 维护排除 | 无 tag | 漏 tag 纪律缺口 | retro slug | 覆盖 | 达标 |
|---|---|---|---|---|---|---|---|---|---|---|
| W0 | | | | | | | | | 起点 |
| W1 | | | | | | | | `records/retro/<Monday>` | complete/partial/unknown | Y/N |
| W2 | | | | | | | | `records/retro/<Monday>` | complete/partial/unknown | Y/N |
| W3 | | | | | | | | | | |
| W4 | | | | | | | | | | |

**R2 关闭条件**:W1 与 W2 两个连续完整周窗口的 `session_writes > 0`。中断则重新计 W0。部分窗口只能记 `partial`,不能关闭。

### 3b. 收工习惯佐证

| 字段 | 值 |
|---|---|
| `memory.writeback_habit_unverified` 是否出现 | 是/否(info,仅提示) |
| 备注 | |

---

## 4. R3 - 资产腿

### 4a. 入库闭环

| # | 日期 | 触发 | 本体路径 | 指针 slug | get_page tags | rel_path 解析 | 结论 |
|---|---|---|---|---|---|---|---|
| 1 | | 会话 / inbox / 手动 | `<filehub>/projects/...` | `assets/...` | asset + 模式 tag | 是/否 | 已闭环 / 待修 |
| 2 | | | | | | | |

### 4b. deferred

| 字段 | 值 |
|---|---|
| 原因 | |
| 可见位置 | retro 页 / doctor / 本台账 |
| 预计补做 | |

### 4c. 指针与查重

| 日期 | 抽样数 | 断指针 | duplicate_content | 结论 |
|---|---|---|---|---|
| | | 0 / N | 0 / N | 健康 / 待修 / unknown |

`filehub.asset.duplicate_content` 只提示人工处置,不自动移动或删除文件。

---

## 5. 每周纪律快照

| 周次 | 会话 writeback | consolidate `<Monday>` | retro `<Monday>` | 晋升候选处置 | 衰减候选处置 | archived 项目 |
|---|---|---|---|---|---|---|
| W1 | Y/N | Y/N | Y/N | 已处理/无/挂账/拒绝 | 已处理/无/挂账/拒绝 | Y/N/NA |
| W2 | | | | | | |
| W3 | | | | | | |

**候选来源**:`records/consolidate/<Monday>` 末尾候选节。晋升必须有第二项目真实复用证据;无证据只能挂账,不能靠 fixture、维护更新或反复出现关闭。

---

## 6. 三飞轮勾选

### 记忆

- [ ] 本期至少一次显式收工写回,逐页 `get_page` 证明 `source:session`
- [ ] consolidate 有成功痕迹或 honest deferred
- [ ] W1+W2 连续 `session_writes > 0`

### 资产

- [ ] filehub 已注册,inbox 有处置路径
- [ ] 近两周入库闭环或 §4b deferred
- [ ] 指针抽样无未解释断链;重复内容已交人工处置

### 自省

- [ ] workbench-retro 已 enable 或 deferred 可见
- [ ] R1 rehearsal 合格
- [ ] >= 2 周合格 retro 页含窗口、observed_through 和写回率

### 总控

- [ ] `jspace doctor` 无 error
- [ ] 未违反红线:禁伪造 tag / retro 只提议 / hook 不写 gbrain / 维护不冒充业务

---

## 7. M7 总判定与 GOAL 回写

填写时机:三腿证据齐或诚实挂账后。

| 腿 | 关闭? | 关键证据 |
|---|---|---|
| R1 自省 | 是 / 否 / 部分 | §2 |
| R2 记忆 | 是 / 否 | §3 W1+W2 |
| R3 资产 | 是 / 否 / deferred | §4 |
| Taxonomy freeze 遵守 | 是 / 违规(说明) | §0 |
| **M7 整体** | 开放 / 已关闭 | |

### 复制到开发仓库 `GOAL.md` M7

```markdown
- R1 retro 首跑:<date> / 页 `records/retro/<Monday>` / observed_through=<ISO-8601> / log `<path>` / verdict:
- R2 两周 session: W1(<起止>) writes=<n> observed_through=<...>; W2(<起止>) writes=<n> observed_through=<...>; retro=
- R3 资产:<date> / 本体 `<path>` / 指针 `assets/...` / rel_path 读回=是|否 ; 或 deferred:
- Taxonomy freeze 期间未扩 slug 根:是/否
- M7 verdict:已关闭 / 挂账开放(缺:)
```

---

## 8. 变更 log

| 日期 | 变更 |
|---|---|
| | 台账创建 |
| | |
