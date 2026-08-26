# issue4 applyBatch 直测 + 版本报错指引(5/6)

## Goal

两项收尾:补上 linux `applyBatch` 空 enabled 清块的关键语义直测(5),以及旧版本契约字段报错缺修复指引
的 DX 改进(6)。issue #4 的 5/6。

## Requirements

### 5. linux `applyBatch` 空 enabled 清块缺直接测试

「全部 cron disabled → `applyBatch` 收到 `enabled=[]` → 整块 marker 从 crontab 移除」是 install 路径的
关键语义(issue #2 特别标注过 "all-disabled uninstalls, was: left stale")。现状:
- `use-cases.test.ts` 用 fake adapter 覆盖过全 disabled 的 op 生成,以及 fake 的 linux applyBatch 委托
- `scheduler.test.ts` 只对纯函数(`buildContent`/`crontabBlock`/`replaceManagedBlock`)有测试
- **真实 linuxAdapter.applyBatch 无直接测试**(readCrontab/writeCrontab 是模块私有 spawnSync,不可注入)

要求在 `adapters/scheduler/scheduler.test.ts`(或新 linux.test.ts)给真实 linuxAdapter.applyBatch 加两个用例:

1. **空 enabled 清块**:given 现有 crontab 含本 tag 的 managed block(2 个 cron),when
   `applyBatch(ops, enabled=[], tag, root, env)`,then 写回的 crontab 不含该 tag 的 marker/块,
   但其它 workbench 的块与系统行原样保留。
2. **非空 enabled 整块重建**:given 现有 block 有 cron-a,when `applyBatch(ops, enabled=[cron-a, cron-b], ...)`,
   then 块里有 a+b 两行、marker 完整、幂等。

先加最小注入 seam(不直接 spawn crontab),参照仓库已有测试注入做法。

### 6. 旧 `version` 契约字段的报错缺少修复指引

schema 破坏性统一为 `schema_version` 后(issue #3 P2-2),旧格式状态文件(`version: "4"` 的 hub.json /
`version: 1` 的 cron.json 等)会被 decoder 判 damaged —— 行为正确,但报错文案只有 `must be one of 1`,
不告诉用户怎么修。**维持"无兼容性负担"原则,只加文案,不引入迁移通道。**

要求在以下两处对涉及 schema_version/version 的 issue 追加修复指引:
1. `core/registry/inspect.ts` 把 decoder issues 打成 error 处(hub.invalid / local.invalid / marker.invalid 统一出口 asErrors)
2. `application/automation/definitions.ts` loadCrons 的 fail 消息

指引文案(参照 `application/workspace/journal.ts:30/34` 的 `run "jspace workspace upgrade"` 风格):
"state file was written by a pre-schema_version jspace; regenerate with `jspace init <dir> --force`
(destructive — review first) or edit `version: ...` → `schema_version: 1` by hand."

加一条单测:旧 cron.json(`version: 1`)→ cron list 报错包含 "init" 或 "schema_version" 字样。

## Acceptance Criteria

- [ ] linuxAdapter.applyBatch 两个直接用例通过(空 enabled 清块 + 非空整块重建),通过注入 seam 完成,
      不触真实 crontab;跨 workbench 块与系统行保留断言齐全
- [ ] seam 注入是最小实现,不改变 SchedulerAdapter 接口,不引入生产行为变更
- [ ] inspect.ts 的 version.unsupported 类 issue(hub/local/marker)报错含修复指引
- [ ] definitions.ts loadCrons 对 cron.version.unsupported 报错含修复指引
- [ ] 新单测:旧 cron.json → 报错含 "init" 或 "schema_version" 字样
- [ ] bun test 全绿、tsc 通过

## Notes

- 本 child 依赖 child2(linux-apply-port)先完成:两者都改 `linux.ts`,先删 apply 再在此加 seam。
- 第 6 项只做 issue 明确的两处(inspect.ts + definitions.ts);ingest journal 的同类报错不在本期范围
  (issue 未提,若 helper 通用可顺带覆盖,不强行扩范围)。
