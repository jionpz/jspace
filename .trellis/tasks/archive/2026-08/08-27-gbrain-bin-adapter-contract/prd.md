# gbrain $GBRAIN_BIN 对齐与后端契约文档

## Goal

让替代知识库可通过 CLI shim + `$GBRAIN_BIN` 接入，而不在 JSpace 内封装 gbrain（对齐 GOAL.md 非目标）。

## Scope

1. `realGbrain` 尊重 `$GBRAIN_BIN`（与文档 / harness wire 承诺对齐）。
2. `GbrainDeps` 端口迁入 `core/contracts/`（修正 application→adapter 反向类型依赖）。
3. 在 `skills/jspace-use/references/gbrain.md` 文档化 Tier 1/2/3 后端契约。

## Out of scope

- 官方 shim 模板入库
- hub.json KnowledgeStore 配置 / 多后端联邦
- skills 去 gbrain 化重写

## Acceptance

- 未设 `$GBRAIN_BIN` 时行为与今天一致（argv[0]=`gbrain`）
- 设 `$GBRAIN_BIN=/path/to/shim` 时 get/put/list 均用该路径
- `bunx tsc --noEmit`、`bun test`、gen-assets 后检查脚本全过

## Key Decisions

- 只做 `$GBRAIN_BIN → 裸名 PATH`，不在 adapter 复刻三步解析（避免 adapter 引入 fs/PATH 探测；与 wire 分层一致）
- 替代 KB 接入靠 CLI shim，jspace 不提供封装层
