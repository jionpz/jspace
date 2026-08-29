# M7 使用里程 · 证据台账（本机实例）

> **本文件是模板** — 复制到工作台使用,例如:
> `cp .jspace/skills/jspace-use/references/usage-mileage-ledger-template.md .jspace/usage-mileage-ledger.md`
>
> 填**真实**数字与路径;禁止伪造 `source:session`。协议全文:`usage-mileage.md`。

---

## 0. 机器元数据（填一次）

| 字段 | 值 |
|---|---|
| 工作台根 `<wb>` | |
| filehub 根 `<filehub>` | |
| 主会话 harness | claude / cursor / grok / opencode / pi |
| 无头 cron harness | |
| M7 起点日 | YYYY-MM-DD |
| R2 计数起点 W0（周起止） | YYYY-MM-DD ~ YYYY-MM-DD |
| jspace 版本 / 升级日 | `jspace --version` = |
| gbrain 页数快照(可选) | |

**Taxonomy freeze 确认**（勾选表示已读,非关闭条件）:

- [ ] M7 关闭前不新增 slug 根 / routing tag（见 `gbrain.md`「Taxonomy freeze」）
- [ ] 允许:纪律修复、enforcement、retro 检查;`entity/` 仍按需

---

## 1. 首周启动（kickoff checklist）

| 步 | 日期 | 动作 | 证据 / 结论 |
|---|---|---|---|
| 1 | | `jspace workspace upgrade --dir <wb>` | doctor 无 error: 是/否 |
| 2 | | `gbrain models doctor --json` | embedding 可达: 是/否 |
| 3 | | `jspace gbrain wire --dir <wb>` | check-resolvable: 是/否 |
| 4 | | 本台账已复制到 `.jspace/usage-mileage-ledger.md` | 是/否 |
| 5 | | cron enable（列 id） | |
| 6 | | R1 `jspace cron run workbench-retro` | retro slug = |
| 7 | | 收工习惯约定（memory-writeback + source:session） | 已约定 |

---

## 2. R1 · 自省腿

### 2a. rehearsal（必做）

| 字段 | 值 |
|---|---|
| 日期 | |
| 命令 | `jspace cron run workbench-retro --dir <wb>` |
| exit code | |
| log 路径 | `<wb>/.jspace/logs/cron/workbench-retro/` |
| retro 页 slug | `records/retro/YYYY-MM-DD` |
| tags 含 `source:cron` | 是 / 否 |
| 含「写回率」一节 | 是 / 否 |
| doctor 跑前 | （摘要） |
| doctor 跑后 | （摘要,无新 error: 是/否） |
| **结论** | 合格 / 不合格 / 无法判定 |

### 2b. 自然触发（可选加强）

| 字段 | 值 |
|---|---|
| 日期 | |
| 调度器证据 | runs / logs 时间戳 |
| `jspace cron check` | |
| **结论** | 已验证 / 未做 / 无法判定 |

> 效力边界:`cron run` 只证明无头跑通,**不**等于系统调度器到点拉起（外部文档 `docs/PLATFORMS.md`——开发仓库,不随工作台物化）。

### 2c. 检查 6b · 取代链健康（retro 或手动）

| 字段 | 值 |
|---|---|
| 日期 | |
| 抽样 / retro 结论 | 健康 / 带毒（点名 slug）/ 无法判定 |
| 处置 | 待裁决 / 已按取代协议补打 |

---

## 3. R2 · 记忆腿（每周记一行）

**计数口径**（与 retro 检查 1 同源）:

```bash
gbrain list --type note --tag source:session -n 50
gbrain list --type note --tag source:cron -n 50
```

只数 `updated_at` 落在**该周窗口**内的页。无来源 tag 的历史页 → 单独记「无 tag 桶」,**不**折算进 session。

| 周次 | 窗口起止 | session_writes | cron_writes | 无 tag 桶 | 漏 tag 纪律缺口 | retro slug | 本周达标 |
|---|---|---|---|---|---|---|---|
| W0 | | | | | | | （起点） |
| W1 | | | | | | | Y/N |
| W2 | | | | | | | Y/N |
| W3 | | | | | | | |
| W4 | | | | | | | |

**R2 关闭条件**: W1 与 W2 **连续**两周 `session_writes > 0`。中断则重新计 W0。

### 3b. 收工习惯佐证（可选）

| 字段 | 值 |
|---|---|
| `jspace doctor --verbose` 是否出现 `memory.writeback_habit_unverified` | 是/否（info 仅提示,不替代计数） |
| 备注 | |

---

## 4. R3 · 资产腿

### 4a. 入库闭环（近两周至少一次,或 honest deferred）

| # | 日期 | 触发 | 本体路径 | 指针 slug | tags | 结论 |
|---|---|---|---|---|---|---|
| 1 | | 会话 / inbox-tidy / 手动 | `<filehub>/projects/…` | `assets/…` | asset + source:* | 已闭环 |
| 2 | | | | | | |

### 4b. deferred（若无闭环,必填）

| 字段 | 值 |
|---|---|
| 原因 | |
| 可见位置 | retro 页 / doctor / 本台账 |
| 预计补做 | |

### 4c. 指针健康（retro 检查 3 摘要）

| 日期 | 抽样数 | 断指针 | 结论 |
|---|---|---|---|
| | | 0 / N | 健康 / 待修 |

---

## 5. 每周纪律快照（与 retro 同窗更新）

复制到每周 retro 后填一行,或只在 retro 周填。

| 周次 | 显式 writeback | consolidate 跑通 | retro 跑通 | 晋升候选裁决 | 衰减候选裁决 | archived 项目已标 |
|---|---|---|---|---|---|---|
| W1 | Y/N | Y/N | Y/N | 已处理/无/跳过 | 已处理/无/跳过 | Y/N/NA |
| W2 | | | | | | |
| W3 | | | | | | |

**晋升/衰减候选来源**: `records/consolidate/<date>` 末尾两节;retro 只提议不改。

---

## 6. 三飞轮勾选（R3 清单,关闭前复核）

### 记忆

- [ ] 本周 ≥1 次显式收工写回,新页 `source:session` 可查
- [ ] consolidate 有成功痕迹或 honest deferred
- [ ] （跨周）W1+W2 连续 `session_writes > 0`

### 资产

- [ ] filehub 已注册,inbox 有处置路径
- [ ] 近两周入库闭环或 §4b deferred
- [ ] 指针抽样无未解释断链

### 自省

- [ ] workbench-retro 已 enable 或 deferred 可见
- [ ] R1 rehearsal 合格
- [ ] ≥2 周合格 retro 页含写回率

### 总控

- [ ] `jspace doctor` 无 error
- [ ] 未违反红线（禁伪造 tag / retro 只提议 / hook 不写 gbrain）

---

## 7. M7 总判定与 GOAL 回写

**填写时机**:三腿证据齐或诚实挂账后。

| 腿 | 关闭? | 关键证据 |
|---|---|---|
| R1 自省 | 是 / 否 / 部分 | §2 |
| R2 记忆 | 是 / 否 | §3 W1+W2 |
| R3 资产 | 是 / 否 / deferred | §4 |
| Taxonomy freeze 遵守 | 是 / 违规(说明) | §0 |
| **M7 整体** | **开放 / 已关闭** | |

### 复制到开发仓库 `GOAL.md` M7（关闭时）

```markdown
- R1 retro 首跑:<YYYY-MM-DD> / 页 `records/retro/<date>` / log `<path>` / verdict:
- R2 两周 session: W1(<起止>)=<n> ; W2(<起止>)=<n> ; retro=
- R3 资产:<date> / 本体 `<path>` / 指针 `assets/…` ; 或 deferred:
- Taxonomy freeze 期间未扩 slug 根: 是/否
- M7 verdict: 已关闭 / 挂账开放（缺:）
```

---

## 8. 变更 log（可选）

| 日期 | 变更 |
|---|---|
| | 台账创建 |
| | |
