# P3: 文档漂移 + 打磨（issue #8 #18 + #19–#30）

## Goal

收尾 issue #8 的文档三角漂移（#18 全组）与打磨项（#19–#30）。**本批实现范围**：文档漂移 #18 全组 + 确定性的小打磨（#19 fsync / #22 doctor info / #23 空列表 / #24 错误前缀 / #26 HubV4 命名 / #27 __DEV_ROOT__ 死代码 / #20 已随 #12 闭合确认）；**延后**：大改（#28 import-boundary 测网扩 / #29 SSOT 生成式 / #30 domain.json 双份 tags / #25 Windows PATH+launchd 文案）记录于 Notes。

父任务：`08-10-issue8-review-fixes`。

## Background（issue #8 原文定位）

### #18 文档三角漂移（全组实现）
| # | 文档承诺 | 代码现实 | 位置 |
|---|---|---|---|
| 18a | `harnesses.md` 自称"capabilities.yaml render、勿手编" | 非生成；lifecycle 四格与 yaml 相反 | `skills/jspace-use/references/harnesses.md:3,9` |
| 18b | "绝对路径在 hub.json 且恰一 primary" | 已迁 binding + `local.bindings` | 根 `AGENTS.md:53`、`templates/filehub/README.md:51`、`skills/asset-ingest/references/gbrain-write.md:42-43` |
| 18c | `registry.md` 称 registry CLI 是"未来行为" | `domain/resource/project` 已实现 | `registry.md:37-44`、`jspace-use/SKILL.md:78,161` |
| 18d | "未上线、无兼容性负担" | M5 分发 ✅、版本 1.0.11 | `AGENTS.md:26,55-56` vs `GOAL.md:89` |
| 18e | harness-config skill 认 4 家 | 产品已认 5 家（漏 Grok/OpenCode） | `skills/harness-config/` |
| 18f | 工作台 README 漏列 `.cursor/hooks.json` | init 已物化 | `templates/workbench/README.md:15-19` |
| 18g | pending 路径写工作台根 `.jspace-logs` | 实际 `<filehub>/.jspace-logs` | `templates/workbench/AGENTS.md:79`、`jspace-use/SKILL.md:135` |
| 18h | `harness wire --harness <x>` 写成通用 | 当前仅 grok；claude 走 `jspace gbrain wire` | `README.md:81` vs `cli/commands/harness.ts` |

### 打磨项（#19–#30）
- #19 原子写无 fsync + tmp 孤儿（`adapters/fs/workbench-state.ts:95-101,159-168`）。
- #20 crontab `%` 转义 → **#12 已修**（security 批 parse 还原 `\%`），本批仅确认。
- #21 `failIngest` 先删 staged 再写 journal（`ingest/journal.ts:302-313`）→ 延后（涉及补偿语义，风险大于收益）。
- #22 doctor 人话模式 info 只计数不打印 + bin_missing 误报（`doctor.ts:543-551`）。
- #23 空列表 stdout 全空（`domain/resource/project list`）。
- #24 错误前缀双层 + decode code 漏人话。
- #25 Windows 默认 PATH 烘焙 POSIX + launchd 文案 + crontab marker → 延后。
- #26 `HubV4` 命名 vs `schema_version: 1`（`core/contracts/hub.ts:58-63`、`core/registry/migrations.ts:12-34`）。
- #27 `__DEV_ROOT__` 死代码（`cli/embed.ts:14,81-113,133`）。
- #28 import-boundary 测网窄 → 延后。
- #29 SSOT 生成式 → 延后（与 p2 #16 的 mcp_config 数据面互补，另立后续）。
- #30 `domain.json` 与 hub.domain 双份 tags 分叉 → 延后。

## Requirements

1. **#18 文档**：8 处文档与代码现实对齐（harnesses.md lifecycle 修正 + 去"render"误导；binding 迁移说明；registry.md 去"未来式"；AGENTS.md/README 上线版本；harness-config 5 家；README 补 .cursor/hooks.json；pending 路径修正；harness wire 现状如实）。
2. **#19** `writeBytesAtomic`/`writeHubAtomic` 等关键写加 fsync + tmp 清理（try/finally）。
3. **#22** doctor 人话模式 info 计数不打印 → `--verbose` 才打；bin 检查只算 enabled cron。
4. **#23** `domain/resource/project list` 空时输出 `jspace: ok: no <x> (...)`。
5. **#24** 错误前缀双层消除 + decode code 人话化（`--json` 才带 code）。
6. **#26** `HubV4` → `HubV1` 命名 + `HUB_SCHEMA_VERSION` 数字常量共用。
7. **#27** 删 `__DEV_ROOT__` 死代码与文档声明。
8. **#20 确认**：`parseManagedLine` 已还原 `\%`（security 批），无残余。
9. **延后项**（#21/#25/#28/#29/#30）记录于 Notes，不改代码。

## Acceptance Criteria

- [x] #18 八处文档与代码一致（harnesses.md 去 render 误导 + claude lifecycle 对齐 / binding 表述 / registry.md 去未来式 / AGENTS.md 分发现实 / harness-config 5 家 / README 补 .cursor/hooks.json / pending 路径 `<filehub>/.jspace-logs` / README harness wire 现状）；改 `templates/workbench/` + `skills/` 后重跑 gen-assets + build，generated 同步。
- [x] #19：`writeBytesAtomic` 含 fsync + rename 失败清理 tmp（`openSync/fsyncSync/closeSync`）；既有原子写测试不回归。
- [x] #22：doctor 人话默认不打印 info（计数保留）；`--verbose` 打印 info（CLI 冒烟验证）；bin 检查只算 enabled cron。
- [x] #23：`domain/resource/project list` 空 → `jspace: ok: no domains/projects/resources`。
- [x] #24：`fail(\`jspace: ...\`)` 双前缀去净（`jspace: error: jspace:` 为 0）。
- [x] #26：`HubV1` 命名生效（`git grep HubV4` 为 0）+ `HUB_SCHEMA_VERSION` 数字常量合约侧共用（migrations.ts 派生）。
- [x] #27：`__DEV_ROOT__` 死代码清除（`PLACEHOLDER`/`jsonEscape` 删；`materializeTree`/`filehubReadme` 去参；仅注释提及）。
- [x] #20 确认：`parseManagedLine` 已还原 `\%`（security 批），round-trip 收敛无残余。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 535/535 绿；`bun run build` 成功；三个一致性脚本全绿；gen-assets 新鲜度 OK。

## Notes（决策留痕）

- **延后项**（未改代码，供后续批）：#21（failIngest 先删 staged 再写 journal，涉及补偿语义）、#25（Windows PATH 烘焙 POSIX + launchd 文案 + crontab marker 不一致）、#28（import-boundary 测网扩）、#29（SSOT 生成式——与 p2 #16 mcp_config 数据面互补，另立）、#30（domain.json 与 hub.domain 双份 tags 分叉）。
- #16 harness wire 统一（p2 降级延后）→ 与 #18h 文档同步已做（README 如实标注现状），代码统一仍延后。

## Out of Scope / 延后（Notes 记录）

- #21（failIngest 顺序）、#25（Windows PATH/launchd/marker）、#28（import-boundary）、#29（SSOT 生成式）、#30（domain.json tags 分叉）——本批不改，另立后续批或 p3 收尾说明。
- #16 harness wire 统一（p2 降级延后）——与 #18h 文档同步一并，但代码统一仍延后。
