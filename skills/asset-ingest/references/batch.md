# asset-ingest — 批量模式细则(batch)

批量整理 `_inbox/`:两遍式 + 幂等 + 汇总 + 日志。无头/定时与人工会话共用同一套逻辑,差异只在「是否提问 / 是否写日志」。

## 定位 inbox(共享)

- 正式:读 `.jspace/hub.json` 中 `type: filehub` resource 的 `primary: true` path → `<根>/_inbox/`。
- 降级:未注册 → 工作台外 `../<workbench>-inbox/`(或用户指定),提示"待注册 filehub 后正式归位"。
- 预检:`jspace inbox status [--json]` 列出文件/计数;空 inbox → 无事可做。
- 每个条目还带 `blockers`、`freshness`(`current` / `stale` / `unknown`)和 `archived`(`source_retained`)。只有 `current` 才表示上次未决结论仍可复用；`stale` 是内容或路由证据已变，`unknown` 是证据不可验证——两者都必须重判，不能沿用旧结论。
- `archived/source_retained` 是已提交 bundle 按 `sourcePolicy: retain` 保留的原件，不是待归位载荷；不得再 `begin` / `block` / `retry`，详见下文「已归档原件保留」。

## 第一遍(确定性,零提问)

**归位前先读上下文**：① 项目 `index.md` 的 `layout`（flat/workstream/period）；② `gbrain call get_page '{"slug":"profile/filing-prefs","include_content":true}'`（如存在）——用户历次纠正积累的归位规则；③ `ls` 目标项目目录——只延续与契约一致的已有组织方式。三者都参与确定性判断；格式目录不是可选答案。

遍历 `_inbox/` 剩余文件(排除:点文件、常驻契约文件 `README.md` / `AGENTS.md`、`.processing` 已完成项、skip 清单)。命中 `.skip-inbox-tidy` 豁免标记的目录**整目录跳过并计入「跳过」**(原因:豁免标记),不搬动其内容——与 unfiled 计数(`inbox status` / doctor / context hook)同一口径,见 filing.md「投放口常驻文件与豁免标记」。

**确定性**判定(全部满足):
1. 类型明确:`pdf / ppt / txt / md / excel` 之一(由扩展名 + 内容判断);
2. 归属与位置可判:能从文件名/内容确定归 `projects/<项目>/` 或 `areas/<领域>/`,并依据 `layout` 确定根目录或稳定子目录;
3. 无查重冲突:目标目录无同名/同语义文件，且 `gbrain call get_page '{"slug":"assets/<owner>/<语义名>","include_content":true}'` 返回 `page_not_found`;
4. 命名可提取:`YYYY-MM-DD-语义名` 能从文件名/内容直接得出。

- 确定性 → 逐份走单文件「步骤 1-5」(识别→查重→归位→入脑→登记→自检),**零提问**。
- 不确定 → 记入第二遍清单:`文件路径 + 不确定点(归属?命名?查重冲突?类型?)`。

**阻塞先记录，再继续其余文件**：当 owner 不唯一或来源证据不可验证时，用显式阻塞代替猜测；不要 `begin`、不要写 pending、不要碰任何 target：

```bash
jspace inbox block <entry> --reason owner_ambiguous \
  --missing "<缺什么证据>" --candidates project:<id>,area:<id>
jspace inbox block <entry> --reason source_unverified --missing "<为什么无法验证>"
# 加 --dry-run 预览，加 --json 取结构化结果
```

- 同一阻塞重复记录是幂等的：保留同一原因/缺口与原件，不产生 target、journal 或 pending。
- 阻塞项与原件保留项都**不算 filed**；它们不进入成功计数，也不阻止其余文件继续。
- 若旧的 `freshness` 为 `stale` / `unknown`，先按当前证据重新判断；旧 blocker 不是免检通行证。

**单文件原子性(journal 驱动)**:每份走 `jspace ingest begin → advance --gbrain → advance --index → advance --complete`;任一份失败 → `jspace ingest fail <id> --reason <原因>`(gbrain 前失败移除暂存副本、source 留 inbox,无孤儿);**其余文件继续,不整批回滚**。

**幂等 / 断点续跑(journal 为机器 truth)**:每份的进度在 `.jspace/state/ingest/` journal(不是 `.processing` 点文件)。`begin` 前查重:同内容同目标已 committed → duplicate 跳过;in-progress → resume 续跑(从记录步骤继续,已完成步骤不重做)。
- 中断续跑:下轮 `jspace ingest list` 列出 in-progress journal;source 仍在 inbox → 继续。
- **cleanup-pending**(list 标注 `failed/cleanup-pending`,status 显示 `cleanup pending`):source 删除未证明完成 → 同一 `jspace ingest advance <id> --complete` 幂等收尾(source 在 → 重试删除;已删除 → 直接收敛 committed);**不要 `--rollback` / `--fail`**(会拒绝)。
- **失败重试**:失败的文件留在 `_inbox/`,原因记入 journal + 执行日志 → 下次批量(含 cron 无头)重试,不永久跳过。

## 第二遍(模糊项,人工过目)

把第二遍清单列成**短清单**一次给用户过目,每项可选:
- `跳过` — 本轮不处理(保留在 `_inbox/`);
- `改归属` — 用户指定 `projects/<项目>/` 或 `areas/<领域>/`;
- `改命名` — 用户给出语义名(或纠正);
- `升版本` — 同语义已存在且有明确新版依据 → 写 `-vN` 新 slug/新页，新页正文声明 `Supersedes: [[old]]`，旧页用 CAS 改生命周期;
- `跳过重复` — 同内容已存在 → 报告已有路径/页并跳过，不移动或删除任何副本。

无头模式:**跳过本步**,模糊项留在 `_inbox/`(自然成为下次会话/下次跑的输入)。

用户补齐证据后，先清旧裁决再重判:

```bash
jspace inbox retry <entry>          # 只清缓存裁决，可加 --dry-run / --json
```

`retry` 不搬家、不入库、不验证、也不宣告完成；它只是让下一遍重新判断。已归档原件保留项会拒绝 `retry`/`block` 并提示清理路径，不要把它当成普通未决项。

## 汇总与机械校验

- 汇总:`成功 / 阻塞 / 跳过 / 失败 + 原因`；`blocked` 与 `archived/source_retained` 单列，绝不并入「成功/filed」。计数对比要注明例外：被阻塞项和 `sourcePolicy: retain` 的原件本来就会留在 `_inbox/`，不能用“批量前后文件数一致”反推它们已归位。
- 查重预检:确定性判断里已含结构化 `get_page` 未命中；同内容由内容身份和 `filehub check` 的 `filehub.asset.duplicate_content` 提示，不以文件名或列表行猜重。
- 召回自检:每份(或抽样)贴出实际 `gbrain query <关键词>` 输出;未命中 → 检查 slug/tags/embedding,不得静默。

## 已归档原件保留(`archived/source_retained`)

- 只有完整匹配 committed v3 bundle journal(源路径 + 计划 + manifest/整树身份 + 注册 target 当前整树)时，`inbox status` 才显示 `archived/source_retained`；它表示业务副本已提交，inbox 里的是待清理原件。
- 它不是 owner ambiguity，也不是待重试项：`block` / `retry` 会拒绝并给出 cleanup 提示。不要重新 `begin`，不要复制第二份。
- CLI 不删除 inbox 原件。确认注册 target 可用后，用用户自己的常规文件流程清理；日志和汇总写 `archived/source_retained`，不写 “filed again”。
- 若 target 缺失、manifest 或整树已漂移，status 只报 `archive identity unknown/conflict`，此时不能假定已归档，也不能猜测清理。

## 人工纠错(处理后)

- `撤销本次`:把已归位文件移回 `_inbox/`(或用户指定 back 目录),删/标注对应 gbrain 页,撤销 index.md 登记行。
- `重跑该份`:对已归位文件重走单文件逻辑；若事实或页内容错误，写新页并以 `Supersedes` 指向旧页，旧页只做生命周期 CAS，修正 index 与指针。

## 无头模式(cron / `claude -p`)

- 只跑第一遍(确定性),不提问、不等待;模糊项留清单。
- 每份走 journal(`jspace ingest begin → advance --gbrain → advance --index → advance --complete`);gbrain 锁冲突/超时/响应丢失 → 用 `jspace pending stage` 保存完整页、`--intent create|replace`、真实 `--origin` 和 replace 所需的 stage-time `--expected-revision`，不失败也不越过 checkpoint。
- 写执行日志到 `<filehub>/.jspace-logs/inbox-batch.md`(追加):时间、输入计数、成功/阻塞/跳过/失败、逐文件结果(路径 → 目标或阻塞原因/缺口)、`archived/source_retained` 清单。日志永远追加，重复跑不覆盖旧证据。未注册 filehub 时:写工作台 `.jspace/logs/inbox-batch.md`(工作台侧日志槽位)。
- 失败可见性:journal + 日志落固定路径,供下次会话检查(`jspace ingest list` / `jspace pending list` / `jspace cron failures`);不做静默吞错。

## 边界

- 语义判断(分类/命名/查重/召回)全部在 skill/AI 侧;CLI `inbox status` 只读辅助。
- 不自动批量迁移历史存量(增量收编);新资料一律先落 `_inbox/`。
- embedding 不可用 → 固定提示「embedding 不可用,当前为关键词检索,中文命中率可能偏低」,检索显式降级。
