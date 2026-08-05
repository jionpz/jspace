# Golden run — asset-ingest 单文件入库(journal 四步 + cleanup-pending 收尾)

> 端到端范例:一份虚构 xlsx 从 inbox 到可召回。**命令 + 预期输出示意 + 断言**。中等模型照此改参即可。
> 场景为**虚构占位**(项目 `acme`、金额为示意值),不引用任何真实资料;真实入库时按 `references/filing.md` 归属/命名。gbrain 输出为**示意**(格式真实,具体值随语料)。

## 场景

`_inbox/` 有 `供应商报价明细.xlsx`(3 sheet,含单价)。归入项目 `acme`,深度抽取关键数字。

## 逐步

### 1. 识别 + 查重
```bash
gbrain get assets/acme/供应商报价明细
```
预期(未建页):
```
Error: page not found: assets/acme/供应商报价明细
```
→ 无冲突,继续(若已存在 → 按决策表:跳过/修复/升版本)。

### 2. 暂存(begin)
```bash
jspace ingest begin _inbox/供应商报价明细.xlsx \
  --target projects/acme/2026-08-03-供应商报价明细-v1.xlsx \
  --slug assets/acme/供应商报价明细 \
  --project acme --index "2026-08-03 | 供应商报价明细 | assets/acme/供应商报价明细"
```
预期:
```
staged: <journal-id>   (source 留 _inbox/,副本已复制到 target)
```
断言:`jspace ingest list` 显示该 id 为 `staged`;`_inbox/供应商报价明细.xlsx` **仍在**。

### 3.(可选深入)深度抽取
```bash
python3 skills/asset-ingest/scripts/extract.py \
  projects/acme/2026-08-03-供应商报价明细-v1.xlsx \
  --out projects/acme/2026-08-03-供应商报价明细.extract.md
```
预期:伴生 `.extract.md`(xlsx 走零依赖 office-extract 回退:各 sheet 单元格引用 + 值,全空高空行被幻影行过滤;有 markitdown 则走增强路径)。→ 策展关键数字入页(步骤 4),全量留伴生文件。细则 `references/deep-extract.md`。

### 4. 入脑(写 reference 页 + advance --gbrain)
写页正文(模板见 `references/gbrain-write.md`):
```markdown
---
type: reference
source: claude
project: acme
tags: [acme, 报价]
rel_path: projects/acme/2026-08-03-供应商报价明细-v1.xlsx
---
# 供应商报价明细

**Source:** ~/filehub/projects/acme/2026-08-03-供应商报价明细-v1.xlsx
**Format:** excel
**Created:** 2026-08-03

## Summary
acme 项目供应商报价,3 张表,含单价与报价项。

## Key Facts
- 示例单价 12800 元/台 [Source: 报价单 sheet, 2026-08-03]

## Pointer
~/filehub/projects/acme/2026-08-03-供应商报价明细-v1.xlsx
抽取: projects/acme/2026-08-03-供应商报价明细.extract.md
```
```bash
gbrain put assets/acme/供应商报价明细 < 页正文文件
jspace ingest advance <journal-id> --gbrain
```
**gbrain serve 持锁** → 改走暂存(不失败):
```bash
jspace pending stage assets/acme/供应商报价明细 --content 页正文文件 --producer asset-ingest
# 锁空闲后:jspace pending apply
```

### 5. 登记 + 提交
```bash
jspace ingest advance <journal-id> --index      # projects/acme/index.md 挂一行
jspace ingest advance <journal-id> --complete    # 移除 _inbox source
```
预期:
```
committed: <journal-id>
```
断言:`_inbox/供应商报价明细.xlsx` **已移除**;`ingest list` 无该 in-progress。

### 6. 召回自检(必做)
```bash
gbrain query "acme 供应商 单价"
```
预期 top-1:
```
1. assets/acme/供应商报价明细  (score …)
```
断言:top-1 == 目标页;`grep 12800 <extract 或本体>` ≥1。

## cleanup-pending 收尾(最易错路径)

若步骤 5 `--complete` 时 source 删除未证明完成(unlink 失败/中断):
```bash
jspace ingest list
# 显示: <journal-id>  failed/cleanup-pending
jspace ingest advance <journal-id> --complete    # 同一命令幂等收尾
```
- source 仍在 → 重试删除;已删除 → 直接收敛 committed。
- **不要** `--fail` / `--rollback`(会拒绝)。这不是普通失败,是收尾入口。

## 断言清单(照此判"做完没")
- [ ] `jspace ingest list` 无该 id 的 in-progress(committed 或已 fail)
- [ ] `gbrain get assets/acme/供应商报价明细` 页在,frontmatter project/tags/rel_path 齐
- [ ] `gbrain query "<关键数字措辞>"` top-1 == 目标页
- [ ] `_inbox/` 该文件已移除(committed 后)
