# workbench-retro — golden run(端到端范例)

场景:周日 23:00 cron 触发(或用户说「周自省」)。窗口 2026-08-04 ~ 2026-08-10。
下面是一次**合格**的自省全过程——注意每条结论都挂着证据行,以及最后那条「无法判定」没有被粉饰。

---

## 第 1 步 · 定窗口

> 窗口:2026-08-04(周一)~ 2026-08-10(周日)。以下判读均相对该窗口。

## 第 2 步 · 取证(留实际输出)

```bash
$ gbrain list --type note --tag source:session -n 50
No pages found.

$ gbrain list --type note --tag source:cron -n 50
records/consolidate/2026-08-09    updated 2026-08-09
project/jspace/state              updated 2026-08-09
project/tiyanying-52/state        updated 2026-08-09
project/baobiao-module/state      updated 2026-08-09

$ jq '.session_count, .writeback_nudge_for_session' .jspace/state/briefing.json
9
9

$ gbrain list --type note --tag project -n 50
project/jspace/state          updated 2026-08-09
project/tiyanying-52/state    updated 2026-08-09
project/baobiao-module/state  updated 2026-08-09

$ gbrain list --type note --tag knowledge -n 20
(空)

$ gbrain list --type note --tag asset -n 20
assets/tiyanying-52/回访登记   updated 2026-08-08
assets/baobiao-module/验收记录  updated 2026-08-09
assets/jspace/roadmap          updated 2026-08-09

$ gbrain list --type reference -n 20
No pages found.

$ ls <filehub>/projects/
52期体验营/  报表模块/

$ jspace project list
jspace: ok: no projects

$ jspace cron check
open incidents: (0) / pending gbrain writes: (0) / needs_attention: 0

$ find <filehub>/_inbox -type f -mtime +7 -not -name '.*'
(空)

$ ls .jspace/logs/cron/inbox-tidy/
2026-08-07T211454-...md  2026-08-08T210158-...md  2026-08-10T210225-...md
```

## 第 3 步 · 判读分级

**检查 1(写回执行率)**:来源计数 —— `--tag source:session` 落窗口 **0 条**,`--tag source:cron` 落窗口 **4 条**;两组都没覆盖到的无 tag 页 0 条。写回率 = 0/(0+4) = **0%**。state 页最近更新全部是 `2026-08-09`(memory-consolidate cron 的运行日),与来源计数互相印证。
提醒面:`session_count = 9` 且 `writeback_nudge_for_session = 9` —— session-start hook 在跑、轻提示也发到了最近这个会话,所以**不是接线断了,是习惯没养成**。
→ 结论:**会话写回腿停摆**——记忆在长,但长的是 cron 归纳的,不是会话沉淀的;根因在习惯不在接线。归 `需你决策`。

**检查 2(挂接一致性)**:`projects/` 有 2 个项目,`jspace project list` 返回 no projects。
→ 结论:registry 未注册(域 README 已挂接,故非完全漂移)。归 `立即可做`,附:`jspace project add <ascii-id> --asset-rel-path projects/<中文名>`。

**检查 3(指针有效性)**:抽样 3 条 asset 指针页(`type: note` + `tags: [asset]`),`test -f` 全部 OK,均含 `rel_path`;另抽 `--type reference` 无残留(迁移已干净)。
→ 结论:无断指针。基线记 0。

**检查 4(流程卡点)**:`needs_attention: 0`;cron 日志显示 08-07 失败(API 520)已于 08-08 ack 并成功。
→ 结论:偶发失败已闭环,非重复失败。无卡点。

**检查 5(inbox 停滞)**:`_inbox/` 为空,三次 inbox-tidy 均「无事可做」。
→ 结论:无停滞;但**连续 3 次空跑**——不是流程问题,是没往里放东西。归 `观察中`(下周若仍空,说明资产腿缺输入)。

**检查 6(规则进化候选)**:本周新增 knowledge 页 0 条(`gbrain list --type note --tag knowledge`);cron 日志里出现过 `skill asset-ingest is out of date` 的过时告警。
→ 结论:skill 过时在 cron 路径能被发现、在 `jspace doctor` 路径发现不了——**规则/工具缺口**,提议给 doctor 补同类检查。归 `需你决策`。

## 第 4 步 · 复现升级

```bash
$ gbrain get records/retro/2026-08-03
(不存在 —— 首次自省,无上周页可对比)
```
→ 本次所有「观察中」项均为首次出现,不升级。

## 第 5 步 · 产出

```bash
$ gbrain put records/retro/2026-08-10 < /tmp/retro.md
$ gbrain get records/retro/2026-08-10        # 验证读回
```

页正文即下面这份报告;会话模式下同时呈给用户。

---

## 产出报告(实际写进 gbrain 的内容)

```markdown
# 周自省 2026-08-10(窗口 2026-08-04 ~ 2026-08-10)

## 一句话
cron 腿稳定在转、资产腿无输入、**会话写回腿停摆**——本周 gbrain 的增长全部来自定时归纳,没有一条来自日常会话沉淀。

## 写回率(检查 1)
- 会话写入 0 条 / 定时写入 4 条 → 写回率 **0%**
- 无来源 tag 的页:0 条
- 取证方式:`gbrain list --tag source:session|source:cron` 精确计数(非 proxy)
- 提醒面:session_count 本周 6→9(在涨)/ 轻提示已发到第 9 个会话 → 接线正常,缺的是习惯

## 立即可做(1)
- [挂接] 证据:`ls projects/` = 2 个;`jspace project list` = no projects → registry 未注册
  修复:`jspace project add <ascii-id> --asset-rel-path projects/<中文名>`(需先定中文名↔ascii id 映射)

## 需你决策(2)
- [写回停摆] 证据:`--tag source:session` 落窗口 0 条 vs `--tag source:cron` 4 条;state 页最近更新均为 08-09(consolidate cron 当日)
  选项:A 养成收工说「收工」的习惯(触发 memory-writeback)/ B 换一个 session_end 是 best_effort 的 harness / C 接受现状,靠 cron 归纳
  推荐 A —— B 没有想象中管用:claude/cursor 的 session-end hook 输出是 fire-and-forget(注不回会话),opencode/pi 压根没有结束事件;而轻提示已经发到位了(session_count 9 / nudge 9),缺的是「被提醒之后真的写」这一步
- [工具缺口] 证据:cron 日志有 `skill asset-ingest is out of date` 告警,而 `jspace doctor` 无此检查
  选项:A 给 doctor 补 skill 过时检查(复用 cron 路径已有机制)/ B 维持现状
  推荐 A

## 观察中(1)
- [资产腿空转] 证据:连续 3 次 inbox-tidy 均「无事可做」→ 出现 1 次(按周计),下周复核

## 无法判定(1)
- [检查 6 语义面] 缺:`gbrain query` 在小语料(12 页)下无法区分「重复主题」与「唯一主题」
  补法:语料增长到 ~50 页后此条才有判别力;本周仅用日志面证据

## 基线数据
- 会话写入:0 | 定时写入:4 | 写回率:0% | 无来源 tag 页:0
- state 页本周更新数:4(全部来自 cron)| 未挂接项目:0(域表)/ 2(registry)
- 断指针:0 | inbox 停滞:0 | cron 失败:1(已闭环)
```

---

## 这份 run 为什么合格

- 每条结论前面都有一行**实际命令输出**,不是「据观察」。
- 写回率是**数出来的**(两条 `--tag` 计数),不是「感觉这周写得少」;而且顺手判了提醒面(`briefing.json`),把「没被提醒」和「提醒了没做」分开——推荐项才立得住。
- 「连续 3 次空跑」没有被写成「资产流水线运行良好」——**空跑不等于健康**,它被诚实地记为观察项。
- 小语料导致检查 6 的语义面失效,被明确记为「无法判定 + 补法」,而不是硬编一个结论。
- 全程**没有修改任何文件**:两条「需你决策」给的是选项与推荐,落地要等用户点头。
