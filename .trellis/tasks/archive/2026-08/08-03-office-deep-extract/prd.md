# office 文件解析深度：excel 逐表 / ppt 逐页抽取

## Goal

GOAL 开放问题 #4：asset-ingest 从「摘要+指针」加深到 excel 逐表（sheet + 单元格 + 关键数字）与 ppt 逐页（大纲 + 文本），让「问一句找到那个数」的用例对 excel/ppt 也成立——关键数字与表格内容可被召回，同时保持「记忆存事实与指针、资产存文件本体」原则。

## Requirements

- **零依赖抽取器**：python3 stdlib（zipfile + xml.etree）实现 `office-extract.py`，不引入第三方库。
  - xlsx：逐 sheet 输出（sheet 名 + 行序 + 单元格引用 + 值；共享字符串/内联字符串/数字/布尔都覆盖；日期等序列值按原值输出并在限制中注明）。
  - pptx：逐页输出（页序 + 每页文本，标题/正文合并为页文本）。
  - 输入：文件路径；输出：markdown 文本到 stdout（或输出文件），确定性、可幂等。
- **随 jspace 分发**：脚本放 `skills/asset-ingest/scripts/office-extract.py`，经 gen-assets.ts 嵌入并物化进工作台；不依赖系统装 office 工具。
- **asset-ingest 深入路径**（可选深入步骤，用户要求时触发）：
  1. 跑抽取器 → 读抽取结果；
  2. 策展：reference 页 `Key Facts` 收录关键数字/表头要点（精炼，不 dump）；
  3. 全量抽取落**伴生 `.extract.md`**（asset 层，与本体同目录；命名 `<语义名>.extract.md`，Obsidian 可打开可链接）——**已决策（2026-08-03）**；
  4. 指针/rel_path 记录本体，reference 页内注明伴生 .extract.md 存在。
- **降级**：python3 缺失 → 明确提示、回退「摘要+指针」，不阻塞常规入库；抽取器失败 → 失败即停，不写半成品页。
- **文档**：新增 `references/deep-extract.md`；更新 `SKILL.md`（第 6 步深入）、`filing.md`（excel/ppt 行不再标注「不做逐表抽取」）、`gbrain-write.md`（Key Facts 策展纪律 + 伴生抽取约定）。
- 遵守纪律：不改 gbrain 的写入锁/embedding 契约；抽取是 ingest 时的派生数据，不把二进制/超大内容塞 gbrain 页。

## Acceptance Criteria

- [ ] 合成样例正确：多 sheet xlsx（共享字符串 + 数字 + 内联字符串）与多页 pptx 的抽取输出逐表/逐页正确（原型已验证的输入输出为准）。
- [ ] 至少 1 份真实 excel/ppt（**用户将提供一份真实 office 文件**，路径待用户给出）跑通 asset-ingest 深入路径：reference 页 Key Facts 含关键数字 + 伴生 .extract.md 落位 + rel_path/指针正确。
- [ ] 召回验证：「问一句找那个数」——抽取后关键数字经 `gbrain query` 可命中（或走通「页命中 → 取指针 → 打开 .extract.md」闭环）。
- [ ] 单测覆盖抽取器（bun test 或 python 测试跑绿；含边界：空表、纯数字表、多 sheet、无 sharedStrings）。
- [ ] 文档一致：SKILL/filing/gbrain-write/deep-extract 无互相冲突。
- [ ] 改动 skills/ 后重跑 `bun run scripts/gen-assets.ts` + build，编译产物同步（M4 教训：assets.generated.ts 必须再生成）。

## Notes

- 研究结论（2026-08-03）见父任务 prd.md Notes；本机工具链现状已确认：无 office 解析库/CLI，必须自带 stdlib 抽取器，原型已跑通。
- 待用户确认的分叉点：#4-1 全量抽取的去向（伴生 .extract.md vs 直接进 reference 页 vs 仅策展不存全量）。**已决策（2026-08-03）：伴生 .extract.md**。
- #4-2 真实 office 验收样例：**用户将提供**（选择「提供真实 office 文件」），路径未给出——进入实施/验收阶段时向用户索取；在此之前以合成样例推进开发。
