# P2: 契约/架构/doctor 对齐（issue #8 #10 + #11 + #13 + #14 + #16 + #17）

## Goal

修复六个契约/架构/doctor 对齐缺陷：

- **#10** `type: filehub` 单例不变量只在 `filehub init`，`resource add --type filehub` 可登记第二个；primary/inspect/ingest/pending 全部**静默取第一个**。
- **#11** Win32 周日 `dow=7` 与 inspect 回读 `0` 不收敛：`"0 21 * * 7"` 第二次 install 仍 update。
- **#13** `domain add` 写 hub 失败不回滚骨架目录（skeleton 已写、`writeHubAtomic` 抛错 → 残留目录 + hub 无记录）。
- **#14** doctor 休眠域扫描绕过 hub 的自定义 `d.path`：只 `readdir(workspace/)` 且文案写死 `workspace/${name}`。
- **#16** gbrain 接线 Claude 特例：`gbrain wire`/doctor 只读 `~/.claude.json`，grok 另走 `harness wire`，opencode/cursor/pi 无 wire 无检查——GOAL「任意 harness 同一份记忆」未闭环。
- **#17** `gen-assets` 引导环：生成器 import 自己产出的 `capabilities.generated.ts`（`gen-assets.ts:8 → manifest.ts:8 → registry.ts → capabilities.generated.ts`），generated 缺失时**无法再生**。

父任务：`08-10-issue8-review-fixes`。

## Requirements

### #10（filehub 单例进契约）
1. `core/contracts/hub.ts` `decodeResources`：`type=filehub` 至多一条（新增 `hub.resource.filehub.unique` issue）。
2. `application/registry/resource.ts` `resourceAdd`：`--type filehub` 时若 hub 已有 filehub → fail；复用同一规则。
3. `core/registry/effective.ts` `primaryPathForResourceType`：多条 filehub 时 `fail` 而非 first-match（纵深防御）。

### #11（Win32 dow round-trip）
4. `application/automation/scheduler.ts` `planReconciliation`：schedule 比较前规范 Sunday（dow `7` ≡ `0`）——cron 语义两者同为周日，收敛（不再每次 update）。
5. 回归：desired `"0 21 * * 7"` vs installed `"0 21 * * 0"` → no-op。

### #13（domain add 回滚）
6. `application/registry/domain.ts` `domainAdd`：`writeHubAtomic` 抛错 → try/catch 走 `rollbackDomainSkeleton` 再抛。
7. 回归：fakeFs/注入写失败 → 骨架目录被回滚（`unlink` 调用断言）。

### #14（doctor 休眠域）
8. `application/diagnostics/doctor.ts` `checkDomains`：以 `hub.domains[].path` 为准；未注册的 `workspace/*` 残留另码 `domain.unregistered`（warning）；自定义 `--path` 域能被正确扫描。
9. 回归：hub 自定义 path 域休眠 → `domain.dormant`；未注册目录 → `domain.unregistered`。

### #16（gbrain wire 多 harness）— 本批最大项，实现靠后、可隔离
10. capabilities.yaml 每 harness 增 `mcp_config: { path, format, server_key }`（claude: `~/.claude.json`/json/mcpServers.gbrain；grok: `~/.grok/config.toml`/toml/mcp_servers.gbrain；opencode/cursor/pi 同理或标不支持）。
11. types.ts + gen-assets 渲染 + `check-harness-consistency` 同步（SSOT 单一事实源不漂移）。
12. `harness wire [--harness <all>]` 统一：claude 的 `gbrain wire` 作别名；grok 走现有 TOML 路径。
13. doctor `checkGBrain`：按已安装且 `mcp.native` 的 harness 逐个验 `GBRAIN_SKILLS_DIR`。
14. 若实现体积/一致性脚本风险过大，允许降级为「仅 doctor 多 harness 检查 + 文档」并单独提交，留统一 wire 为后续。

### #17（gen-assets 解环）
15. 抽 `ownershipFor`/`recreateOnMissing` 到纯模块 `application/workspace/ownership.ts`（不碰 registry）；`manifest.ts` re-export 保持既有消费者。
16. `gen-assets.ts` 改从 `ownership.ts` + `core/shared/hash.ts` 取 `ownershipFor`/`sha256Of`（不再经 manifest.ts/registry）。
17. `SKILL_PROJECTIONS` 改惰性（`skillProjections()` 函数），更新 manifest.ts:62 与 doctor.ts 消费点。
18. 回归：删 `capabilities.generated.ts` 后 gen-assets 仍能跑（验证解环）；现有 generated 新鲜度检查不回归。

## Acceptance Criteria

- [x] #10：`resource add --type filehub` 第二个 → fail(/filehub resource is already registered/)；`decodeHub` 两条 filehub → `hub.resource.filehub.unique`；`primaryPathForResourceType` 双 filehub → fail。
- [x] #11：`planReconciliation` 对 dow `0`/`7` 收敛（round-trip 用例：7 vs 0 → no-op；真正不同 schedule 仍 update）。
- [x] #13：`writeHubAtomic` 失败（chmod 只读）→ skeleton 目录回滚（`workspace/<id>` 不存在）。
- [x] #14：休眠域扫描以 hub path 为权威（自定义 `workspace/deep/custom` 休眠 → `domain.dormant`）；未注册 `workspace/stale` → `domain.unregistered`（warning）；祖先目录不误报；既有 dormant/boundary 测试已更新注册域。
- [x] #17：`ownershipFor` 抽纯模块 `ownership.ts`；gen-assets 改从纯模块 + hash.ts 引（不再经 registry）；`SKILL_PROJECTIONS` → `skillProjections()` 惰性；**验证：删除 `capabilities.generated.ts` 后 gen-assets 仍再生成功**；gen-assets 新鲜度 OK。
- [x] #16（数据面 + doctor）：capabilities.yaml 每 harness 增 `mcp_config`（claude/grok 真路径，其余 null）+ types `McpConfig` + 重新渲染；doctor `checkGBrain` 多 harness 逐个验（claude json / grok toml，`gbrain.skillsdir_unwired`）；`harness wire` 统一按降级门**延后**（记录于 Notes）。
- [x] `bunx tsc --noEmit` 0 错误；全量 `bun test` 535/535 绿；check-harness-consistency / check-manifest-integrity / check-skills 全绿；gen-assets 与 yaml 同步。

## Notes（决策留痕）

- **#16 降级门（implement.md 预授权）**：本批完成数据面（`mcp_config` SSOT 进 capabilities.yaml + 渲染）与 doctor 多 harness 检查（claude/grok 逐个验）；`jspace harness wire [--harness]` 统一（claude 别名 + 全 harness）涉及 CLI 面扩大，延后至 `08-10-issue8-p3-docs-polish`（与 #18h 文档同步一并处理）。
- #14 行为变化：未注册 `workspace/*` 残留从「休眠域 info」变为 `domain.unregistered` warning（更醒目），休眠域仅对已注册（hub path）域生效。

## Out of Scope（本批不做）

- #18 文档三角漂移（含 #16 的文档同步）→ `08-10-issue8-p3-docs-polish`。
- #29（SSOT 生成式）→ `08-10-issue8-p3-docs-polish`。
