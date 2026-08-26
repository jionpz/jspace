# Design: 文档漂移 + 打磨（#18 #19 #22 #23 #24 #26 #27）

## #18 文档对齐（全组，逐处）

- **18a** `skills/jspace-use/references/harnesses.md`：去掉"由 capabilities.yaml render——勿手工编辑"的误导（实为非生成），lifecycle 四格改为与 `capabilities.yaml` 一致（claude/opencode/pi `session_end: manual`、grok `best_effort`）。
- **18b** 根 `AGENTS.md:53`、`templates/filehub/README.md:51`、`skills/asset-ingest/references/gbrain-write.md:42-43`：改为"资源主路径经 `local.bindings` 绑定（绝对路径在本机 local.json，hub.json 存 binding 引用）"。
- **18c** `skills/jspace-use/references/registry.md:37-44`：去"未来行为"表述 → `domain/resource/project list/add/remove` 已实现；同步 `jspace-use/SKILL.md:78,161`。
- **18d** `AGENTS.md:26,55-56`：删"未上线/无兼容性负担"→ 改为"M5 分发已完成、v1.0.11、install/update 已发布；schema 演进走迁移"。
- **18e** `skills/harness-config/`：认 5 家（补 Grok/OpenCode）。
- **18f** `templates/workbench/README.md:15-19`：补 `.cursor/hooks.json`。
- **18g** `templates/workbench/AGENTS.md:79`、`jspace-use/SKILL.md:135`：pending 路径改为 `<filehub>/.jspace-logs`。
- **18h** `README.md:81`：`harness wire --harness <x>` 改为"当前支持 grok；claude 用 `jspace gbrain wire`"。

改 `templates/workbench/` 或 `skills/` 后必须重跑 `scripts/gen-assets.ts` + `bun run build`（资产嵌入同步）；`check-harness-consistency` 对 harness 支持集名称敏感，改 18e 需同步 skill 文档清单。

## #19 fsync + tmp 清理（`adapters/fs/workbench-state.ts`）

`writeBytesAtomic`（:96）：写 tmp → rename。加：
- 写 tmp 后用 `openSync(tmp, "r")` + `fsyncSync(fd)` + `closeSync`（关键写落盘）。
- rename 失败 → try/finally 清理 tmp。
`writeHubAtomic`/`writeLocalAtomic` 等走 `writeBytesAtomic` 自动获得。测试：不新增真 fsync 断言（平台差异大），靠既有原子写 round-trip 回归。

## #22 doctor 人话 info

`doctorWorkbench` 人话分支（:543-551）：info 只在 `--json` 计数、人话不打印 → 加 `--verbose` 时人话才打 info；bin 检查 `harness.bin_missing` 只算 enabled cron（disabled 不吓人）。涉及 `cli/commands/doctor.ts` 的 `--verbose` option。

## #23 空列表 ok 行

`domain/resource/project list` 空时 `lines: []` → 统一 `jspace: ok: no domains (workspace is empty)` 等。改 `application/registry/{domain,resource,project}.ts` 的 list 空分支。

## #24 错误前缀

- `main.ts` 已统一 `jspace: error: <msg>`；双前缀来源：`fail()` 的 msg 已含 `jspace: ` 或 handler 把 `jspace: error:` 塞进 lines。逐处去重（grep `jspace: error: jspace:`）。
- decode 的 `(code)` 从人话剥离，`--json` diagnostics 才带 code。

## #26 HubV1 命名

`core/contracts/hub.ts`：`export type HubV4` → `export type HubV1`（`schema_version: 1`）；`core/registry/migrations.ts` 迁移键用 `HUB_SCHEMA_VERSION = 1` 数字常量。全仓库 `HubV4` 引用改 `HubV1`（`git grep` 定位）。

## #27 __DEV_ROOT__ 清理

`cli/embed.ts`：删 `replaceAll("__DEV_ROOT__", ...)` 与相关死代码；文档去掉 __DEV_ROOT__ 提及。验证 `git grep __DEV_ROOT__` 干净。

## #20 确认

security 批已让 `parseManagedLine` 还原 `\%` → `%`；`crontabLine` 写 `\%`。round-trip 收敛。本批仅在 scheduler 测试确认无残余。

## 风险

- #18 改 `templates/workbench/` 或 `skills/` 后 gen-assets 会改 generated（需提交）；`check-harness-consistency` 若因文档措辞变化红 → 仅改文档内容不触发（该脚本查 harness 名与代码/模板/CI 一致性）。
- #26 改名是机械替换，`git grep HubV4` 兜底；tsc 门禁防漏。
- #27 删死代码后 `cli/embed.ts` 的 `devRoot`/`isCompiled` 导出若被消费需保留。
