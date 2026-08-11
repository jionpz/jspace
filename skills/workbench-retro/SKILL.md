---
name: workbench-retro
description: "**每周自省**:审计工作台纪律有没有被执行、流程哪里反复卡、规则/skill 该不该修订,产出分级建议清单(只提议不改)。Use when 周自省/复盘/本周回顾/工作流体检/retro。Do NOT use for 归纳本周事实内容(→memory-consolidate cron)、收工写回(→memory-writeback)、命令级故障排查(→jspace-use §7)。"
triggers:
  - "周自省"
  - "复盘"
  - "本周回顾"
  - "工作流体检"
  - "retro"
  - "workbench retro"
  - "纪律检查"
---

# workbench-retro — 每周自省(元过程侧)

工作台用久了不是坏在功能上,是坏在**纪律静默腐化**:该写回的没写、新项目没挂接、指针悄悄断掉、模糊项每周被跳过。这些都不报错,只是慢慢地让「越用越强」变成「越用越乱」。本 skill 每周做一次取证式审计,产出**分级建议清单**——只提议,不改。

## 与 memory-consolidate 的分工(别互相抄)

| | memory-consolidate(cron) | 本 skill |
|---|---|---|
| 看什么 | 本周产生了**什么事实** | 本周**纪律有没有被执行**、流程哪里卡 |
| 输入 | gbrain 近一周页面 | gbrain + filehub + cron 日志 + registry 结构 |
| 输出 | `records/consolidate/<date>` + state 回写 | `records/retro/<date>` + 建议清单 |
| 失败模式 | 事实丢失 | 纪律腐化(无声) |

时序:retro 排在 consolidate **之后**,可把巩固页当输入之一——「巩固页说 X 项目本周有活动,但 X 的 state 页 10 天没动」这类交叉信号只有后跑才拿得到。

## 何时用 / 何时不用
- ✅ 用:每周一次(cron 自动或说「周自省」);怀疑纪律松了;连续几周感觉「东西越来越乱」。
- ❌ 不用:归纳本周事实内容 → memory-consolidate cron;单次收工写回 → `memory-writeback`;某条命令报错要排查 → `jspace-use` §7;资料入库 → `asset-ingest`。

## 铁律:取证,不感想

自省最容易退化成「AI 编一段听起来对的反思」。**每条结论必须绑定一条取证命令的实际输出**;拿不到证据就写「无法判定 + 缺什么证据」,**不许猜、不许润色成结论**。六条检查的完整取证细则 → `~/.agents/skills/workbench-retro/references/checks.md`。

## 决策表

| 判断 | 取值 | 动作 |
|---|---|---|
| 证据可得性 | 命令成功 / 失败或为空 | 按判读规则定级 / 记「无法判定 + 缺失证据」,不猜 |
| 问题类型 | 机械偏差(挂接缺失/断指针) | **立即可做**:给出具体修复命令,待确认 |
| | 需要人判断(建域/改纪律/改 skill) | **需你决策**:给选项 + 推荐项 + 理由 |
| | 信号不足(出现 1 次) | **观察中**:记录,下周复核是否复现 |
| 同一问题连续 ≥2 周出现 | 是 | 升级:从「观察中」提到「需你决策」,并说明已复现 N 周 |
| 运行模式 | 会话 / 无头(cron) | 呈现清单待确认 / **只产报告,不提问、不修改** |

## 命令速查

```bash
# 取证(只读;逐条判读见 references/checks.md)
gbrain list --type note -n 50                     # state 页与更新时间(检查 1)
ls <filehub>/projects/ && jspace project list      # 挂接一致性(检查 2)
gbrain list --type reference -n 20                 # 指针抽样源(检查 3)
jspace cron check && jspace ingest list && jspace pending list   # 流程卡点(检查 4)
find <filehub>/_inbox -type f -mtime +7            # inbox 停滞(检查 5)
ls .jspace/logs/cron/*/ | tail -20                 # 本周 cron 运行痕迹(检查 4/6)

# 产出
gbrain put records/retro/<YYYY-MM-DD> < <报告文件>   # dated memory record,同周覆盖同页
```

`<filehub>` = `.jspace/hub.json` 中 `type: filehub` 资源的 `primary: true` path(经 `local.json` 绑定解析)。

## 步骤(主流程骨架)

1. **定窗口**:默认近 7 天;说清起止日期,后续所有判读都相对它。
2. **取证**:跑六条检查的命令(`~/.agents/skills/workbench-retro/references/checks.md`),**留下实际输出**。任一条拿不到证据 → 记「无法判定」,继续下一条,不中断。
3. **判读分级**:按决策表把发现归入 立即可做 / 需你决策 / 观察中;每条写明「证据 → 结论」两段,不许只有结论。
4. **复现升级**:读上周 `records/retro/<上周日期>` 页,把连续出现的「观察中」提级并标注已复现周数。
5. **产出**:写 gbrain note 页 `records/retro/<YYYY-MM-DD>`(`tags: [retro, weekly]`、`project: jspace`;同周重跑覆盖同页,不新建);会话模式同时把清单呈给用户。
6. **执行(仅会话模式、仅经确认)**:用户逐项确认后才执行「立即可做」项;**未确认的一律不动**。无头模式跳过本步。

## 边界(红线)

- **只提议不改**:规则、skill、README、`hub.json`、域文件的任何修改都需用户逐项确认;无头模式下**一律不改**,只产报告。
- 不删任何东西(退役/归档走 `jspace-use` §8.6 的确认流程)。
- 不因为「看起来该改」就改 skill 源码——skill 修订是提议,落地走开发仓流程。

## 按需深入(条件读指针)

- 六条检查的取证命令 / 判读阈值 / 分级归属 / 证据缺失处置 → `~/.agents/skills/workbench-retro/references/checks.md`
- 写回纪律(判定「该写没写」的标准)→ `~/.agents/skills/memory-writeback/references/writeback.md`
- 挂接三步与退役阈值 → `~/.agents/skills/jspace-use/SKILL.md` §8
- dated memory record 纪律(为何用日期 slug 而非固定 slug)→ `~/.agents/skills/jspace-use/references/gbrain.md`

## Golden run

端到端范例(取证 → 判读 → 分级 → 写页)见 `~/.agents/skills/workbench-retro/references/example-retro.md`。

## 自检(做完跑这条)

```bash
gbrain get records/retro/<YYYY-MM-DD>   # 页存在;tags 含 retro;每条结论都带证据行
jspace doctor --dir .                   # 自省过程未把工作台改坏(应与跑之前一致)
```
(报告里出现任何一条没有证据支撑的结论 = 本次自省不合格,重跑第 2 步)

## 参考
- `~/.agents/skills/workbench-retro/references/checks.md` — 六条检查:取证命令 + 判读 + 分级
- `~/.agents/skills/workbench-retro/references/example-retro.md` — golden run
- `~/.agents/skills/memory-writeback/references/writeback.md` — 写回纪律(检查 1 的判定依据)
- `~/.agents/skills/jspace-use/references/gbrain.md` — dated memory record 纪律
