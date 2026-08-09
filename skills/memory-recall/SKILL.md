---
name: memory-recall
description: "**读侧精准召回**:用户「问一句」时,把问题召回为有出处的答案——语义查询 → top-1 校验 → 指针断言链 → 打开文件引用出处。Use when 问一句/找那个文件/那个数/精准召回/recall/find the file。Do NOT use for 资料入库(→asset-ingest 写侧)或会话进度写回(→memory-writeback)。"
triggers:
  - "问一句"
  - "找那个文件"
  - "那个数"
  - "精准召回"
  - "recall"
  - "find the file"
---

# memory-recall — 精准召回(读侧)

把用户问题召回为「**有出处**的答案」:语义查询 → 校验 → 指针断言链 → 打开文件引用出处。对应 GOAL「随口一问,找到那个文件里的那个数」。

**分工**:asset-ingest = 写侧(资料入库 + 归位后自检);本 skill = 读侧(用户主动召回);memory-writeback = 会话事实写侧。三者共用同一份 embedding/降级纪律。

## 何时用 / 何时不用
- ✅ 用:用户「问一句」要从 filehub/gbrain 找事实。
- ❌ 不用:资料还没入库 → `asset-ingest`(本 skill 只读已入库的);把本次进展写回 gbrain → `memory-writeback`。

## 决策表

| 判断 | 取值 | 动作 |
|---|---|---|
|embedding 可达性(`gbrain models doctor --json`)| ok / 不可达 | `gbrain query`(hybrid) / `gbrain search`(关键词,**固定提示不得静默**) |
| top-1 校验 | 稳定 / 存疑 | 作答 / 做变体查询 + 负对照 |
| 指针断言链(四连) | 全过 / 任一断 | 该用例命中 / 回校准 |
| 未命中诊断(五类) | slug / tags / embedding 配置 / 措辞 / 纪律缺口 | 仅纪律缺口才 REPO+刷 JWorkspace;配置/措辞类只记录(ROI 护栏) |
| 校准终止 | <3 轮稳定 / 3 轮未过 | 通过 / 显式终态:接受降级记验收文档 / 上报用户 |

## 命令速查

```bash
gbrain query "<问题>"              # 语义/hybrid(中文优先);不可达退化关键词
gbrain search "<关键词>"           # 纯关键词降级
gbrain get <slug>                  # 取 Pointer 字段(断言链 ①)
test -f "<Pointer>"                # 断言链 ②
grep "<关键词>" "<Pointer>"         # 断言链 ③ 找到那个数
gbrain models doctor --json        # 确认 embedding_reachability(仅确认,不阻塞)
```

## 步骤(主流程骨架)

1. **语义查询**:`gbrain query "<问题>"`;embedding 不可达 → `gbrain search` + 固定提示。
2. **校验(防假阳性)**:确认 top-1;代价低时做变体查询(换说法,候选页应保持 top-1)+ 负对照(无关页不反超)。
3. **指针断言链(四连过才算命中)**:`gbrain get` 取 Pointer → `test -f` → grep/打开找到那个数 → top-1 slug 一致。
4. **作答并引用出处**:答案 + 文件**绝对路径** + gbrain slug(可点开、可复检)。
5. **未命中 → 有终止校准**:按诊断五类处置,重跑 ≤3 轮或显式终态。

## 按需深入(条件读指针)

- 断言链/变体负对照/诊断终止/降级提示/canonical 面约束细则 → `~/.agents/skills/memory-recall/references/discipline.md`
- 换机/导入后指针解析(rel_path 重解析)→ `~/.agents/skills/memory-recall/references/discipline.md` §8
- 可复跑验收协议(基线/重跑)→ `~/.agents/skills/memory-recall/references/memory-acceptance.md`
- 写侧 embedding 降级细节 → `~/.agents/skills/asset-ingest/references/gbrain-write.md`

## Golden run

端到端范例(Q1/Q2 四连断言 + 带出处作答)见 `~/.agents/skills/memory-recall/references/example-recall.md`。

## 自检(做完跑这条)

```bash
gbrain get <slug>          # Pointer 字段在
test -f "<Pointer>"        # 文件本体在
gbrain query "<问题>"       # top-1 == 目标 slug
```
(作答必须带文件路径 + slug,不得只给「页里有」)

## 参考
- `~/.agents/skills/memory-recall/references/discipline.md` — 断言链/变体负对照/诊断终止/降级/换机解析
- `~/.agents/skills/memory-recall/references/memory-acceptance.md` — 可复跑验收协议(基线 2026-08-03 通过)
- `~/.agents/skills/memory-recall/references/example-recall.md` — golden run(S5 产出)
- `~/.agents/skills/asset-ingest/references/gbrain-write.md` — 写侧纪律(读侧触发时参考)
