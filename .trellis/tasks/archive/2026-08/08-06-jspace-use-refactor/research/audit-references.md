# Research: 全量引用清单 — `jspace-bootstrap` / `bootstrap`

- **Query**: 全仓（排除 node_modules/.git/.trellis/archive）所有 `jspace-bootstrap` 或 `bootstrap` 的产品级引用，按「文件:行 — 作用」列出并分子系统。
- **Scope**: internal
- **Date**: 2026-08-06

## 说明

- `jspace-bootstrap` = 官方工作台 skill 名（产品标识）。改名涉及所有列出的引用。
- `bootstrap`（小写概念词）= 指"全新工作台首次配置阶段"，不绑定 skill 名；改名后这些措辞可能仍需微调但无硬依赖。单独列出。
- `.trellis/.template-hashes.json` 中的 `trellis-spec-bootstrap` 是 Trellis 自身打包 skill，与本产品 skill 无关（已排除）。

---

## 1. 源码逻辑（production code）

| 文件:行 | 作用 |
|---|---|
| `application/workspace/init.ts:117` | **唯一硬编码 skill 路径的运行时代码**。`jspace init` 成功提示 `"Next: read AGENTS.md, then follow .jspace/skills/jspace-bootstrap/SKILL.md"`。改名后此提示指向不存在的路径，必须更新。 |
| `cli/embed.ts:90-96` | 无硬编码名。`materializeTree` 遍历 `SKILLS_MANIFEST.workbench`，逐个断言 `skills/${s.name}/` 已嵌入；第 91 行注释 `"not just bootstrap+asset-ingest"` 为概念措辞。物化路径 `skills/` → `.jspace/skills/`（第 102 行）为前缀泛化。 |
| `application/automation/definitions.ts:64-83` | `compileSkillTarget` 经 `SKILLS_MANIFEST.workbench.find((s) => s.name === target.skill)` + `skillRoot`/`skillRel` 泛化解析，无硬编码 skill 名。 |
| `application/automation/execute.ts:128-130` | 硬编码的是 `asset-ingest`（inbox batch guard），**不是** jspace-bootstrap。 |
| `cli/commands/cron.ts:76-90` | `validateSkillTargets` 走 `SKILLS_MANIFEST`，泛化。 |

## 2. 生成物（generated output — 由 scripts/gen-assets.ts 生成）

| 文件:行 | 作用 |
|---|---|
| `cli/assets.generated.ts:11-17` | 嵌入 `skills/jspace-bootstrap/` 全部 7 个文件：`SKILL.md`、`agents/openai.yaml`、`references/{example-bootstrap,gbrain,harnesses,headless-ops,registry}.md`。 |
| `cli/assets.generated.ts:8-9` | 嵌入 `templates/workbench/AGENTS.md` + `README.md`（内容内含 jspace-bootstrap 引用，见模板节）。 |
| `cli/assets.generated.ts:33-35` | 嵌入 `skills/memory-writeback/*`（SKILL.md、example-writeback.md、writeback.md），正文含 `../jspace-bootstrap/references/gbrain.md` 字符串。 |
| `cli/manifest.generated.ts:15-21` | `BUNDLE_MANIFEST` 中 `skills/jspace-bootstrap/*` 7 条，`ownership: "seed"` + sha256。 |
| `cli/skills.generated.ts:8` | `SKILLS_MANIFEST.workbench` 第一条 `name: "jspace-bootstrap"`。 |
| `cli/skills.generated.ts:36` | `memory-writeback.dependencies` 含 `"jspace-bootstrap"`。 |

## 3. 模板（templates/workbench/ — 随 init/upgrade 物化）

| 文件:行 | 作用 |
|---|---|
| `templates/workbench/AGENTS.md:117` | **生成块**（TRELLIS-SKILL-GOV）——Skill Governance 列表首行 `- \`jspace-bootstrap\` - **首次配置**…`。由 gen-assets 从 SKILL.md frontmatter 渲染。 |
| `templates/workbench/AGENTS.md:129` | **手写散文**（块外）：Durable Knowledge Routing 表 `Persistent facts and asset pointers | gbrain（bootstrap 后接线；见 .jspace/skills/jspace-bootstrap/references/gbrain.md）`。 |
| `templates/workbench/AGENTS.md:158` | **手写散文**：Agents 节 `…4 个 skill:\`jspace-bootstrap\` / \`asset-ingest\` / \`memory-recall\` / \`memory-writeback\`…`。 |
| `templates/workbench/AGENTS.md:185` | **手写散文**：Scheduled Tasks (cron) 节两处 `.jspace/skills/jspace-bootstrap/references/{harnesses,headless-ops}.md`。 |
| `templates/workbench/AGENTS.md:192` | **生成块**（TRELLIS-BRAIN-OPS）——Brain operations 行 `- **jspace-bootstrap**: initialize jspace | …`。由 gen-assets 从 frontmatter `triggers` 渲染。 |
| `templates/workbench/README.md:36` | **手写**：`2. 首次使用按 .jspace/skills/jspace-bootstrap/SKILL.md 配置 gbrain 与所选 AI harness。` |

## 4. 文档（dev 仓库侧）

| 文件:行 | 作用 |
|---|---|
| `AGENTS.md:11` | 仓库结构：`skills/jspace-bootstrap/`：首次配置技能（源码；物化进 `.jspace/skills/jspace-bootstrap/`）。 |
| `AGENTS.md:44` | 开发工作流：`改 templates/workbench/ 和 skills/jspace-bootstrap/，不要通过修改已生成的工作台来反推模板。` |
| `AGENTS.md:50` | `hub.json` schema 见 `templates/workbench/.jspace/hub.json` 和 `skills/jspace-bootstrap/references/registry.md`。 |
| `README.md:79` | 目录结构：`skills/jspace-bootstrap/` - 首次配置技能（源码；物化进 `.jspace/skills/`）。 |
| `GOAL.md:57` | 生命周期矩阵指针：工作台 `.jspace/skills/jspace-bootstrap/references/harnesses.md`。 |
| `GOAL.md:96` | headless-ops 指针：`skills/jspace-bootstrap/references/headless-ops.md`（开放问题 #3 闭合记录）。 |
| `docs/PLATFORMS.md:35` | 权威矩阵指针：`skills/jspace-bootstrap/references/harnesses.md`「Lifecycle 能力矩阵」节；明确"不复制整表以避免漂移"。 |
| `.trellis/workspace/jionpz/journal-1.md:121,137` | 开发者日志（历史记录），提及 jspace-bootstrap 归档与提交。非产品引用。 |

## 5. 测试（test code）

| 文件:行 | 作用 |
|---|---|
| `core/contracts/skills.test.ts:24` | fixture `entry("jspace-bootstrap", "workbench")`。仅当合法 id 使用，改名后不破坏逻辑（见 audit-test-contract.md）。 |
| `application/workspace/manifest.test.ts:23,54,66,71,73,83,91,102,105,111,118,122` | 以 `skills/jspace-bootstrap/SKILL.md` 作为 seed 示例路径 / fixture / 断言键。断言 `skillRel("jspace-bootstrap")` 等映射函数。 |
| `application/workspace/workspace.test.ts:339,340,342,345,353-354,363,369-374,381-382,391,396,398-400,407-408,416,420,426-427` | 直接耦合**真实 BUNDLE_MANIFEST + ASSETS** 的 legacy 迁移测试，断言 `.jspace/skills/jspace-bootstrap/` 与根 `skills/jspace-bootstrap/` 的 create/remove/stale 动作。改名后断言键将失配（见 audit-test-contract.md）。 |
| `cli/lifecycle-and-safety.test.ts:19,38,52` | 直接以 `ASSETS["skills/jspace-bootstrap/{references/harnesses.md,SKILL.md,references/gbrain.md}"]` 为键做内容断言（lifecycle 矩阵、pipe-install 守卫、gbrain 版本范围）。改名后键失配。 |
| `scripts/skill-frontmatter.test.ts:11,15,25` | 读 `skills/jspace-bootstrap/SKILL.md`，断言 `fm.name === "jspace-bootstrap"`。改名后失配。 |
| `cli/assets-reachability.test.ts:41-42,48,54,60` | 泛化（经 `SKILLS_MANIFEST.workbench`），无硬编码名；但 `resolve()` 不解析跨 skill 的 `../` 引用（见 audit-generation.md）。 |

## 6. 校验脚本（dev-side validation）

| 文件:行 | 作用 |
|---|---|
| `scripts/check-skills.ts` C1-C4 | 全泛化，无硬编码 jspace-bootstrap。C1 会把 memory-writeback 里 `../jspace-bootstrap/references/gbrain.md` 解析到磁盘 `skills/jspace-bootstrap/`；改名后若不更新引用 → C1 报 broken reference。C4 重跑 gen-assets 并断言 git diff 干净 → 改名后未重跑 gen-assets 则 C4 红。 |
| `cli/assets-reachability.test.ts` | 见上；对 manifest/bundle 一致性（RD1）与 harness-config global 范围有泛化断言。 |

## 7. 依赖声明（dependency declarations）

| 文件:行 | 作用 |
|---|---|
| `skills-manifest.json:5` | workbench 条目 `"name": "jspace-bootstrap"`（打包单源）。 |
| `skills-manifest.json:27` | `memory-writeback.dependencies: ["asset-ingest", "jspace-bootstrap"]`。 |
| `cli/skills.generated.ts:8,36` | 上述两处生成的镜像。 |

## 8. Skill 内部（skills/ 源码树）

| 文件:行 | 作用 |
|---|---|
| `skills/jspace-bootstrap/SKILL.md:2` | frontmatter `name: jspace-bootstrap`（AGENTS.md 生成块与 trigger 路由的事实源）。 |
| `skills/jspace-bootstrap/SKILL.md:16` | 标题 `# jspace-bootstrap — 工作台首次配置`。 |
| `skills/jspace-bootstrap/agents/openai.yaml:2-4` | `display_name: "jspace bootstrap"`、`default_prompt: "Use $jspace-bootstrap to configure this fresh JSpace workbench end to end."` |
| `skills/jspace-bootstrap/references/example-bootstrap.md:1` | 标题 `# Golden run — jspace-bootstrap 全新工作台首次配置(Phase 0→5)`。 |
| `skills/memory-writeback/SKILL.md:62,78` | 跨 skill 引用 `` `../jspace-bootstrap/references/gbrain.md` ``（纪律源）。 |
| `skills/memory-writeback/references/example-writeback.md:3` | 同上引用。 |
| `skills/memory-writeback/references/writeback.md:3,48` | 同上引用（"纪律源 = …（引用不复制）"）。 |
| `skills/harness-config/SKILL.md:3,22` | 路由反向指引：`Do NOT use for 单个 JSpace 工作台首配(→jspace-bootstrap)`。 |
| `skills/harness-config/references/harnesses.md:277` | 「交叉核对说明(与 jspace-bootstrap 底稿的差异)」。 |

## 9. 概念性 `bootstrap`（不绑定 skill 名，改名后可保留/微调）

| 文件:行 | 措辞 |
|---|---|
| `GOAL.md:56` | 「三者由工作台规则与 bootstrap skill 保障」 |
| `GOAL.md:83` | M2 里程碑「+ bootstrap 文件中心引导」 |
| `skills/asset-ingest/references/gbrain-write.md:58,61` | 「bootstrap(未 serve)阶段校验」「bootstrap 不因 embedding 缺失而失败」 |
| `skills/harness-config/references/example-harness-config.md:73` | 「missing 由 bootstrap 或其他流程补」 |
| `skills/harness-config/references/harnesses.md:274` | 「写入由 bootstrap 或其他流程负责」 |
| `cli/assets-reachability.test.ts:6` | 注释「bootstrap-safety wording checks」 |
| `cli/lifecycle-and-safety.test.ts:2,37,46` | 测试名「bootstrap pipe installs are guarded」——检查的是 SKILL.md 内容（pipe-install 守卫），改名后测试仍应存在，仅措辞可能改名 |
| `cli/embed.ts:91` | 注释「not just bootstrap+asset-ingest」 |
| `.trellis/.template-hashes.json:121-125` | `trellis-spec-bootstrap`（Trellis 自身 skill，**与本产品无关**，排除） |

## 汇总

- **运行时硬编码**：仅 `init.ts:117` 一处。
- **生成物**（改名后必须重跑 gen-assets 再提交）：assets.generated.ts（12 处 jspace-bootstrap 出现）、manifest.generated.ts（7 条）、skills.generated.ts（2 处）。
- **模板手写散文**（gen-assets 不会自动改，需手工编辑）：templates/workbench/AGENTS.md:129,158,185 + README.md:36。
- **测试耦合**（改名后失配）：workspace.test.ts、lifecycle-and-safety.test.ts、skill-frontmatter.test.ts。
- **依赖声明**：skills-manifest.json:5,27（内容引用是 5 处 memory-writeback + harness-config 3 处）。
