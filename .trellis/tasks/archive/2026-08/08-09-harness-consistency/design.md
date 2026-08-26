# P5 Design: 跨 harness 一致性 + CI 锁定

## 架构边界

```
capabilities.yaml (作者态唯一事实源, P1)
      │
      ▼
scripts/check-harness-consistency.ts  ←── 本地 + CI(verify.yml)
      │ 断言集(6 条, 见 prd R1):
      │  1. harness-*.md 文件集 = documented:true keys（codex 豁免）
      │  2. cron.ts HARNESSES == keys（双向）; cron.json 值 ∈ keys
      │  3. adapter 文件名 ∈ keys
      │  4. workbench_projection → 模板目录; via_pi_mcp_adapter 双处同存; sessions 事件有接线分支
      │  5. SKILL.md 引用区覆盖全部 harness-*.md
      │  6. 手写列表 = 全支持集（显示名映射; 排除 harness-config/ 机器级域）
      ▼
harnesses.md 全景表 / PLATFORMS.md  ←── machine-render 自 capabilities.yaml（含 lifecycle 列）
```

## 关键设计决策

1. **断言是字段值级不是名单级（审查 H3 修正）**：4 类名单断言升级为 6 条，覆盖 P1–P4 产出的实际漂移点（cron.ts enum、投影目录、via 字面量、sessions 接线分支、SKILL.md 引用）——不再让「capabilities 加字段但接线产物没跟上」静默通过。
2. **render 数据源（审查 H3 核心）**：P1 已在 capabilities.yaml 加 `lifecycle` 4 维 grade 字段（初值照 harnesses.md:87-92 矩阵，Grok/OpenCode 待 P2/P3 校正）。P5 从它 render 全景表，**不再依赖手维矩阵内容**；「内容等价性」措辞改为「render 产物 == 从 yaml 现算结果」。
3. **Cursor 处置（D6 修正：保留）**：Cursor 是已文档化第 4 个会话 harness（harnesses.md:7/55-72/92、模板 AGENTS.md、PLATFORMS.md 均列），用户否决「移除」，**保留进支持集**。P5 把既有文档 Cursor 行/句保留并同步为「含 Grok/OpenCode 的新支持集」；`skills/harness-config/`（机器级接线文档，含 hermes 等非 jspace 支持集 harness）从断言 6 扫描范围显式排除——jspace 工作台支持集 ≠ 机器级 harness-config 接线集，两个概念分离。
4. **harness-*.md 创建归属（审查 F3）**：harness-pi.md 由 P4 创建；claude/grok/opencode/cursor 四份由 P5 创建，内容来自 P1 现状接线 / P2 Grok 验证素材 / P3 OpenCode 验证素材 / 现状 harnesses.md Cursor 节（各任务 notes）。codex 无独立 doc（documented:false，cron 兼容例外）。
5. **显示名↔key 映射（审查低项）**：断言 6 定义映射表（Claude Code=claude、Grok Build=grok、OpenCode=opencode、Pi=pi、Cursor=cursor、Codex=codex），避免「Grok」vs「Grok Build」匹配不上。
6. **references 索引（审查 F18）**：`skills/jspace-use/SKILL.md:162` 引用区是真正索引（非 `.trellis/spec/guides/index.md`——那是 Thinking Guides）；P5 更新引用区覆盖全部 harness-*.md，并加断言 5。
7. **render 产物入库 + 断言**：harnesses.md 表由脚本 render，生成物入库；脚本断言「入库生成物 == 现 render 结果」；表上方注明 auto-generated from capabilities.yaml。

## 数据流

P5 脚本每次运行：读作者态 capabilities.yaml（Bun.YAML）→ 提取支持集与字段 → 扫 cron.ts/模板/适配器/文档 → 逐断言比对 → 全过 exit 0 / 任一漂移 exit 1（CI 红）。harnesses.md 表：capabilities.yaml → render → 入库文件 → 脚本断言一致。

## 兼容性 / 迁移

- check 脚本新增，不改变既有功能；harnesses.md 表格内容从手写变 render（lifecycle 值来源 P1）
- 模板 AGENTS.md / PLATFORMS.md 的 Cursor 句改写是行为变更（D6 已拍板）
- CI 加步骤纯增量
- 回滚：脚本 revert + 表内容保留 render 产物（或回手写）

## 风险 / 权衡

- **断言 6 的「列表语境」识别**可能漏新出现的手写清单 → 「发现即报红」哲学：漏一个清单 = 该清单与支持集不一致时脚本红，人工补进扫描范围；宁可过度红不可静默漂移
- **harness-config/ 排除**是显式豁免——jspace 支持集（5 会话 + codex）与机器级 harness-config 接线域（含 hermes）分离；若未来 jspace 支持集再扩，需反向同步 harness-config 文档，P5 记录此依赖
- **render 产物入库与手改冲突** → auto-generated 标注 + 断言兜底（已选入库 + 断言，确定性最高）
