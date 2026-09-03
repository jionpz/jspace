---
name: asset-ingest
description: "把一份工作资料(书籍/pdf/ppt/excel/报告)变成可召回的知识资产:本体归位文件中心 + 要点写进 gbrain asset 指针页。Use when 资料入库/整理 inbox/归位资料。Do NOT use for 会话进度写回(→memory-writeback)或用户主动问句召回(→memory-recall)。"
triggers:
  - "资料入库"
  - "整理 inbox"
  - "归位资料"
  - "把这份资料入库"
---

# asset-ingest — 资料转知识资产(写侧)

把一份资料变成「可召回的知识资产」:**本体归位文件中心 + 要点写 gbrain**。确定性由 CLI 兜底(`jspace ingest` journal 状态机:幂等/补偿/中断可续跑);skill 只做语义判断(归属/命名/查重/策展)。读侧召回用 `memory-recall`,会话事实写回用 `memory-writeback`。

## 何时用 / 何时不用
- ✅ 用:单份资料入库 / 批量整理 inbox(`整理一下 inbox`)。
- ❌ 不用:会话进展/决策/教训写回 → `memory-writeback`;用户「问一句找那个数」 → `memory-recall`;office 深度抽取是本 skill 的**可选深入**分支(见下),不另开 skill。

## 决策表

| 判断 | 取值 | 动作 |
|---|---|---|
| 归属 | 项目产出 / 领域资料(书籍) | 见下方「归属映射」:区分 `--project`(归属 id)与 target 路径 |
| 类型 | pdf·txt·md·book / excel·ppt / video·audio | 摘要+指针 / +需深度抽取(可选) / 路由 media-ingest(MVP 外) |
| 查重(`gbrain get assets/<id>/<语义名>`) | 已存在 / 不存在 | 询问用户:跳过·修复(覆盖错页)·升版本`-vN`(新页) / 继续 |
| gbrain serve 持锁 | 是 / 否 | `jspace pending stage`(暂存,不失败) / 直接写页 |
| embedding 不可达 | 是 / 否 | `embed_skip: true` 重写(写入必成功)+固定提示 / 正常写 |

### 归属映射(`--project` vs target)

CLI `ingest begin` 强制 `--project <id>`;`areas/`/`projects/` 是 **target 路径组织**,不是 CLI 的 project 参数:

| 资料类型 | `--project`(CLI 强制) | `--target` | `--slug` |
|---|---|---|---|
| 项目产出 | `<项目id>`(registered 首选) | `projects/<项目>/<文件名>` | `assets/<项目>/<语义名>` |
| 领域资料 | `<领域名>`(如 `books`;CLI 派生 id + warning,可忽略) | `areas/<领域>/<文件名>` | `assets/<领域>/<语义名>` |

- 领域资料用 `--project <领域名>` 时,CLI 报 `warn: project ... is not registered` 但**不阻塞**,派生 id 稳定、功能正常。
- 消除 warning(可选):`jspace project add <id>` 注册 project 后 warning 消失、slug 更稳定;常用领域(如 `books`/`papers`)建议注册。

## 命令速查

```bash
# journal 四步(单份;每步成功后下一步)
jspace ingest begin <file> --target <路径> --slug <slug> --project <id> [--index <行>]
jspace ingest advance <journal-id> --gbrain      # 写入 gbrain 后
jspace ingest advance <journal-id> --index       # index.md 登记后
jspace ingest advance <journal-id> --complete     # 移除 inbox source,journal=committed
# 失败/中断(无孤儿)
jspace ingest fail <journal-id> --reason <原因>   # gbrain 前失败:移除暂存副本,source 留 inbox
jspace ingest list                                # 找 in-progress/cleanup-pending,续跑
# gbrain 锁冲突
jspace pending stage <slug> --content <正文文件> --producer asset-ingest
jspace pending apply                               # 锁空闲落 live(幂等)
# 召回自检
gbrain query <关键词>
```

## 步骤(主流程骨架)

1. **识别**:定类型/归属;**先读 `gbrain get profile/filing-prefs`**（如存在）应用用户归位偏好;查重(`gbrain get assets/<id>/<语义名>`)→ 冲突按决策表。
2. **暂存**:`jspace ingest begin ...`(jspace 复制到目标、source 留 inbox、写 journal,返回 id)。
3. **入脑**:写 gbrain asset 指针页(slug `assets/<projectId>/<语义名>`,模板见 `~/.agents/skills/asset-ingest/references/gbrain-write.md`)→ 成功 `advance --gbrain`;锁冲突 `jspace pending stage`。
4. **登记+提交**:`advance --index` → `advance --complete`(jspace 移除 source)。
5. **召回自检**(必做):`gbrain query <关键词>` 命中;未命中 → 查 slug/tags/embedding。

**任一步失败** → `jspace ingest fail <id> --reason <原因>`(gbrain 前失败移除暂存副本无孤儿);中断 → 下轮 `jspace ingest list` 续跑(已完成步骤不重做)。

## 按需深入(条件读指针)

- 要做**批量整理** inbox(`整理一下 inbox` / cron 无头)→ 先读 `~/.agents/skills/asset-ingest/references/batch.md`(两遍式·幂等·日志·无头只跑第一遍;执行日志落 `<filehub>/.jspace-logs/inbox-batch.md`)
- 要做 **office 深度抽取**(excel/ppt 把数字/表格也收)→ 先读 `~/.agents/skills/asset-ingest/references/deep-extract.md`(`scripts/extract.py` 统一入口 + 伴生 `.extract.md` + 策展)
- 存量旧资料按需收编 → 先读 `~/.agents/skills/asset-ingest/references/migration.md`
- 归位/命名/类型细则、降级暂存区定位 → `~/.agents/skills/asset-ingest/references/filing.md`
- 写页模板/slug 派生/embedding 降级/type 纪律 → `~/.agents/skills/asset-ingest/references/gbrain-write.md`

## Golden run

端到端范例(journal 四步 + 一次 cleanup-pending 收尾)见 `~/.agents/skills/asset-ingest/references/example-ingest.md`。

## 自检(做完跑这条)

```bash
gbrain get assets/<projectId>/<语义名>   # 页存在;project/tags/rel_path 齐
gbrain query <关键词>                      # top-1 命中本页
jspace ingest list                          # 无 in-progress(已 committed 或已 fail)
```

## 参考
- `~/.agents/skills/asset-ingest/references/filing.md` — 归位/命名/类型/文件中心定位/降级
- `~/.agents/skills/asset-ingest/references/gbrain-write.md` — 写页模板/slug/embedding 降级/type 纪律
- `~/.agents/skills/asset-ingest/references/batch.md` — 批量模式(两遍式/幂等/日志/无头)
- `~/.agents/skills/asset-ingest/references/deep-extract.md` — 深度抽取(markitdown + office-extract 回退)
- `~/.agents/skills/asset-ingest/references/migration.md` — 存量收编 runbook
- `~/.agents/skills/asset-ingest/references/example-ingest.md` — golden run(S5 产出)
- `scripts/extract.py` — 统一抽取入口(markitdown 增强 + office-extract 回退);`scripts/office-extract.py` — 零依赖回退器;各带自测脚本
