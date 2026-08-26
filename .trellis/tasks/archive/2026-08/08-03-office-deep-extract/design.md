# office 深度解析 — 技术设计

## 边界

**范围内**
- `skills/asset-ingest/scripts/office-extract.py`：python3 stdlib 抽取器（zipfile + xml.etree.ElementTree），覆盖 xlsx 与 pptx。
- asset-ingest 深入路径：技能文档（`references/deep-extract.md` 新增）+ 既有文档更新（`SKILL.md` / `filing.md` / `gbrain-write.md`）。
- 伴生 `.extract.md` 约定：全量抽取落 asset 层、与本体同目录。
- 抽取器自包含测试（python 脚本，无 pytest 依赖）。

**范围外（本轮不做，留使用涌现）**
- `jspace extract` CLI 子命令（分发靠技能脚本即可；有诉求再提）。
- excel 日期序列号→日期转换、数字格式精确还原、公式求值、合并单元格语义、图表/图片/OCR、docx。
- 改动 gbrain 摄取、cron/批量无头路径（深度抽取是交互式可选深入，不进 cron 第一遍）。
- Windows 上的 python3（Windows 为 CI 非基线平台；脚本在 mac/linux 即可，缺 python3 走降级提示）。

## 契约

### 抽取器 CLI
- `python3 office-extract.py <input.xlsx|.pptx> [--out <file>]`
- 无 `--out` → markdown 写 stdout；有 `--out` → 写文件（并仍打印摘要到 stdout）。
- 退出码：0 = 成功；非 0 = 失败（stderr 给原因：文件不存在 / 非 zip / 无内容 / 缺 python3 由调用方提示）。
- 确定性、幂等：同一输入恒同输出（不读时间/随机）。

### xlsx 输出（markdown）
```
# <文件名>.xlsx — 抽取
来源: <输入路径>
## Sheet: <sheet 名>
| 行\列 | A | B | C |
| 1 | 商品 | 单价(元) |  |
| 2 | 服务器 | 32000 |  |
...
```
- 单元格值覆盖：共享字符串（`t="s"`）、内联字符串（`t="inlineStr"`）、普通字符串（`t="str"`）、数字（无 t 的 `<v>`）、布尔（`t="b"`：0/1 → false/true）。
- 数字按原值输出（如 `32000`）；布尔转 `true`/`false`。
- 日期/时间序列号按原数字输出，并在**文件级**注一行限制：「日期/时间单元格为 Excel 序列值（如 45658），未转日期」。
- 空 sheet 输出 `(空)`；无 sharedStrings 时字符串列直接为值。
- 单元格引用（A1/B2）保留——「找那个数」的定位精度依赖它。

### pptx 输出（markdown）
```
# <文件名>.pptx — 抽取
来源: <输入路径>
## Slide N
- <文本行1>
- <文本行2>
```
- 页序按 `ppt/presentation.xml` 的 `sldIdLst` + `ppt/_rels/presentation.xml.rels` 解析（slide1.xml 编号不一定等于展示顺序）。
- 每页取所有 `a:t` 文本节点（去空/去空白），按段落 `a:p` 组织为列表。
- 备注页（notesSlides）不在本轮范围（有诉求再加）。

### 伴生 .extract.md 约定
- **位置**：与本体同目录；命名 = 本体语义名 + `.extract.md`（`2026-08-03-acme.xlsx` → `2026-08-03-acme.extract.md`）。
- 相对本体 `rel_path`：本体 `rel_path` 把扩展名替换为 `.extract.md`。
- Obsidian 可打开/可链接；不进 git（asset 层规则不变）。
- 抽取器失败或 python3 缺失 → 不产生 .extract.md，走「摘要+指针」回退，提示原因（失败即停，不写半成品页）。

### reference 页策展纪律（gbrain-write.md 更新）
- `Key Facts`：策展收录关键数字/表头要点（精炼 ≤ ~10 条），**不 dump 全量**。
- 页内注明伴生文件：`## 抽取` 节一行 `抽取: <rel_path 或文件名>`（全量数据可随时重开）。
- 新增事实带 `[Source: <文件 rel_path>, YYYY-MM-DD]`（对齐 gbrain ingest 引文纪律）。

## 数据流

```
office 文件(xlsx/pptx)
  → 归位到 projects/<项目>/ 或 areas/<领域>/(asset-ingest 既有步骤)
  → 用户要求深入 → 跑 office-extract.py --out <本体>.extract.md
  → 读抽取 → 策展 Summary + Key Facts(含关键数字)
  → 写 gbrain reference 页(带抽取注记 + rel_path)
  → 项目 index.md 登记行(既有)
  → 召回自检: gbrain query <关键词> 命中关键数字(或走「页命中→取指针→打开 .extract.md」闭环)
```

## 取舍

- **伴生 .extract.md vs 直接进 reference 页**：选伴生（已决策）。gbrain 页精简、检索命中质量高；深数据按需重开。代价：非策展数字的查询需二次打开 extract——由纪律「Key Facts 收录关键数字」缓解。
- **兄弟文件 vs `.extract/` 子目录**：选兄弟文件（Obsidian 直接链接、目录扁平）；目录过乱时再谈子目录。
- **单元格引用保留**：代价是表里每格带 `A1` 引用、略冗；收益是「那个数」的定位精确到格。文档已权衡：保留。
- **纯 stdlib vs 外部库/CLI**：本机无 libreoffice/openpyxl 等；stdlib 零安装、可随技能分发、确定性可测。代价：日期/公式等深度语义缺失 → 明确记为限制。
- **脚本随技能分发 vs CLI 子命令**：选前者（gen-assets 已嵌入 skills/asset-ingest 整树、零 CLI 改动）；CLI 留作未来诉求。

## 兼容性

- python3.9+（macOS 自带；仅用 stdlib）。脚本头 `#!/usr/bin/env python3`。
- 不改 gbrain 写入/embedding 契约；不依赖 serve 锁变化（抽取出 gbrain，不触锁）。
- 不改 cron/批量无头路径：深度抽取是交互式可选步骤，cron 第一遍维持「摘要+指针」。
- 现有 reference 页不受影响；.extract.md 为增量新增文件，删除安全（页内注记随删）。

## 发布/回滚

- 交付物全部在 `skills/asset-ingest/`（脚本 + references + SKILL/filing/gbrain-write 改动）→ 重跑 `gen-assets.ts` + `build` 同步编译产物（M4 教训）。
- 回滚：git revert 技能改动 + 重跑 gen-assets/build；已生成的 .extract.md 可安全删除（页内注记一并撤）。
