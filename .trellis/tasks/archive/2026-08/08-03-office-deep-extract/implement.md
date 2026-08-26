# office 深度解析 — 实施计划

## 有序清单

1. **抽取器脚本** `skills/asset-ingest/scripts/office-extract.py`
   - xlsx：解析 sharedStrings（存在时）+ workbook 的 sheet 顺序（name + r:id）+ `xl/_rels/workbook.xml.rels` 的 r:id→target；逐 sheet 输出行×单元格（引用 + 值，覆盖 `t="s"`/`inlineStr`/`str`/数字/`t="b"`）；空 sheet → `(空)`；无 sharedStrings 容错。
   - pptx：`ppt/presentation.xml` sldIdLst 顺序 + `ppt/_rels/presentation.xml.rels` → 逐页 `a:t` 文本（去空），按 `a:p` 段落组织。
   - CLI：`<input> [--out <file>]`；stdout 摘要 + markdown（或写文件）；退出码 0/非 0；确定性。
   - 文件级限制注记（日期序列值等）。

2. **抽取器测试** `skills/asset-ingest/scripts/office-extract.test.py`（自包含，无 pytest）
   - 构建合成 xlsx（多 sheet/共享字符串/数字/inline/布尔/空 sheet）与 pptx（多页/顺序）。
   - 断言抽取输出（含关键数字、sheet 名、页序）。
   - `python3 office-extract.test.py` → PASS/FAIL + 退出码。

3. **技能文档**
   - 新增 `skills/asset-ingest/references/deep-extract.md`：何时触发、命令、输出契约、策展纪律、降级。
   - `SKILL.md` 第 6 步（可选深入）并入 office 深度抽取；`filing.md` excel/ppt 行更新（不再标注「不做逐表抽取」→ 见 deep-extract.md）；`gbrain-write.md` 加「Key Facts 策展 + 伴生 .extract.md 注记 + 引文」纪律。

4. **合成样例验证**：复用原型样例跑抽取器，断言逐表/逐页正确；跑 `office-extract.test.py` 全绿。

5. **资产再生成**（M4 教训，必做）：`bun run scripts/gen-assets.ts` → 确认 `cli/assets.generated.ts` 含新脚本/references → `bun run build`。

6. **真实文件验证**：向用户索取一份真实 excel/ppt → 走 asset-ingest 深入全链路：
   - 归位（命名/查重/移动到目标目录）→ 跑抽取器出 `.extract.md` → 策展 Key Facts（含关键数字）→ 写 gbrain reference 页（rel_path + 抽取注记）→ index.md 登记 → `gbrain query` 召回自检（关键数字命中或「页→指针→extract」闭环）。
   - 结果记录进任务 notes.md 供验收。

7. **回归**：既有 `bun test`（cli/*.test.ts）不破（本轮不改 TS，确认即可）；`tsc` 类型检查通过。

## 验证命令

```bash
# 抽取器冒烟（合成样例）
python3 skills/asset-ingest/scripts/office-extract.py /tmp/office-proto/sample.xlsx
python3 skills/asset-ingest/scripts/office-extract.py /tmp/office-proto/sample.pptx
# 自测
python3 skills/asset-ingest/scripts/office-extract.test.py
# 资产再生成 + 构建（改 skills/ 后必跑）
bun run scripts/gen-assets.ts
bun run build
# 回归（若触碰 TS；本轮预期不碰）
bun test
bunx tsc --noEmit   # 或项目既用的类型检查命令
```

## 评审门

- [门 1] design 评审（用户过目 design.md 后 `task.py start`）。
- [门 2] 实施完成、自测全绿、真实文件全链路跑通后，提交前 `trellis-check` / 用户评审 diff。
- [门 3] Phase 3 收尾：spec 更新 + 提交。

## 回滚点

- 每一步一个原子提交；`skills/asset-ingest/` 改动可整体 revert + 重跑 gen-assets/build。
- 已生成的 `.extract.md` 删除安全（页内注记一并撤）；gbrain reference 页按既有纪律处理（指针修正或删除由使用定）。

## 待输入

- 真实 excel/ppt 文件路径（用户提供，步骤 6 使用）——向用户索取。
