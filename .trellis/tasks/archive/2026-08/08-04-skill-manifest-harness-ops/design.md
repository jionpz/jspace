# Skill Manifest、Harness 能力矩阵与日常运维闭环 — Technical Design

## 1. Design Objective

把 skills 从「`gen-assets.ts` 硬编码 SOURCES + prose 声明」收敛为 typed 契约与一致物化：

1. **SkillsManifest 契约**：`skills-manifest.json` 是 skill 唯一来源——required workbench skills（4）+ global skills（harness-config）；gen-assets 由它驱动 SOURCES，编译二进制内嵌 manifest（修复审计 F2）。
2. **skills ownership → managed**：未修改 bundled skill 随 upgrade 刷新，本地修改 conflict 不覆盖（修订 Child B seed 决定；让版本校验与修复真实有效）。
3. **workbench 引用可达**：物化工作台内所有 markdown（含根 AGENTS.md）引用全部落在 skill 目录内或显式标注外部（修复 MEMORY-ACCEPTANCE / HEADLESS-OPS 死引用）。
4. **harness lifecycle 矩阵**：四 harness × 四操作统一分级，automated 格有测试证据（修复审计 F8）。
5. **默认 cron skill targets（最小闭环，AC17 partial）**：`CronDefinition` 增加可选 `target`；`inbox-tidy` 指向 `asset-ingest`，install/rehearsal 前置校验；prose cron 轻量静态校验。

不增加常驻运行时，不触碰真实用户 harness 配置，不修改真实 scheduler。

## 2. Baseline（confirmed，行号 2026-08-04 实测）

| 事实 | 证据 |
| --- | --- |
| **F2**：gen-assets SOURCES 仅 bootstrap+asset-ingest；编译二进制 init 不物化 memory-recall/writeback | `scripts/gen-assets.ts:12`；`cli/embed.ts:79-84` |
| 无 `skills-manifest.json`；`ownershipFor` 全部 `skills/` → seed | `application/workspace/manifest.ts:16-19` |
| **seed 使 diffBundle 永不产出 update/conflict**（skip: never overwrite）→ 版本校验不可达 | `application/workspace/manifest.ts:61-81`；`manifest.test.ts:58-84` |
| 模板 AGENTS 声明 4 required skills + 4 resolver rows；AGENTS.md:159 引用 `docs/HEADLESS-OPS.md`（死引用） | `templates/workbench/AGENTS.md:109-113,165-168,159` |
| memory-recall 三处引用 `docs/MEMORY-ACCEPTANCE.md`（SKILL.md:3,61,66 / discipline.md:3,51,61）；仅该 skill 引用 | `skills/memory-recall/*` |
| 真实跨 skill 引用未声明：memory-recall → asset-ingest、memory-writeback → asset-ingest / jspace-bootstrap | `skills/memory-recall/SKILL.md:67`；`skills/memory-writeback/SKILL.md:70-71` |
| `CronDefinition` 仅 prose `prompt`（必填，strict unknown-field）；`HARNESSES=["claude","codex","pi"]` | `core/contracts/cron.ts:63-67,18` |
| `harnessArgv` 无任何单测引用（automated 格缺测试证据） | `adapters/harness/argv.ts`（全仓 grep 无测试引用） |
| `execute.ts:106` 用 `cron.prompt.includes("inbox")` 判 inbox 任务（F3 批量守卫判定源） | `application/automation/execute.ts:106` |
| harness 能力信息分散三处；无 lifecycle matrix | `docs/PLATFORMS.md:21-31` + bootstrap/harness-config references |
| harness-config 全局自装 `~/.agents/skills/harness-config`（rsync 幂等），不入 workbench | `skills/harness-config/SKILL.md` Phase 1 |
| 基线 139 tests = 138 pass / 1 fail（state.test.ts:58 order-dependent） | `bun test`（2026-08-04） |
| `DistributionManifestV1` 无 gbrain 兼容字段（RD6 不 bump） | `core/contracts/distribution.ts` |
| 父设计 §11：远程安装下载到临时文件 + 展示来源/校验和 + 用户审批 | `.trellis/tasks/08-03-*/design.md` §11 |

## 3. Target Architecture

```text
skills-manifest.json             # 唯一 skill 来源（repo root，gen-assets 消费）
core/contracts/
  skills.ts                      # SkillsManifestV1 + SkillEntry + decoder（diagnostics 模式）
  cron.ts                        # CronDefinition + CronSkillTarget（扩展，向后兼容）
scripts/gen-assets.ts            # SOURCES 由 manifest.workbench 驱动；emit cli/skills.generated.ts
cli/skills.generated.ts          # SKILLS_MANIFEST（编译二进制内嵌，供校验消费）
cli/embed.ts                     # materializeTree 按 manifest 断言 4 skills（F2）
application/workspace/manifest.ts# ownershipFor: skills/ seed → managed
application/automation/
  definitions.ts                 # resolveCronPrompt + validateSkillTarget + prose 静态校验
  execute.ts                     # 执行前 validate（早于 dry-run return）；isInboxTask 迁移
skills/
  jspace-bootstrap/references/harnesses.md   # lifecycle 能力矩阵（权威，bundled）
  jspace-bootstrap/references/headless-ops.md# 由 docs/HEADLESS-OPS.md 迁入
  memory-recall/references/memory-acceptance.md  # 由 docs/MEMORY-ACCEPTANCE.md 迁入
templates/workbench/AGENTS.md    # 死引用改指 skill 内路径；「自动」措辞对齐分级
docs/PLATFORMS.md                # 交叉引用 lifecycle 矩阵；argv 分级标注测试证据
cli/commands/registry.ts         # 注入 SKILLS_MANIFEST + journal/readFile 给 application
```

依赖方向不变：`core/contracts` 无副作用；`application/*` 消费注入依赖；`cli/*` 只做接线。

## 4. SkillsManifest 契约（core/contracts/skills.ts）

```ts
export type SkillScope = "workbench" | "global";

export interface SkillEntry {
  name: string;           // ID_PATTERN
  version: string;        // R6 声明性元数据（随 bundle 演进；运行时陈旧性用 diffBundle 内容比对，不建 per-skill 版本文件）
  scope: SkillScope;      // workbench = 物化进工作台；global = 机器级，不入 bundle
  dependencies: string[]; // 真实跨 skill 依赖（memory-recall→asset-ingest；memory-writeback→asset-ingest,jspace-bootstrap）
  install_source?: string;// global 专用：安装/升级来源（如 $HOME/.agents/skills/harness-config）
  description: string;
}

export interface SkillsManifestV1 {
  version: 1;
  workbench: SkillEntry[];  // 4 required workbench skills
  global: SkillEntry[];     // harness-config
}
```

- **去掉 `SkillEntry.entrypoint`**（恒等于 `skills/<name>/SKILL.md`，可派生），消除与 `CronSkillTarget.entrypoint` 的同名异义。
- decoder 校验约束：`scope === "global"` ⇒ `install_source` 非空；`scope === "workbench"` ⇒ 无 `install_source`。
- 仓库根 `skills-manifest.json` = 权威来源（version 1）；`workbench` 顺序稳定（bootstrap / asset-ingest / memory-recall / memory-writeback）。

## 5. skills ownership → managed + gen-assets 由 manifest 驱动（RD1 / F2）

### 5.1 ownershipFor 修订

```ts
export function ownershipFor(rel: string): AssetOwnership {
  if (rel.startsWith("skills/")) return "managed";   // 修订：seed → managed
  return "managed";
}
```

- 效果：`diffBundle` 对未修改但 bundle 前进的 skill 产出 `update`（`recorded === currentSha` 分支）、本地修改产出 `conflict`、缺失产出 `create`、已移除产出 `stale`——四类都可被 `validateSkillTarget` 判为版本不兼容，且 `workspace upgrade` 能真实修复。
- **保护不降级**：upgrade 对 conflict 不覆盖（沿用 Child B 冲突策略）；`materializedRel` 不变（`skills/<name>/...` 原样落位）。
- 同步更新 `application/workspace/manifest.test.ts`（seed→skip 断言改为 managed→update/conflict）。

### 5.2 gen-assets 驱动

```ts
const raw = readFileSync("skills-manifest.json", "utf-8");
const manifest = decodeSkillsManifest(JSON.parse(raw));  // 启动即校验
const skillDirs = manifest.workbench.map(s => `skills/${s.name}`);
const SOURCES = ["templates/workbench", "templates/filehub", ...skillDirs];
for (const d of skillDirs) assertDirExists(d);            // manifest↔目录无漂移
```

- 额外 emit `cli/skills.generated.ts`：`export const SKILLS_MANIFEST: SkillsManifestV1 = {...}`（与 `manifest.generated.ts` 同模式）。
- `materializeTree`（cli/embed.ts）缺失断言改为按 `SKILLS_MANIFEST.workbench` 遍历（覆盖 4 skills）。

## 6. workbench 引用可达（RD2）

- **`docs/MEMORY-ACCEPTANCE.md` 迁入 `skills/memory-recall/references/memory-acceptance.md`**；引用点（SKILL.md:3,61,66 / discipline.md:3,51,61 / GOAL.md 3 处）同步更新。
- **`docs/HEADLESS-OPS.md` 运维要点迁入 `skills/jspace-bootstrap/references/headless-ops.md`**；AGENTS.md:159 改指 skill 内路径；GOAL.md 链接同步。
- **contract test 解析规则**：
  - 扫描范围 = 物化工作台全部 `.md`（`AGENTS.md` + `skills/**/SKILL.md` + `skills/**/references/*.md` + `README.md`）。
  - 解析规则 = 匹配 `[...](路径)` 与反引号`` `路径` ``中的相对路径；仅解析 `skills/`、`references/`、`README` 等 bundle 内前缀。
  - 外部豁免格式 = `[external]` 标注或 `http(s)://` / 外部项目路径（如 gbrain 自身 `docs/...`）；bundle 内引用必须可解析到文件。
  - 断言：无指向仓库根 `docs/` 的 bundle 内引用（除非 `[external]` 标注）。

## 7. Cron skill target（RD5 / 最小闭环）

### 7.1 契约扩展（core/contracts/cron.ts）

```ts
export interface CronSkillTarget {
  kind: "skill";
  skill: string;       // manifest.workbench 中的 skill name（如 "asset-ingest"）
  entrypoint: string;  // skill 内语义入口（如 "batch"）；validate 顺带校验 skill 声明过该入口
  input: string;       // 传给 skill 的语义输入
}

export interface CronDefinition {
  id: string;
  schedule: string;
  harness: Harness;
  prompt?: string;            // 变为可选：custom escape hatch
  target?: CronSkillTarget;   // 新增可选：skill target
  enabled: boolean;
}
```

- `decodeCrons`：允许字段加 `target`；校验**恰好一个** `prompt` 或 `target`。既有 v1 文件（全为 prompt）向后兼容，schema_version 保持 1。
- 模板 `templates/workbench/.jspace/cron.json`：`inbox-tidy` 改 `target`（skill `asset-ingest`，entrypoint `batch`，input 沿用现 prompt 语义）；`weekly-report` / `memory-consolidate` 保持 prompt。
- 旧二进制读含 `target` 的新 cron.json → unknown-field 拒绝；文档注明先升 CLI（不 bump schema，见 prd §7）。

### 7.2 编译与校验（application/automation/definitions.ts）

```ts
/** 把 cron 定义编译为实际 headless prompt；target 校验失败则 fail 并给修复动作。 */
export function resolveCronPrompt(def, wbRoot, ctx): string;
// target 路径：validate → 输出含 "<wbRoot>/skills/<skill>/SKILL.md" 绝对路径 + entrypoint 节 + input，
//   让无头 harness 直接定位 skill（例如 "在工作台 <wbRoot> 按 AGENTS.md 路由；阅读并执行
//   <wbRoot>/skills/asset-ingest/SKILL.md 的 batch 流程；input: …"）
// prompt 路径：直接返回 def.prompt

/** 纯函数前置校验。 */
export function validateSkillTarget(target, wbRoot, manifest, diffFns): ValidateResult;
```

`validateSkillTarget` 规则（skills→managed 后全部可达）：

1. `target.skill` ∈ `manifest.workbench` names → 否则 `fix: "run jspace update（未知 skill）"`。
2. `<wbRoot>/skills/<skill>/SKILL.md` 存在 → 否则 `fix: "re-run jspace init 或 workspace upgrade 恢复 bundled skills"`。
3. `target.entrypoint` ∈ 该 skill 声明的 entrypoint 集（manifest 提供或 skill 内约定，当前 asset-ingest 含 batch）→ 否则报错。
4. **版本/陈旧性 = diffBundle（Child B）对 skill 名下 manifest 文件**：存在 `update` | `conflict` | `create` | `stale` 任一 → 不兼容 → `fix: "run jspace workspace upgrade"`（managed 后 upgrade 可真实修复）；全部 `no-op` → 兼容。

- `execute.ts`：`validateSkillTarget` 调用插在 **dry-run 提前 return（execute.ts:82-84）之前**；失败则打开 incident 返回非 0、不 spawn。
- **isInboxTask 迁移**（F3 批量守卫判定源）：`cron.prompt.includes("inbox")`（execute.ts:106）改为 `cron.id === "inbox-tidy" || cron.target?.skill === "asset-ingest"`；补 target 版 inbox-tidy 的「batch 日志未变化 → batch-stale incident」回归测试，防止守卫随 prompt 消失。
- `cron install` / rehearsal（`cron run --dry-run`）对 skill-target 任务执行同一校验，前置失败给修复动作。

### 7.3 prose cron 轻量静态校验（缩小 AC17 partial）

- contract test：对 `weekly-report` / `memory-consolidate` 的 prompt 文本提取 `skills/<name>` 引用与 skill 名，断言 ∈ `SKILLS_MANIFEST.workbench`；资源名（如 filehub path 引用）仅作存在性警告不阻断。

## 8. Harness lifecycle 能力矩阵（RD4 / F8）

- **权威矩阵**落位 `skills/jspace-bootstrap/references/harnesses.md`，新增「Lifecycle 能力矩阵」节：

| harness | session-start retrieval | session-end write-back | 显式 fallback | crash recovery |
| --- | --- | --- | --- | --- |
| Pi | best_effort | best_effort | manual | best_effort |
| Claude Code | best_effort（hook 需真实 harness 验证） | best_effort（AGENTS End-of-Work + 显式收工） | manual | best_effort（SessionStart cron check） |
| Codex | best_effort（需用户 enable+approve） | manual | manual | best_effort |
| Cursor | best_effort（Rules/hook） | manual | manual | manual |

> 上表为草案，实施时以 `harness-config/references/harnesses.md`（官方核查 2026-08-02）为据逐格复核；**automated 仅保留有 CI 测试证据的路径**（如 claude cron argv），其余如实标 best_effort/manual/unsupported（invariant #7）。

- **automated 格测试证据**：为 `harnessArgv`（claude/codex/pi 三形状 + allowedTools 白名单）补最小单测；PLATFORMS.md「CI 验证 argv 生成」措辞由此坐实。
- `docs/PLATFORMS.md`：新增「Harness lifecycle 能力矩阵」交叉引用节（指向 `skills/jspace-bootstrap/references/harnesses.md`，不复制整表）；argv 分级表（M4）保留并标注测试证据。AC-D7 的 contract test 断言两处 automated 集合相等（或 PLATFORMS 只交叉引用）。
- **措辞清理范围**（AC-D3）= 模板 `AGENTS.md` + bootstrap/harness-config `references/` + `docs/PLATFORMS.md`；`GOAL.md` 是父级对齐物，**不改写 vision 措辞**，仅在「记忆协议」节加指针行。模板 AGENTS.md:159「Claude Code does this automatically」必须改为分级措辞。

## 9. harness-config global scope（RD3）

- manifest `global` 数组承载 `harness-config`（scope global、install_source `~/.agents/skills/harness-config`、dependencies 空）。
- 模板 AGENTS.md 与 bootstrap references 的「见 harness-config skill」表述明确标注为**机器级全局 skill，不随工作台物化**；若需使用先按其 Phase 1 自装。
- contract test：`SKILLS_MANIFEST.workbench` 不含 harness-config；ASSETS/bundle 不含 `skills/harness-config/`；global 条目含 install_source；scope/install_source 组合约束生效。

## 10. Bootstrap 安全与 gbrain 兼容（RD6 / AC12 子集）

- **管道远程安装对齐父设计 §11**：bootstrap Phase 0 的 bun/git 自动安装由「默认执行」改为：
  1. 探测缺失 → 给出安装命令但**不默认执行**；
  2. 需要时下载到临时文件，展示 host/来源 + 校验和；
  3. **用户显式确认后**执行。
  删除「do not stop to ask」措辞。
- **可机械断言守卫**：contract test 扫描 bootstrap SKILL.md 文本，断言含「用户确认/审批」标记且管道行前后 3 行内有来源/校验和说明（定义判定规则，避免空扫）。
- **gbrain 版本范围 + 健康检查**：`skills/jspace-bootstrap/references/gbrain.md` 声明支持/已验证版本范围；Phase 1 的 `gbrain doctor --json` 作为升级前健康检查；fixture/test 断言存在。不 bump `DistributionManifestV1`（记录为演进选项）。
- **AC12 敏感屏蔽 owner**：既有 doctor/logging 已按 R8 实现；Child D 不新增泄密输出，显式记录 owner（Child F 全链验收复核）。

## 11. Testing Strategy

| Area | Tests |
| --- | --- |
| SkillsManifest | decoder round-trip、unknown-field、id/scope 校验、scope⇒install_source 约束；manifest↔skills 目录一致 |
| ownership | skills→managed：diffBundle 未修改→update、本地改→conflict、缺→create、移除→stale（修订 manifest.test.ts seed→skip） |
| gen-assets / bundle | 4 skills 全入 ASSETS 与 BUNDLE_MANIFEST（F2）；`cli/skills.generated.ts` 与 `skills-manifest.json` 一致 |
| init 物化 + upgrade 补全 | 临时工作台 init 后 4 skills+references 齐全；旧 bundle 工作台 upgrade 后自动补全（AC-D8） |
| 引用可达 | 物化工作台全部 md 引用解析可达；无 `docs/` 死引用（AC-D2） |
| Cron target | decodeCrons 恰好一个 prompt/target；inbox-tidy target 解析；weekly/consolidate 保持 prompt |
| validateSkillTarget | unknown skill / missing SKILL.md / entrypoint 未声明 / diffBundle update|conflict|create|stale → ok:false+fix（AC-D4） |
| resolveCronPrompt | target 编译含 skill 文件路径；prompt 原样；dry-run 无副作用 |
| isInboxTask | target 版 inbox-tidy 走批量守卫；batch 日志未变化 → batch-stale incident（F3 不回退） |
| harnessArgv | claude/codex/pi 三形状 + allowedTools 单测（automated 格证据） |
| lifecycle matrix | 每格 ∈ 四分级；automated 格有验证标注；产品文档无未验证「自动」措辞（AC-D3/D7） |
| bootstrap 安全 | bundle 无未确认管道安装；gbrain 版本范围 + doctor 检查存在（AC-D5） |

基线 139 测试在 M0 修复 order-dependent 后全绿；`cli/cron.test.ts` 无 decodeCrons 用例——M5 **新增** decodeCrons 契约测试（含 target/one-of）。

## 12. Risks & Rollout

- **ownership 修订波及 Child B**：`manifest.test.ts` 及任何依赖 seed→skip 断言的测试需同步；M1/M2 同里程碑内完成，避免中间态。
- **execute.ts 迁移时序**：`prompt` 可选化 + isInboxTask 迁移 + validate 插入在 M5/M6 同里程碑内落地，杜绝「可选化但执行器仍读 prompt」的中间失效。
- **docs 迁移漂移**：MEMORY-ACCEPTANCE / HEADLESS-OPS 迁入 skill 后，convergence 时 grep 全仓确认无残留 `docs/` 引用（GOAL.md / AGENTS.md 一并）。
- **AC17 partial 验收争议**：PRD/父任务 acceptance mapping 显式标注 partial + prose 静态校验缩小差距；父任务 gate 对齐。
- **基线 flake**：`state.test.ts:58` order-dependent 先修（M0），否则里程碑「tests 绿」不可信。
- **矩阵分级诚实性**：automated 仅给有测试证据路径；宁可多标 best-effort/manual。
- **Rollout**：M0 修基线 → M1 manifest+ownership → M2 gen-assets+bundle（F2）→ M3 引用可达 → M4 harness-config scope → M5 cron target 契约+模板 → M6 validate+compile+execute 接线 → M7 lifecycle 矩阵+argv 测试 → M8 bootstrap 安全/兼容 → M9 全链 gate。每里程碑 tsc + 139 tests 绿、skill 源与 bundle manifest 同提交。
