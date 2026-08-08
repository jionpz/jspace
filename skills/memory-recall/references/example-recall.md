# Golden run — memory-recall 精准召回(四连断言 + 带出处作答)

> 端到端范例:用户「问一句」→ 有出处的答案。真值来源:`~/.agents/skills/memory-recall/references/memory-acceptance.md` 基线(2026-08-03,2 文档语料通过)。gbrain 输出为**示意**(格式真实)。

## 场景

用户问:「那 12.8T 的数据怎么搬?」(语义 = 历史数据迁移的存量)。目标页 = 领域 A 的迁移页。

## 逐步

### 1. 语义查询
```bash
gbrain models doctor --json     # 先确认 embedding_reachability(仅确认,不阻塞)
gbrain query "那 12.8T 的数据怎么搬?"
```
预期 top-1:
```
1. assets/<领域A>/<迁移页语义名>   (score 0.xx)
2. assets/<领域B>/…                (score 更低)
```
- **embedding 不可达** → `gbrain search "历史 数据 迁移 存量"` + 固定提示「embedding 不可用,当前为关键词检索,中文命中率可能偏低」(不得静默)。

### 2. 校验(防假阳性)
变体查询(换说法,语义同):
```bash
gbrain query "历史数据迁移涉及多少存量?"
```
断言:候选页保持 top-1;负对照(领域 B 页)不反超。

### 3. 指针断言链(四连过才算命中)
```bash
gbrain get assets/<领域A>/<迁移页语义名>          # ① 取 Pointer 字段
test -f "~/filehub/areas/<领域A>/<文件>.md"   # ② 文件在
grep "12.8" "~/filehub/areas/<领域A>/<文件>.md"  # ③ 找到那个数
gbrain query "那 12.8T 的数据怎么搬?"            # ④ top-1 slug == 目标
```
四连全过 → 命中;任一断 → 回步骤 5 校准。

### 4. 作答并引用出处
> 历史数据迁移涉及约 12.8T 存量。
> 出处:`~/filehub/areas/<领域A>/<文件>.md`(gbrain slug `assets/<领域A>/<迁移页语义名>`)。

**必须**带文件绝对路径 + slug,不得只说「页里有」。

### 5. 未命中 → 有终止校准
- 诊断五类:slug / tags / embedding 配置 / 查询措辞 / 纪律缺口。
- 仅**纪律缺口**才 REPO 修正 + 刷 JWorkspace;配置/措辞类只记录(ROI 护栏)。
- 重跑 ≤3 轮;3 轮未过 → 显式终态:接受关键词降级记入验收文档 / 上报用户(扩语料/换 embedding)。

## 换机场景(rel_path 重解析)
导入/换机后 Pointer 绝对路径指向旧机 → 读**当前机** `hub.json` 的 filehub primary path(根)+ 页 `rel_path` → 本机 Pointer → 再走四连。细则 `~/.agents/skills/memory-recall/references/discipline.md` §8。

## 断言清单(照此判"做完没")
- [ ] `gbrain query` 原型 + 变体均 top-1 目标页,负对照不反超
- [ ] `gbrain get <slug>` 取到 Pointer;`test -f` 成立;`grep <数>` ≥1
- [ ] 答案含文件绝对路径 + gbrain slug
- [ ] embedding 不可达时有固定降级提示(未静默)
