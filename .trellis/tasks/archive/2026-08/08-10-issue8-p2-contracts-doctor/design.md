# Design: 契约/架构/doctor 对齐（#10 #11 #13 #14 #16 #17）

## #10 — filehub 单例进契约

**decode（`core/contracts/hub.ts` `decodeResources`）**：函数作用域加 `let filehubCount = 0;`；`type === "filehub"` 时 `filehubCount += 1`，>1 → `issues.add("hub.resource.filehub.unique", ...)`。

**resourceAdd（`application/registry/resource.ts:66-87`）**：
```ts
if (resourceType === "filehub" && hub.resources.some((r) => r.type === "filehub")) {
  fail("a filehub resource is already registered; the asset root must be unique");
}
```

**effective（`core/registry/effective.ts` `primaryPathForResourceType`）**：收集匹配 resources；>1 → `fail(\`multiple ${type} resources registered ...\`)`（纵深防御——decode+add 已挡，手写 hub 时兜底）。

## #11 — Win32 dow round-trip

`planReconciliation`（`application/automation/scheduler.ts:27`）比较前规范化：
```ts
function canonicalSchedule(s: string): string {
  return s.split(" ").map((f, i) => (i === 4 && f === "7" ? "0" : f)).join(" ");
}
// in planReconciliation:
} else if (canonicalSchedule(inst.schedule) !== canonicalSchedule(d.schedule) || inst.argv !== d.argv) {
```
cron 语义 dow 0 与 7 同为周日 → 收敛是正确而非取巧。平台无关（linux/darwin 两侧同值不受影响）。

## #13 — domain add 回滚

`domainAdd`（`application/registry/domain.ts:130-138`）：
```ts
try {
  writeHubAtomic(root, hub);
} catch (e) {
  rollbackDomainSkeleton(domainDir, nearestExisting, created);
  throw e;
}
```
decode-fail 分支已回滚，补 write-fail 分支。

## #14 — doctor 休眠域

`checkDomains(root)` → `checkDomains(reads)`（有 hub）：
- 以 `hub.value.domains[].path` 为准：每个注册域 `join(root, d.path)` 计算 `lastActivityMs` → `domain.dormant`。
- `readdirSync(join(root, "workspace"))` 中不在 hub 注册的目录 → `domain.unregistered`（warning，残留目录提示清理）。
- 文案用 `d.path`（不再写死 `workspace/${name}`）。

## #17 — gen-assets 解环

新 `application/workspace/ownership.ts`（纯，仅 type imports）：
```ts
export function ownershipFor(key: string): AssetOwnership { ... }  // 从 manifest.ts 移入
export function recreateOnMissing(rel: string): boolean { ... }    // 移入
```
`manifest.ts` 改为 `export { ownershipFor, recreateOnMissing } from "./ownership.ts"`（既有消费者/manifest.test 不变）。`gen-assets.ts:8` 改：
```ts
import { ownershipFor } from "../application/workspace/ownership.ts";
import { sha256Of } from "../core/shared/hash.ts";
```
`SKILL_PROJECTIONS` 惰性化：`export const SKILL_PROJECTIONS = workbenchProjectionDirs()` → `export function skillProjections(): readonly string[] { return workbenchProjectionDirs(); }`；更新 `manifest.ts:62`（`...skillProjections().map(...)`）与 `doctor.ts:347-362`（`for (const proj of skillProjections())`）。验证：`rm adapters/harness/capabilities.generated.ts && bun run scripts/gen-assets.ts` 应成功。

## #16 — gbrain wire 多 harness（大项，靠后/可隔离）

**capabilities.yaml 每 harness 增**（示例）：
```yaml
claude:
  mcp_config: { path: "~/.claude.json", format: json, server_key: "mcpServers.gbrain" }
grok:
  mcp_config: { path: "~/.grok/config.toml", format: toml, server_key: "mcp_servers.gbrain" }
```
- `types.ts` `HarnessCapabilityData` 增 `mcp_config?: McpConfig`；gen-assets 渲染进 generated；`check-harness-consistency.ts` 的期望表同步（yaml ↔ types ↔ doctor 消费）。
- `harness wire`：`--harness` validate 扩到支持集（claude/grok/…）；claude 分支调 `gbrain wire` 逻辑（`wireSkillsDir`）；grok 走现有 `wireGrokSkillsDir`。
- doctor `checkGBrain`：遍历已安装且 `mcp.native` 的 harness，逐个按 `mcp_config` 读配置、验 `GBRAIN_SKILLS_DIR`。

**降级方案（若体积/一致性风险过大）**：本批只做 doctor 多 harness 检查 + capabilities `mcp_config` 数据面，`harness wire` 统一留 p3 或单独提交——prd #16-14 已列。

## 风险与兼容

- #10 decode 新 issue 会拒绝含两条 filehub 的既有 hub（本机正常 hub 只有一条，安全；doctor 会报 `hub.resource.filehub.unique` 引导修复）。
- #11 收敛改变 update→no-op，是正确方向；win32 侧无行为变化。
- #14 休眠域扫描改用 hub path：未注册残留目录从 info 变 warning（更醒目），检查语义更准。
- #17 `SKILL_PROJECTIONS` 改函数：消费点少（manifest+doctor），风险低。
- #16 capabilities.yaml 改动必须同步 gen-assets 渲染 + consistency 期望表，否则 CI 红——是本批最大风险点。
