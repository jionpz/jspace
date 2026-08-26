# skill manifest + harness 能力矩阵 + 日常运维闭环

## 1. Goal

把 JSpace 的 skills 从「`gen-assets.ts` 硬编码 SOURCES + prose 声明」收敛为 **typed `SkillsManifest` 契约 + 一致的物化/引用可达性 + harness lifecycle 能力矩阵 + 默认 cron skill targets**,闭合父任务 R6（skill 分发与依赖契约）、R7（记忆与资产日常工作流）与 R10（资产 freshness 质量门）。完成后应达到：

- **四个 required workbench skills 一致物化**：`jspace init`（编译二进制）后 `jspace-bootstrap`、`asset-ingest`、`memory-recall`、`memory-writeback` 全部存在；manifest、模板 AGENTS、gbrain resolver rows 与物化结果一致；存量工作台经 `workspace upgrade` 自动补全（修复审计 F2）。
- **workbench 内引用可达**：所有 materialized 内容（skills + 工作台根 AGENTS.md）引用的 docs/references/scripts 随工作台离线可达，或显式标注外部稳定依赖。
- **harness-config 全局 scope 明确**：machine-global skill 有独立 scope、安装/升级来源和依赖关系，不被工作台文档默认为已存在。
- **harness lifecycle 能力如实分级**：Pi / Claude Code / Codex / Cursor 的 session-start / session-end / 显式 fallback / crash recovery 能力逐项标注 automated / best-effort / manual / unsupported，automated 格有测试证据（修复审计 F8）。
- **默认 cron 引用可校验 skill contract**：skill-target 任务缺 required skill 或版本不兼容时 install/rehearsal 在执行前失败并给出修复动作；prose cron 引用的 skill/resource 做轻量静态校验（AC17 显式 partial）。

本任务是父任务「架构澄清与可持续演进重构」的 **Child D**。范围限定在 skill manifest、four-required-skills 物化、harness lifecycle 矩阵与默认 cron skill targets；asset-ingest journal/补偿（Child E）、gbrain pending write envelope 完整协议（Child E）、真实 scheduler 变更（Child C 已闭环）不在此范围。

## 2. Context（现状基线）

审计确认的与本任务相关事实（详见父任务 prd §5 / §5.1；行号 2026-08-04 实测）：

| 事实 | 证据 |
| --- | --- |
| **F2**：`gen-assets.ts` SOURCES 仅 `templates/workbench` + `templates/filehub` + `skills/jspace-bootstrap` + `skills/asset-ingest`；编译二进制 `jspace init` 不会物化 memory-recall / memory-writeback | `scripts/gen-assets.ts:12`；`cli/embed.ts:79-84`（materializeTree 只断言 bootstrap + asset-ingest） |
| 仓库已有 5 个 skill：bootstrap、asset-ingest、memory-recall、memory-writeback（workbench required）+ harness-config（global，自装到 `~/.agents/skills/harness-config`） | `skills/` 目录 |
| 模板 AGENTS.md 声明 4 个 required workbench skills + 4 条 gbrain resolver rows（Brain operations 段） | `templates/workbench/AGENTS.md:109-113,165-168` |
| **F2 同类残余**：工作台根 AGENTS.md 引用 `docs/HEADLESS-OPS.md`（不入 bundle → 物化后死引用） | `templates/workbench/AGENTS.md:159` |
| 无 `skills-manifest.json`；`ownershipFor` 把全部 `skills/` 视为 seed（upgrade 永不覆盖） | `application/workspace/manifest.ts:16-19` |
| **F8**：harness 能力信息分散于 `docs/PLATFORMS.md`（argv 分级 M4）、`skills/jspace-bootstrap/references/harnesses.md`（wiring）、`skills/harness-config/references/harnesses.md`（速查表含 Session 注入列）；无统一 lifecycle matrix | 三文件对照 |
| `CronDefinition` 只有 prose `prompt`，无 skill target 字段；`HARNESSES = ["claude","codex","pi"]`；decodeCrons 严格 unknown-field | `core/contracts/cron.ts:63-67,18` |
| memory-recall 三处引用 `docs/MEMORY-ACCEPTANCE.md`（不入 bundle → 物化后死引用）；仅 memory-recall 这一个 skill 引用它 | `skills/memory-recall/SKILL.md:3,61,66`；`references/discipline.md:3,51,61` |
| 存在真实跨 skill 引用（dependencies 未声明）：memory-recall → asset-ingest、memory-writeback → asset-ingest / jspace-bootstrap | `skills/memory-recall/SKILL.md:67`；`skills/memory-writeback/SKILL.md:70-71` |
| harness-config 的 `references/harnesses.md` 已按官方文档核查（2026-08-02），含跨平台路径速查与 Session 注入通道 | `skills/harness-config/references/harnesses.md` |
| 默认 cron（inbox-tidy / weekly-report / memory-consolidate）为自包含 prose prompt 契约 | `templates/workbench/.jspace/cron.json` |
| harness argv 能力分级已在 `docs/PLATFORMS.md` M4 矩阵（claude automated / codex·pi best-effort），但 `harnessArgv` 无任何单测引用（automated 格无测试证据） | `docs/PLATFORMS.md:21-31`；`adapters/harness/argv.ts` |
| 基线测试：139 tests 实为 **138 pass / 1 fail**（`application/automation/state.test.ts:58` order-dependent，单跑通过） | `bun test`（2026-08-04 实测） |

## 3. Requirements

### RD1. SkillsManifest 契约与唯一物化来源

- 定义 typed `SkillsManifest`，记录 required workbench skills（name/version/scope/dependencies/description）与 global optional skills（harness-config 的安装/升级来源与依赖）、distribution target。
- `scripts/gen-assets.ts` 的 skill SOURCES 由 manifest 驱动（或与 manifest 断言一致），禁止「模板先声明、bundle 后补」的中间状态。
- `jspace init` 后 materialized `skills/<name>/` 与 manifest、模板 AGENTS、resolver rows 完全一致；由 contract test 验证。
- **skills ownership 改为 managed**（update-if-unmodified / conflict-if-modified）：未修改的 bundled skill 随 `workspace upgrade` 刷新（存量工作台也闭合 F2）；本地修改产生 conflict 且不覆盖。此为对 Child B「skills → seed」决定的有意修订，同步更新 `ownershipFor` 与 ownership 测试。

### RD2. workbench 内引用可达

- 所有 required workbench skill 引用的 references/scripts 随 skill 一起物化；仓库根 `docs/` 的引用改为 skill 内可达路径，或显式标注外部稳定依赖。
- 扫描范围覆盖**物化工作台内全部 markdown**（含根 `AGENTS.md`），不只 skill 目录：`docs/MEMORY-ACCEPTANCE.md` 迁入 `memory-recall/references/`；`docs/HEADLESS-OPS.md` 的运维要点迁入 `skills/jspace-bootstrap/references/headless-ops.md`，AGENTS.md 改指 skill 内路径。
- 引用解析规则与外部依赖豁免格式在 contract test 中定义（见 design §6）。

### RD3. harness-config 全局 scope

- `harness-config` 在 manifest 中声明为 global（非 workbench），记录其安装来源（`~/.agents/skills/harness-config`）、升级方式与依赖；模板 AGENTS 不得默认为已存在。

### RD4. harness lifecycle 能力矩阵

- 建立统一 lifecycle matrix：Pi / Claude Code / Codex / Cursor × session-start retrieval / session-end write-back / 显式 fallback / crash recovery，逐项标注 automated / best-effort / manual / unsupported。
- 标为 automated 的格必须有测试证据（如 `harnessArgv` claude 形状补单测）；产品文档只在 automated 处使用「自动」措辞。
- 「产品文档」范围 = 模板 `AGENTS.md` + bootstrap / harness-config `references/` + `docs/PLATFORMS.md`；`GOAL.md` 是父级对齐物，保留 vision 措辞，仅加指针行。
- 矩阵落位：`skills/jspace-bootstrap/references/harnesses.md`（权威，bundled）+ `docs/PLATFORMS.md` 交叉引用，消除三处散落不一致。

### RD5. 默认 cron skill targets（最小闭环）

- `CronDefinition` 增加可选 skill target（`{ kind: "skill", skill, entrypoint, input }`），`prompt` 保留为显式 custom escape hatch；decode 校验恰好一个。
- **AC17 显式 partial**：仅 `inbox-tidy` 走 skill target（asset-ingest）；`weekly-report` / `memory-consolidate` 保留显式自包含 prompt（随 bundle 版本化）。
- 为缩小与 AC17 字面差距：prose cron 也做轻量静态校验——contract test 断言其 prompt 引用的 skill/resource 名均在 manifest 内。
- skill-target 任务 install/rehearsal 前置校验：required skill 存在且版本兼容（update/conflict/create/stale 即不兼容），失败在执行前报错并给修复动作；`resolveCronPrompt` 编译的 prompt 必须含 `<wbRoot>/skills/<skill>/SKILL.md` 路径，供无头 harness 定位 skill。

### RD6. bootstrap 安全与兼容（AC12 子集）

- **Bootstrap 管道远程安装对齐父设计 §11**：`curl | bash` / `irm | iex` 默认执行改为「下载到临时文件 + 展示来源/校验和 + 用户显式确认后再执行」，不再 `do not stop to ask`。
- 守卫规则做成可机械断言的契约测试（bundle 文本中含指定校验/审批标记，见 design §10）。
- gbrain 支持/已验证版本范围声明于 bootstrap skill 参考（`references/gbrain.md`），bootstrap 的 `gbrain doctor` 升级前健康检查存在；`DistributionManifestV1` 无 gbrain 字段，本 child 不 bump（记录为演进选项）。
- **AC12 敏感信息屏蔽归属**：现有 doctor/logging 已按 R8 实现；Child D 显式记录 owner = 既有实现 + Child F 全链验收，不作为 Child D 交付，但不得在 Child D 新增任何泄密输出。

## 4. Acceptance Criteria

### Release-Blocking

- [ ] **AC-D1 / RD1**：`skills-manifest.json` 定义 required（4）+ global（harness-config）；`jspace init`（编译二进制）后 4 个 required skills 及其 references/scripts 全部存在；manifest、模板 AGENTS、resolver rows、物化结果一致（F2 关闭）。「一致」可测闭包 = 名字集合 + entrypoint 路径 + resolver row 存在 + 物化文件哈希（见 design §6）。
- [ ] **AC-D2 / RD2**：物化工作台内所有 markdown（含根 AGENTS.md）的相对引用可达（contract test 按 design §6 规则解析）；`docs/` 仓库根引用不出现于物化内容（已迁移或显式标注外部）。
- [ ] **AC-D3 / RD4**：Pi / Claude Code / Codex / Cursor lifecycle matrix 逐项标注 automated/best-effort/manual/unsupported；automated 格有测试证据（`harnessArgv` 单测）；产品文档（AGENTS + references + PLATFORMS）仅在 automated 处使用「自动」措辞（F8 关闭）。
- [ ] **AC-D4 / RD5**：skill-target 任务缺 required skill 或版本不兼容（diffBundle 含 update/conflict/create/stale）时 install/rehearsal 在执行前失败并给出修复动作（`workspace upgrade` 可实际修复）；prose cron 静态校验通过；custom prompt escape hatch 保留且可用。
- [ ] **AC-D5 / RD6**：Bootstrap 无默认执行且未经确认的管道远程代码安装（对齐父设计 §11，可机械断言）；gbrain 版本范围 + 升级前健康检查有可复验检查。

### Capability

- [ ] **AC-D6 / RD1/RD3**：`gen-assets` 由 manifest 驱动（或断言一致），skill 物化与 manifest 无漂移；`ownershipFor` skills → managed 且 ownership 测试更新；harness-config 的 global scope、安装/升级来源与依赖在 manifest 与模板中一致声明。
- [ ] **AC-D7 / RD4**：harness argv 能力分级与 lifecycle matrix 一致（claude automated 有测试支撑 / codex·pi best-effort 不回退）。
- [ ] **AC-D8 / RD1/RD5**：存量工作台（旧 bundle 物化、缺 memory-recall/writeback）经 `workspace upgrade` 自动补全 4 skills 且本地修改不被覆盖；`cron run --dry-run` 对 skill-target 任务无副作用。

## 5. Scope

### In Scope

- `SkillsManifest` contract + manifest 驱动的 skill 物化（gen-assets 断言） + init 物化一致性 contract test。
- `ownershipFor` skills seed → managed 修订 + ownership 测试同步（跨 Child B 交付的小改）。
- memory-recall / memory-writeback 纳入 required bundle（F2）。
- workbench 引用可达性修复：`docs/MEMORY-ACCEPTANCE.md`、`docs/HEADLESS-OPS.md` 内容迁入 skill references（单一权威副本）。
- harness lifecycle capability matrix 统一落位 + automated 格测试证据（`harnessArgv` 单测）。
- `CronDefinition` skill target 字段 + `inbox-tidy` skill target + install/rehearsal 前置校验 + prose cron 轻量静态校验。
- harness-config global scope 声明。
- bootstrap 管道安装对齐父设计 §11 + gbrain 版本兼容/健康检查的可复验检查。
- M0：修复基线 order-dependent 失败（`state.test.ts:58`），回到 139 全绿。

### Out of Scope

- asset-ingest journal/补偿与 fault-injection fixtures（Child E）。
- gbrain pending write envelope 完整协议（producer/apply/ack/retry；Child E；父任务 implement.md checklist 已同步修正）。
- AC12 敏感信息屏蔽的代码实现（既有 doctor/logging 已覆盖；Child D 只记录 owner）。
- 真实 scheduler 变更（Child C 已闭环）。
- 真实用户 harness 配置的自动安装/卸载测试（保持手动验证矩阵；`harness-config` skill 自身已在手动流程中验证）。
- 新增常驻运行时、动态插件市场。
- 六平台 release build / CI pipeline 本身（Child F）。
- `cron add` 的 target CLI 面（skill-target cron 现由模板/手编 cron.json 提供；记录为后续演进项）。

## 6. Constraints & Dependencies

- **依赖 Child B 已落地产物**：`DistributionManifestV1` + `ownershipFor` + `materializedRel` + `diffBundle`（`application/workspace/manifest.ts`）、`gen-assets.ts`、`materializeTree`（`cli/embed.ts`）、CommandSpec/use case 框架、`workspace upgrade`。
- **依赖 Child C 已落地产物**：`CronDefinition` / `CronRunInvocation` / `decodeCrons`（`core/contracts/cron.ts`）、`adapters/harness/argv.ts`、结构化 runs/incidents、`execute.ts`。
- **不降低父任务 Product Invariants**：不增加常驻运行时；外部变更默认可检查；本地优先且不泄密；不虚报自动化可靠性（matrix 如实分级）。
- **不修改真实用户环境**：skill 物化、manifest 一致性、引用可达性测试只发生在临时 fixture；harness lifecycle automated 验证不触碰真实 home harness config。
- **跨 child 契约**：`SkillsManifest` 形状、skill target 的 cron 字段、lifecycle matrix 落位、skills→managed ownership 定稿后可被 Child E/F 引用。
- **基线门**：M0 先修复 `state.test.ts` 顺序干扰，此后每个里程碑保持 139 测试全绿。
- **DI 边界**：application 层不得 import `cli/skills.generated.ts`；`SKILLS_MANIFEST` 与 journal/readFile 经 `cli/commands/registry.ts` 注入 application/automation。

## 7. Key Decisions

- **skills ownership seed → managed（2026-08-04 专家 review 定案）**：修订 Child B「skills → seed」决定。未修改 bundled skill 随 upgrade 刷新；本地修改 → conflict 不覆盖。使 `validateSkillTarget` 版本校验（diffBundle update/conflict）可落地、修复动作真实有效、存量工作台闭合 F2。
- **manifest 是唯一 skill 来源**：gen-assets 的 skill SOURCES 由 `SkillsManifest` 驱动或与之一致，禁止 prose + 硬编码双轨漂移。
- **docs 引用内迁**：workbench skill 与根 AGENTS.md 不得引用仓库根 `docs/`；`MEMORY-ACCEPTANCE.md` 迁 `memory-recall/references/`、`HEADLESS-OPS.md` 迁 `skills/jspace-bootstrap/references/headless-ops.md`（单一权威副本，离线可达）。
- **harness-config 仅 global**：不入 workbench bundle；manifest 记录其独立安装/升级来源。
- **lifecycle matrix 如实分级**：automated 必须可验证（测试证据）；产品文档仅在 automated 处使用「自动」；GOAL.md 保留 vision 措辞（父级对齐物）。
- **AC17 最小闭环 = 显式 partial（2026-08-04 用户决策 + review 修正）**：仅 `inbox-tidy` → asset-ingest skill target；`weekly-report` / `memory-consolidate` 保留显式 prompt + 轻量静态校验（引用的 skill/resource ∈ manifest）。父任务 gate 按 partial 对齐。
- **bootstrap 管道安装对齐父设计 §11**：临时文件下载 + 来源/校验和展示 + 用户确认，不做无确认默认执行。
- **`cron add` 不提供 target CLI 面**（本 child 范围外，记录演进）；skill-target cron 由模板/手编 cron.json 提供。
- **旧二进制读新 cron.json**：`target` 加入 v1（向后兼容 decode）；旧 CLI 会以 unknown-field 拒绝新文件——文档注明「先升级 CLI」，不 bump schema。

## 8. 演进与存量

- **存量工作台补全**：已有 JWorkspace 缺 memory-recall/writeback 时，经 `workspace upgrade` 自动 `create` 缺失 managed skill（Child B 交付 + M6 验证）；`init --force` 仅作兜底且提示 clobber 本地修改。
- **新 skill 成长路径**：新增 required skill = 建 `skills/<name>/` 目录 + manifest 条目 + AGENTS prose 列表 + resolver rows 四处同步；contract test 钉住一致性（不约束流程）。
- **manifest 版本演进**：`SkillsManifestV1.version` 在结构变化时 bump；per-skill `version` 为 R6 声明性元数据，运行时版本/陈旧性判断用 diffBundle 内容比对（不引入 per-skill version 文件）。
- **旧 CLI + 新工作台**：cron.json 含 `target` 时旧二进制拒绝并报 unknown-field；文档注明先升 CLI（对齐父任务 R4 的「识别不兼容」方向，错误信息待 Child F 优化为「升级动作」）。

## 9. Planning Status

- 本文件为 Child D 最终规划（2026-08-04）：证据勘察完成；AC17 落地深度决策为最小闭环；专家 review 后 skills ownership 定案 managed；P0/P1 全部落进三件套。
- `prd.md` / `design.md` / `implement.md` 齐备；`implement.jsonl` / `check.jsonl` 已补齐。
- 下一步：用户 review 批准最终规划摘要后 `task.py start`（先 M0 修基线）；父任务保持 planning。
