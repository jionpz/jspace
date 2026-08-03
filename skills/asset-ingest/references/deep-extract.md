# asset-ingest — 深度抽取(deep-extract)

excel / ppt 在「摘要 + 指针」之外的**可选深入路径**：把文件内容逐表 / 逐页抽成 markdown，供策展与伴生抽取存档。触发时机：用户要求深入了解某份 office 文件，或在入库时希望把关键数字也收进可召回范围。

## 何时用

- 用户对某份 excel / ppt 说「把里面的数字/表格也收了」「深入解析这份」。
- 常规入库（含 cron 无头批量第一遍）**只做摘要 + 指针**，不触发深度抽取——深度抽取是交互式可选步骤。

## 工具

- 抽取器：`skills/asset-ingest/scripts/office-extract.py`（随技能分发，已嵌入 jspace 二进制、物化进工作台）。
- 仅依赖 python3 stdlib（zipfile + ElementTree），零第三方库。
- 本机缺 python3 → 明确提示、回退「摘要 + 指针」，不阻塞入库。

## 命令

```bash
python3 skills/asset-ingest/scripts/office-extract.py <文件.xlsx|.pptx> --out <伴生文件>
```

- 输出：markdown。xlsx 逐 sheet（行\列 + 单元格引用 + 值，共享字符串/内联/数字/布尔全覆盖）；pptx 逐页（按展示顺序）。
- 无 `--out` → markdown 到 stdout（先看内容再决定怎么策展）。

## 流程（对接 asset-ingest 主流程的「入脑」步）

1. **归位**（既有步骤 2）：文件已在 `projects/<项目>/` 或 `areas/<领域>/`。
2. **抽取**：跑抽取器，`--out` 写到**与本体同目录**的伴生文件。
   - 命名：本体语义名 + `.extract.md`。例：`2026-08-03-acme报价.xlsx` → `2026-08-03-acme报价.extract.md`。
   - 伴生文件不进 git、可被 Obsidian 打开，是「全量抽取」的可重开存档。
3. **策展**（读抽取输出 → 精炼，不 dump）：
   - `Summary`：这份文件是什么。
   - `Key Facts`：收关键数字/表头要点，精炼（≤ ~10 条）；**数字要带出处语境**（如 `[Source: projects/acme/2026-08-03-acme报价.xlsx, Sheet 报价单 B2, 2026-08-03]`）。关键数字进页是「问一句找那个数」的命中保障。
4. **入脑**（写 gbrain reference 页，既有模板 + 新增）：
   - frontmatter 不变（`type: reference` / `project` / `tags` / `rel_path`）。
   - `Key Facts` 策展数字；**加一行** `抽取: <伴生文件 rel_path>`（全量数据可重开）。
   - 引文纪律：事实带 `[Source: <本体 rel_path>, YYYY-MM-DD]`（对齐 gbrain ingest 引文）。
5. **登记**：项目 `index.md` 挂一行（既有；可在行内附注 `.extract.md` 存在）。
6. **召回自检**：`gbrain query <关键词>` 命中关键数字；未命中 → 检查 Key Facts 是否收了该数、tags/slug 是否对。

## 输出契约（抽取器）

- **xlsx**：每 sheet 一个 markdown 表；表头首列 `行\列`，其后为列字母；单元格值保留引用定位。空 sheet → `(空)`。文件级注记：日期为 Excel 序列值未转、公式为缓存值。
- **幻影行过滤**：Excel 常见「巨大 used range」（如 1048574 行、实际仅前几百行有内容）——全空 `<row>` 一律不输出，避免伴生文件被空行撑爆（真实样例 132MB → 265KB）。
- **每 sheet 行数上限** `ROWS_LIMIT=1000`：超出的非空行截断，并注记 `> (截断: 本 sheet 共 N 行非空数据,仅展示前 1000 行;全量在本体文件)`。超大表全量仍在本体文件，页内 Key Facts 策展关键聚合即可。
- **pptx**：`## Slide N`（按展示顺序，非文件编号）+ 每页段落列表。
- 退出码：0 成功；非 0 失败（stderr 原因）。失败 → 失败即停，不写半成品页 / 伴生文件。

## 已知限制（评估是否够用时对照）

- 日期/时间：输出为 Excel 序列值（如 `45658`），不做日期转换。
- 公式：输出缓存值，不求值。
- 图片/图表内容、合并单元格语义、.xls/.ppt 旧格式、docx：不支持。
- 需要这些 → 在会话内按需处理（如打开原件人工核对），或按使用涌现加深。

## 纪律

- **伴生 `.extract.md` 是全量存档，页内 Key Facts 是策展**：不要为了「全」把大表 dump 进 reference 页（保持 gbrain 页精简、检索命中质量高）。
- 抽取是派生数据，删除伴生文件安全（页内注记一并撤）。
- 深度抽取不改变 cron / 无头批量第一遍的「摘要 + 指针」行为。
