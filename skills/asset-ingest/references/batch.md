# asset-ingest — 批量模式细则(batch)

批量整理 `_inbox/`:两遍式 + 幂等 + 汇总 + 日志。无头/定时与人工会话共用同一套逻辑,差异只在「是否提问 / 是否写日志」。

## 定位 inbox(共享)

- 正式:读 `.jspace/hub.json` 中 `type: filehub` resource 的 `primary: true` path → `<根>/_inbox/`。
- 降级:未注册 → 工作台外 `../<workbench>-inbox/`(或用户指定),提示"待注册 filehub 后正式归位"。
- 预检:`jspace inbox status [--json]` 列出文件/计数;空 inbox → 无事可做。

## 第一遍(确定性,零提问)

遍历 `_inbox/` 剩余文件(排除:点文件、`.processing` 已完成项、skip 清单)。

**确定性**判定(全部满足):
1. 类型明确:`pdf / ppt / txt / md / excel` 之一(由扩展名 + 内容判断);
2. 归属可判:能从文件名/内容确定归 `projects/<项目>/` 或 `areas/<领域>/`;
3. 无查重冲突:`gbrain get assets/<项目|领域>/<语义名>` 未存在,且目标目录无同名/同语义文件;
4. 命名可提取:`YYYY-MM-DD-语义名` 能从文件名/内容直接得出。

- 确定性 → 逐份走单文件「步骤 1-5」(识别→查重→归位→入脑→登记→自检),**零提问**。
- 不确定 → 记入第二遍清单:`文件路径 + 不确定点(归属?命名?查重冲突?类型?)`。

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
- `升版本` — 同语义已存在 → 写 `-vN` 新页,旧页保留并注 supersedes;
- `覆盖` — 同名同内容重入,允许覆盖错页(修复语义)。

无头模式:**跳过本步**,模糊项留在 `_inbox/`(自然成为下次会话/下次跑的输入)。

## 汇总与机械校验

- 汇总:`成功 / 跳过 / 失败 + 原因`,以及计数对比(批量前后 `_inbox/` 文件数一致,排除点文件与 `.processing`)。
- 查重预检:确定性判断里已含「`gbrain get` 未存在」,防擅自覆盖。
- 召回自检:每份(或抽样)贴出实际 `gbrain query <关键词>` 输出;未命中 → 检查 slug/tags/embedding,不得静默。

## 人工纠错(处理后)

- `撤销本次`:把已归位文件移回 `_inbox/`(或用户指定 back 目录),删/标注对应 gbrain 页,撤销 index.md 登记行。
- `重跑该份`:对已归位文件重走单文件逻辑(修复语义,允许覆盖错页),修正 gbrain 页与 index。

## 无头模式(cron / `claude -p`)

- 只跑第一遍(确定性),不提问、不等待;模糊项留清单。
- 每份走 journal(`jspace ingest begin → advance --gbrain → advance --index → advance --complete`);gbrain 锁冲突 → `jspace pending stage` 暂存,不失败。
- 写执行日志到 `<filehub>/.jspace-logs/inbox-batch.md`(追加):时间、输入计数、成功/跳过/失败、逐文件结果(路径 → 目标)。未注册 filehub 时:写工作台 `.jspace/logs/inbox-batch.md`(工作台侧日志槽位)。
- 失败可见性:journal + 日志落固定路径,供下次会话检查(`jspace ingest list` / `jspace pending list` / `jspace cron check`);不做静默吞错。

## 边界

- 语义判断(分类/命名/查重/召回)全部在 skill/AI 侧;CLI `inbox status` 只读辅助。
- 不自动批量迁移历史存量(增量收编);新资料一律先落 `_inbox/`。
- embedding 不可用 → 固定提示「embedding 不可用,当前为关键词检索,中文命中率可能偏低」,检索显式降级。
