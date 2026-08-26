# AC1 — Haiku 冷跑资产入库 golden run(验收证据)

> 日期:2026-08-05。模型:Haiku(经 Agent 子代理,model=haiku)。环境:`scripts/prepare-ac1.sh /tmp/jspace-ac1`(隔离工作台 + filehub + gbrain,GBRAIN_HOME=/tmp/jspace-ac1/brain)。
> 判定:`scripts/check-ac1.sh /tmp/jspace-ac1` → **5 pass, 0 fail, 0 skip → AC1 通过**。
> 本 transcript 由执行模型自报(命令与输出片段),终态由 check-ac1.sh 独立复核(读磁盘/状态,不依赖自报)。

## 输入(唯一任务描述,不剧透命令)
`/tmp/jspace-ac1/AC1-TASK.md`:把 `_inbox/供应商报价明细.xlsx` 归入项目 `acme`,深度抽取关键数字,做成可召回知识资产;参考 `skills/asset-ingest/` 说明完成,做完跑召回自检。

## ① 模型读取的 skill 文档(按需懒加载)
1. `AGENTS.md` — 工作台路由,确认 asset-ingest 归属技能
2. `skills/asset-ingest/SKILL.md` — journal 四步主流程 + 命令速查 + 条件指针
3. `references/deep-extract.md` — 深度抽取(`extract.py`)、伴生 `.extract.md`、策展纪律
4. `references/gbrain-write.md` — reference 页模板、`rel_path`/slug 派生、embedding 降级
5. `references/filing.md` — 命名 `YYYY-MM-DD-语义名-vN.ext`、归位目标、查重
6. `references/example-ingest.md` — golden run(与本题场景几乎一致,照做)
7. `scripts/extract.py` — 抽取入口参数(读取确认)
8. `filehub/README.md` — 项目 `index.md` 模板

## ② 命令清单(模型自拟,非父会话提供)
```sh
export GBRAIN_HOME=/tmp/jspace-ac1/brain; export PATH=/tmp/jspace-ac1/bin:$HOME/.bun/bin:$PATH
gbrain get assets/acme/供应商报价明细                      # 查重 → page not found,无冲突
jspace ingest list                                        # 初始无 journal
jspace ingest begin _inbox/供应商报价明细.xlsx --target projects/acme/2026-08-05-供应商报价明细-v1.xlsx \
  --slug assets/acme/供应商报价明细 --project acme \
  --index "2026-08-05 | 供应商报价明细 | assets/acme/供应商报价明细"
#  首次 ENOENT(父目录缺失)→ mkdir -p 后重试成功
python3 skills/asset-ingest/scripts/extract.py .../projects/acme/2026-08-05-供应商报价明细-v1.xlsx \
  --out .../projects/acme/2026-08-05-供应商报价明细.extract.md
gbrain put assets/acme/供应商报价明细 < page.md             # 页正文按 gbrain-write 模板
jspace ingest advance <id> --gbrain
# (手工)写 projects/acme/index.md
jspace ingest advance <id> --index
jspace ingest advance <id> --complete
# 召回自检:
gbrain get assets/acme/供应商报价明细
gbrain query 12800 / 供应商 / 报价 / 服务器 / 供应商报价明细
jspace ingest list
```

## ③ 关键输出片段
- begin:`jspace: ok: ingest staged (id ...)`;`warn: project acme is not registered`(skill 明示可忽略,不阻塞)
- 深度抽取:`抽取完成(office-extract 回退): 写 ...extract.md`(markitdown 未装 → 自动零依赖回退);抽取内容 `## Sheet: 报价单 | 1 | 服务器 | 12800 |`
- 写页:`gbrain put` → `{"slug": "assets/acme/供应商报价明细", "status": "created_or_updated"}`;页面含 `project: acme` / `rel_path` / Key Facts 带出处 `- 服务器单价 12800 元 [Source: projects/acme/..., Sheet 报价单 B2, 2026-08-05]` / Pointer 后 `抽取:` 注记
- advance 链:`-> gbrain` → `-> index` → `-> committed (source removed)`;`_inbox/` 清空

## ④ 自检(照 SKILL.md 三条)
1. `gbrain get assets/acme/供应商报价明细` → 页存在,project/tags/rel_path 齐 ✓
2. `gbrain query` 召回命中:top-1 本页 — `12800`(1.0)、`供应商`、`报价`、`服务器`、`供应商报价明细` ✓(关键数字可召回)
3. `jspace ingest list` → `committed`,无 in-progress ✓

## 过程发现(非缺陷)
- 隔离环境无 `ZEROENTROPY_API_KEY` → embedding 不可达(自动降级关键词检索,固定提示);单关键词/含数字查询命中 top-1,三词示例查询 No results —— 预期降级态,召回目标已达成。
- `ingest begin` 目标父目录缺失直接 ENOENT(CLI 不自动建目录,需先 `mkdir -p`)。
- `advance --index` 只置 journal 状态,`index.md` 需会话按模板手工落盘。

## check-ac1.sh 判定(终态,独立复核)
```
✅ source 已从 inbox 移除   ✅ journal 已 committed   ✅ gbrain 页存在
✅ project index.md 已登记   ✅ 召回自检命中
=== 结果: 5 pass, 0 fail, 0 skip ===  >>> AC1 通过 <<<
```
