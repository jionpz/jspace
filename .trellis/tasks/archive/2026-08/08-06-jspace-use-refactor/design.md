# jspace-use 指南化架构重构 — design

> 技术设计。需求/验收见 `prd.md`;审计证据见 `research/`(audit-references / audit-generation / audit-ownership / audit-test-contract / audit-issues)。
> 本设计只解决「bootstrap → jspace-use 指南化 + 全仓一致性」,不新增 PRD Out of Scope 以外的能力。

---

## 1. 现状架构(带证据)

### 1.1 引用拓扑

`jspace-bootstrap` 是唯一官方 workbench 首配 skill。全仓原始出现 89 处(实测,含生成物镜像),覆盖 7 个子系统;去除生成物重复后为 23 个独立文件。引用拓扑:

| 子系统 | 文件:行 | 作用 |
|---|---|---|
| **源码逻辑** | `application/workspace/init.ts:117` | **全仓唯一运行时硬编码 skill 路径** — `jspace init` 成功提示串指向 `.jspace/skills/jspace-bootstrap/SKILL.md` |
| 源码逻辑(泛化) | `cli/embed.ts:90-102`、`application/automation/definitions.ts:64-83`、`cli/commands/cron.ts:76-90` | 全按 `SKILLS_MANIFEST.workbench` + 路径前缀泛化,零硬编码 |
| 生成物 | `cli/assets.generated.ts`(12 处)、`cli/manifest.generated.ts`(7 条)、`cli/skills.generated.ts`(2 处) | 由 `scripts/gen-assets.ts` 从源生成,改名后必须重跑 |
| 模板 | `templates/workbench/AGENTS.md:117,192`(生成块,自动更新)、`:129,158,185`(手写散文,需手工)、`README.md:36`(手写) | 生成块由 gen-assets 渲染;手写散文不会自动变 |
| 文档 | `AGENTS.md:11,44,50`、`README.md:79`、`GOAL.md:57,96`、`docs/PLATFORMS.md:35` | 指针引用 |
| 测试 | `workspace.test.ts`、`lifecycle-and-safety.test.ts`、`skill-frontmatter.test.ts`(必红);`manifest.test.ts`、`skills.test.ts`(fixture 过时) | 见 1.3 |
| 依赖声明 | `skills-manifest.json:5`(打包键)、`:27`(memory-writeback 依赖) | 见 1.2 |

### 1.2 两层「名字事实源」

skill 名有**两个各自独立的事实源**,生成时无强约束:

- **A 源**:`skills-manifest.json:5` `"name": "jspace-bootstrap"` — 决定打包键 `skills/jspace-bootstrap/`(gen-assets.ts:27)。
- **B 源**:`skills/jspace-bootstrap/SKILL.md:2` frontmatter `name:` — 决定 AGENTS.md 两个生成块(TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV)与 gbrain 路由关键词。

`gen-assets.ts:28-32` 只断言目录存在;`skill-frontmatter.ts:96-114` 不校验 `fm.name === manifest.name`。改名漏改任一源,即出现「打包键新名 / 渲染名旧名」分裂,只能靠 `check-skills` C3 事后兜底。**→ 设计决策 D3 修复。**

同理,`memory-writeback` 对 bootstrap 的依赖也有两层:`skills-manifest.json:27` 声明(死元数据,代码不消费)vs 正文 5 处 `../jspace-bootstrap/references/gbrain.md`(真实引用)。两者无校验强制一致。

### 1.3 生成链路与升级链路

**生成**(gen-assets,107 行):`skills-manifest.json`(哪些 skill 进包)→ 拼 `skills/<name>/` 磁盘树 + `templates/workbench` + `templates/filehub` → walk 全部文件 → 产出三件套 `assets.generated.ts` / `manifest.generated.ts` / `skills.generated.ts` + 回写 AGENTS.md 两个生成块。对 skill 名**零硬编码**,改名 = 改单源 + 重跑。

**升级/所有权**(manifest.ts + workspace.ts + journal.ts):`ownershipFor` 纯路径前缀(seed/user/managed/machine),`skillRel`/`materializedRel` 前缀泛化,`diffBundle` 按 manifest 逐条比对 journal + 磁盘哈希。**对 skill 名零硬编码** — 唯一运行时提示串在 `init.ts:117`。

### 1.4 审计确认的问题清单(evidence 见 research/audit-issues.md)

| # | 问题 | 证据 |
|---|---|---|
| A1 | skill 名双重事实源,无生成时约束 | skills-manifest.json:5 vs SKILL.md:2 |
| A2 | 依赖声明层 vs 内容引用层不一致,无校验 | skills-manifest.json:27 vs memory-writeback/** 5 处 |
| B1 | 运行时硬编码提示串(改名后指向不存在路径) | init.ts:117 |
| B2 | 模板手写散文里的旧名路径,gen-assets 不覆盖 | AGENTS.md:129,158,185;README.md:36 |
| B3 | 测试 fixture 旧名(3 必红 + 2 过时) | workspace.test.ts / lifecycle-and-safety.test.ts / skill-frontmatter.test.ts |
| B4 | skill 文件内旧名(SKILL.md 标题、openai.yaml、example-bootstrap.md) | 见 audit-references §8 |
| B5 | harness-config 反向路由指向旧名(机器级 skill,用户已装副本) | harness-config/SKILL.md:3,22;harnesses.md:277 |
| C1 | AGENTS.md 同文件「一半生成一半手写」,改名最易漏 | AGENTS.md:117,192(生成)vs 129,158,185(手写) |
| C2 | 跨 skill `../` 引用无自动化可达性校验(仅 check-skills C1 兜底) | assets-reachability.test.ts:44 resolve() 返回 null |

### 1.5 关键利好

- 升级/所有权/journal/cron 全部 manifest 泛化 → **改名对升级机制零改动**。
- 模板 cron.json 只引用 `asset-ingest`(inbox-tidy),**无 bootstrap skill target 存量**。
- gen-assets 对 skill 名零硬编码 → **改名 = 改源 + 重跑,生成物自动收敛**。

---

## 2. 目标架构

### 2.1 定位

`jspace-use` 取代 `jspace-bootstrap`:**工作台内长期使用指南**,不是一次性安装脚本。覆盖「如何开始 / 如何路由 / 如何用记忆与资产 / 如何维护诊断 / 边界与排障」,首次启用只是其中一章。

层级职责(指南与其它事实源的分工):

| 主题 | 权威事实源 | jspace-use 的角色 |
|---|---|---|
| 工作台布局 / 所有权 / 升级边界 | `AGENTS.md` JSPACE 块 | **指引**,不复制 — 用「位置即所有权」一句话 + 指向块 |
| 域 / 资源路由规则 | `AGENTS.md` Daily Work Intake / Registry Access | 指引,不复制 |
| gbrain CLI 面 / embedding / 写回纪律 | `references/gbrain.md` | 深入章节(引用) |
| registry schema / drift | `references/registry.md` | 深入章节(引用) |
| harness 接线 / lifecycle 能力矩阵 | `references/harnesses.md` | 深入章节(引用) |
| 无头运维(账号/配额/failover) | `references/headless-ops.md` | 深入章节(引用) |
| 首次启用 golden run | `references/example-*.md` | 首次启用章节指向 |
| CLI 命令细节 | `jspace` CLI + `docs/PLATFORMS.md` | 速查精简,详查命令 `--help` |
| skill 边界 | 各 skill 的 `SKILL.md` frontmatter | SKILL.md 内「何时用别的 skill」路由表 |

### 2.2 `jspace-use/SKILL.md` 目标结构

```
---
name: jspace-use
description: <「使用与维护工作台」定位,含首次启用 + 日常使用触发语,保留边界反向指引 harness-config/asset-ingest>
triggers: <原 bootstrap triggers + 日常使用/维护/诊断关键词(见 §3.3)>
---

# jspace-use — JSpace 工作台使用指南

七章(对应 PRD R2 七主题,一级章编号 1-7):
1. 工作台模型       — 控制平面 + 记忆层 + 资产层;位置即所有权;升级边界
2. 首次启用         — 前置(harness 已装)→ gbrain + embedding → registry health → filehub → harness 接线 → smoke
                    (原 Phase 0-5 压缩为步骤骨架,细节指向 references;golden run → example)
3. 日常会话路由     — 进工作台后按 AGENTS.md 路由;记忆注入起点(memory-recall / gbrain 注入)
4. gbrain 记忆      — 写回纪律 / 召回 / 指针 / 周快照 → gbrain.md
5. 资源与资产       — hub.json 增删查 / filehub 协议 / 项目三步 → registry.md + asset-ingest
6. CLI 维护与诊断   — doctor / workspace diff·upgrade / cron check / ingest·pending(速查 + 指向 --help)
7. 边界与故障排查   — 本指南 vs AGENTS.md vs CLI vs registry 文档;何时用别的 skill(路由表);registry broken / gbrain missing / upgrade 异常 / 自检命令
```

### 2.2b `jspace-use` 触发关键词建议(triggers 扩展)

保留原 bootstrap triggers(initialize jspace / setup jspace / configure jspace / first-use jspace / workbench broken / registry broken / gbrain missing / wire gbrain / fresh environment),并扩展日常使用/维护/诊断:

- `how to use jspace` / `工作台怎么用` / `怎么开始`
- `维护工作台` / `upgrade jspace` / `workspace upgrade`
- `诊断工作台` / `jspace doctor` / `cron check` / `故障排查`
- 保留边界:`Do NOT use for` → harness-config(机器级)/ asset-ingest(入库)/ memory-recall(召回)/ memory-writeback(写回)

> 说明:triggers 是 gbrain resolver 路由关键词来源;新增词需同步进 AGENTS.md Brain operations 生成块(gen-assets 渲染)。

原则:**SKILL.md 主体是「读的指南」,references 是「深入细则」** — 首次启用流程不再以「端到端执行脚本」面目出现,而是指南的一章。

### 2.3 references 重组

| 现有 | 处置 |
|---|---|
| `references/gbrain.md` | 保留(记忆细则,长期) |
| `references/registry.md` | 保留(资源细则) |
| `references/harnesses.md` | 保留(接线 + lifecycle 矩阵) |
| `references/headless-ops.md` | 保留(无头运维) |
| `references/example-bootstrap.md` | 重写为 `example-*`(首次启用 golden run),文件名与正文更新 |
| — | 可选新增 `references/diagnostics.md`(排障 runbook,如现有内容不足以支撑「故障排查」章) |

---

## 3. 关键设计决策

### D1. 目录与命名(无兼容别名)

- `skills/jspace-bootstrap/` → **`skills/jspace-use/`**(含 SKILL.md / agents/ / references/ 子树)。
- 不保留 `jspace-bootstrap` alias、迁移分支、deprecated 文案(PRD R5 / AC2)。
- 全仓产品级引用改指向 `jspace-use`;**仅历史任务 / git 历史 / 归档 research 允许残留**(PRD AC9)。

### D2. 两个 name 事实源同步改

- `skills-manifest.json:5` → `"name": "jspace-use"`。
- `skills/jspace-use/SKILL.md:2` → `name: jspace-use`。
- **顺序**:先改 B 源(frontmatter)→ 重命名目录 → 改 A 源(manifest)→ 重跑 gen-assets。A/B 任意一刻不同步是中间态,由 D3 加固在生成时拦截。

### D3. 单一事实源加固(修复 A1)

在 `scripts/skill-frontmatter.ts` 的 `renderAgentsBlocks` 内(已持有 manifest name 参数与解析出的 `fm`),对每个 workbench skill 校验 `parseSkillFrontmatter(SKILL.md).name === manifestEntry.name`,不一致即 `throw`。该落点让校验恰在被守卫的「AGENTS.md 渲染名 vs manifest 名」不变量处,且避免在 gen-assets 前置循环重复读 frontmatter;导出该校验函数供 `check-skills` C3 复用,使「生成时硬约束 + 事后兜底」单一化。把「skill 名两源一致性」从事后兜底提升为生成时强约束,直接服务 PRD R3「让生成/校验链路能发现漂移」。

### D4. 升级/存量迁移(零机制改动)

升级机制全 manifest 泛化,**不写任何迁移代码**。改名后对存量工作台,`diffBundle` 的通用分支自动处理:

- 旧 `.jspace/skills/jspace-bootstrap/`(journal 有记录):未改动 → `remove`(含备份);本地改过 → `stale`(保留)。
- 新 `.jspace/skills/jspace-use/` → `create`。
- 根 legacy `skills/jspace-bootstrap/`(更早布局)同样走 remove/stale。

这是**通用机制对路径变化的自然行为**,不是为 bootstrap 写的兼容层,符合 PRD R5(不提供兼容通道)。`workspace.test.ts:349-429` 的 legacy 迁移测试更新为「旧名 → 新名清理」断言,作为对真实存量工作台的回归保护。

### D5. 依赖与跨 skill 引用

- `skills-manifest.json:27` `memory-writeback.dependencies` → `["asset-ingest", "jspace-use"]`(声明层)。
- memory-writeback 正文 5 处 `../jspace-bootstrap/references/gbrain.md` → `../jspace-use/references/gbrain.md`(内容层,真实引用)。
- 两层都改,消除 A2 漂移。
- harness-config 反向路由 `→jspace-bootstrap` → `→jspace-use`(SKILL.md:3,22 + references/harnesses.md:277)。**注意**:harness-config 是机器级 skill,用户可能已自装到 `~/.agents/skills/` — 源码更新后,用户侧旧副本需自行 `harness-config` 刷新(模板更新,非代码迁移)。

### D6. 概念词 `bootstrap` 策略

区分「产品 skill 名 `jspace-bootstrap`(硬约束:零残留)」vs「概念词 bootstrap = 首次配置阶段(软约束:视上下文)」:

- **硬**:所有 `jspace-bootstrap` → `jspace-use`。
- **硬(活体产品指代)**:`GOAL.md:56`「三者由工作台规则与 bootstrap skill 保障」中的「bootstrap skill」是本次改名 skill 的**现役产品指代**(紧邻 :57 引用其 `references/harnesses.md` 路径),不是纯概念 —— 改写为「工作台规则与 jspace-use 指南保障」(保留指南实体指代)。
- **软(概念阶段)**:`GOAL.md:83`(M2 历史里程碑「+ bootstrap 文件中心引导」,已完成描述)、asset-ingest gbrain-write.md / 测试名 / 注释中的「bootstrap 阶段」→ 改写成「首次启用(first-use)」;**不出现 `jspace-bootstrap` 产品名**。
- **Phase G7 终检**追加对「bootstrap skill」「bootstrap 指南」等非精确串的人工/正则复查,封堵 AC9 精确串 grep 盲区。

### D7. init 提示串

`init.ts:117` → `.jspace/skills/jspace-use/SKILL.md`(同步措辞:「read AGENTS.md, then follow the jspace-use guide」)。

### D8. 模板手写散文(gen-assets 不覆盖,B2)

手工更新 `templates/workbench/AGENTS.md:129,158,185` + `README.md:36`:
- L129 `.jspace/skills/jspace-bootstrap/references/gbrain.md` → `jspace-use/...`,措辞「bootstrap 后接线」→「首次启用接线后」。
- L158 skill 名单 `jspace-bootstrap` → `jspace-use`。
- L185 两处 references 路径 `jspace-bootstrap/` → `jspace-use/`。
- README.md:36 `.jspace/skills/jspace-bootstrap/SKILL.md` → `jspace-use/SKILL.md`,措辞指向「使用指南」。

### D9. 测试契约更新

- **必红 3 个**:
  - `application/workspace/workspace.test.ts` — 真实 bundle 耦合 rel 更新为 `jspace-use`;**保留并改造 legacy 迁移测试**,断言「旧名 rel → remove / 新名 rel → create」(真实存量工作台路径)。**该测试保留旧名 `jspace-bootstrap` 字面量是有意为之(存量迁移回归),属 G7 残留终检的豁免项**。
  - `cli/lifecycle-and-safety.test.ts:19,38,52` — `ASSETS` 寻址键 `skills/jspace-bootstrap/*` → `skills/jspace-use/*`;断言内容(pipeline 守卫 / gbrain 版本 / lifecycle 矩阵)不变。
  - `scripts/skill-frontmatter.test.ts:11,15,25` — 路径 + `fm.name === "jspace-use"`。
- **过时 2 个**(不红但同步避免漂移):`application/workspace/manifest.test.ts` fixture 旧名 rel;`core/contracts/skills.test.ts:24` fixture 名。
- **泛化不受影响**:`assets-reachability.test.ts`(经 manifest,自动通过)。

### D10. bundle_version

`cli/manifest.generated.ts` 的 `bundle_version` 来自 git tag(gen-version.ts),**改名不自动升版本**。本次代码改动不 bump;发布时按流程升 tag(独立步骤,记录在 implement 收尾,不在本任务代码内)。

---

## 4. 数据流(改名后)

### 4.1 生成流

```
skills-manifest.json(name=jspace-use) ─┐
skills/jspace-use/SKILL.md(name=jspace-use, 新 description/triggers) ─┤
skills/memory-writeback/** (引用 ../jspace-use/references/gbrain.md) ─┤
templates/workbench/AGENTS.md(手写散文已改) ─┤
                                       ▼
                            bun run scripts/gen-assets.ts
                                       │  (D3: 校验 fm.name === manifest.name)
                                       ▼
   assets.generated.ts(键 jspace-use/*) + manifest.generated.ts(7 条 jspace-use, sha256 更新)
   + skills.generated.ts(name=jspace-use) + AGENTS.md 生成块重渲染
                                       │
                                       ▼
                            check-skills C1-C4 + assets-reachability 全绿
```

### 4.2 存量工作台升级流

```
新 bundle(skills/jspace-use/*) vs 存量工作台(journal 记录 skills/jspace-bootstrap/*)
   │
   ├─ 旧 .jspace/skills/jspace-bootstrap/* : 未改动→remove(备份+journal) / 改过→stale
   ├─ 新 .jspace/skills/jspace-use/*       : create
   ├─ AGENTS.md                            : JSPACE 块整体替换(块外不动)
   └─ 根 legacy skills/jspace-bootstrap/*  : 未改动→remove / 改过→stale
```

**重要前提**:以上 remove/stale 收敛**仅对 materialized journal 有记录的 rel 生效**(manifest.ts:165-176 只遍历 `Object.keys(deps.recorded)`)。对「磁盘存在但从未写入 journal」的旧副本——pre-journal 版本 init 物化的工作台、或更早 root `skills/` 布局残留——diffBundle 不会产出任何 DiffEntry,upgrade 不删、diff 不报,成为**静默孤儿**。处理:

- 不新增迁移代码(PRD R5 无兼容层):该孤儿不指向新 bundle 任何文件,不影响新工作台运行。
- 在 `jspace workspace diff` 报告与 `jspace doctor` 增加一条诊断:检测到 `.jspace/skills/` 或根 `skills/` 下存在**不在当前 manifest 且无 journal 记录**的官方 skill 名(如 `jspace-bootstrap`),提示用户手动删除或忽略。该诊断是通用 orphan 检测,不是 bootstrap 专属兼容通道。

---

## 5. 兼容性与演进

- **无兼容别名 / 迁移层 / 弃用通道**:彻底移除 `jspace-bootstrap` 产品名(PRD R5)。
- **升级契约不变**:seed 未改动随升级刷新、用户改动保留、user 数据(hub/cron)永不覆盖 — 全部由既有所有权模型承载,本任务不改。
- **cron 契约不变**:模板 cron 只引用 asset-ingest,无 bootstrap target;编译校验对未知 skill 名报错(定义即约束)。存量 cron.json 若指向 jspace-bootstrap → 改后编译报 `unknown skill`,需用户手动改 target.skill(数据层,工具不替你改)。
- **机器级 harness-config 刷新**:harness-config 是 global skill,用户可能已自装到 `~/.agents/skills/`。源码反向路由更新后,既有机器旧副本仍指向 jspace-bootstrap → **发布动作项**:release note 标注「既有机器级 harness-config 需重新安装刷新」;并在 harness-config 源内加一条自我诊断(检测到引用已删除的 jspace-bootstrap 即提示重装)。
- **发布(硬门禁)**:功能落地后**必须**升 git tag(≥1.0.9)+ `bun run scripts/gen-version.ts` 发布,且 `jspace update` → `workspace upgrade` 收敛演练通过后才算交付。`bundle_version` 由 tag 决定(gen-version.ts),改名不自动升版本 —— 发布是本次改名的收尾组成部分,不是可选后续。未发布前既有工作台无法通过 update 收敛,「无旧名残留」承诺只对源码成立。

## 6. 风险与回退

| 风险 | 缓解 |
|---|---|
| 模板手写散文漏改 → 旧名随 upgrade 物化进新工作台 | implement 设专项检查;AC9 全仓 grep 兜底 |
| 跨 skill `../jspace-use/...` 引用漏改 → check-skills C1 红 | C1 覆盖该 pattern;implement 验证阶段必跑 |
| 存量工作台用户改过旧 skill → `stale` 保留,旧名留在用户侧 | 属预期行为(用户内容不覆盖);文档明确升级报告 |
| gen-assets 改名后 C4 红(未重跑) | implement 步骤强制「改源→重跑→校验」顺序 |

## 7. Out of scope(对齐 PRD)

- 旧工作台 `jspace-bootstrap` 兼容 alias / 迁移通道。
- gbrain 封装 / 数据模型改动。
- 新运行时 / 事件网关 / 自主代理。
- 与命名及指南架构无关的业务重构。
