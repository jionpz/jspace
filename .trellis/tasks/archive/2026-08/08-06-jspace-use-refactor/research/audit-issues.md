# Research: 审计发现的具体问题实例（双重事实源 / 命名漂移 / 生成物-源码边界）

- **Query**: 发现「双重事实源」「命名漂移」「生成物/源码边界不清」的具体实例，附 file:line 证据。
- **Scope**: internal
- **Date**: 2026-08-06

---

## A. 双重事实源（dual source of truth）

### A1. skill 名存在两处事实源：skills-manifest.json 的 name vs SKILL.md frontmatter 的 name

- `skills-manifest.json:5` — `"name": "jspace-bootstrap"`（决定打包键 `skills/jspace-bootstrap/`，gen-assets.ts:27）。
- `skills/jspace-bootstrap/SKILL.md:2` — `name: jspace-bootstrap`（决定 AGENTS.md 生成块与 trigger 路由渲染，skill-frontmatter.ts:96-114）。
- **没有代码强制二者相等**。gen-assets.ts:28-32 只断言 `skills/${manifest.name}/` 目录存在，skill-frontmatter.ts:96-114 读该目录下 SKILL.md 的 frontmatter 但**不校验 `fm.name === manifest.name`**。
- 缓解：`scripts/check-skills.ts` C3（:112-114）会通过「Gov 集合 ⊆ manifest workbench 列表」间接抓到不一致，但那是事后校验，不是生成时约束。
- **改名要求**：两处必须同时改，漏一处会出现「打包键是新名、渲染名是旧名」或反之。

### A2. memory-writeback → jspace-bootstrap 的依赖有两层事实源：manifest 声明 vs 正文路径引用

- 声明层：`skills-manifest.json:27` — `memory-writeback.dependencies: ["asset-ingest", "jspace-bootstrap"]`。
- 内容层（实际引用）：
  - `skills/memory-writeback/SKILL.md:62,78` — `` `../jspace-bootstrap/references/gbrain.md` ``
  - `skills/memory-writeback/references/writeback.md:3,48` — 同上
  - `skills/memory-writeback/references/example-writeback.md:3` — 同上
- **代码从不消费 `dependencies` 字段**（grep 全仓，仅 core/contracts/skills.ts:124 解码时校验 ID_PATTERN；无运行时解析/安装/排序）。所以声明层是"元数据"，内容层才是真实依赖。
- **改名影响**：两处都要改；若只改 manifest 声明，运行时无感知但文档漂移；若只改正文引用，manifest 声明指向不存在的 skill 名。无校验能抓二者不一致。

### A3. lifecycle 能力矩阵的事实源指针分散在 3 处文档

- 权威矩阵本体：`skills/jspace-bootstrap/references/harnesses.md`（「Lifecycle 能力矩阵」节）。
- 指针引用：
  - `docs/PLATFORMS.md:35`（明确声明"不复制整表以避免漂移"）
  - `GOAL.md:57`
  - `templates/workbench/AGENTS.md:185`
  - `cli/lifecycle-and-safety.test.ts:19`（`ASSETS["skills/jspace-bootstrap/references/harnesses.md"]` 断言）
- 4 处指针全部含旧名 `jspace-bootstrap`。改名需全部更新；漏一处即悬空指针。其中 templates/workbench/AGENTS.md:185 是**手写散文**（不在生成块内），gen-assets 不会自动改（见 B2）。

---

## B. 命名漂移（naming drift）

### B1. 运行时硬编码提示串（改名后直接指向不存在的路径）

- `application/workspace/init.ts:117` — `"Next: read AGENTS.md, then follow .jspace/skills/jspace-bootstrap/SKILL.md"`。
- 这是**全仓唯一**生产运行时代码里硬编码的 skill 路径。改名后新 init 的工作台里不存在 `jspace-bootstrap`，此提示会引导用户读一个不存在的文件。

### B2. 模板手写散文里的旧名路径（gen-assets 不覆盖，易漏改）

- `templates/workbench/AGENTS.md:129` — `.jspace/skills/jspace-bootstrap/references/gbrain.md`（Durable Knowledge Routing 表）。
- `templates/workbench/AGENTS.md:158` — Agents 节 skill 名单里的 `jspace-bootstrap`。
- `templates/workbench/AGENTS.md:185` — `.jspace/skills/jspace-bootstrap/references/{harnesses,headless-ops}.md`。
- `templates/workbench/README.md:36` — `.jspace/skills/jspace-bootstrap/SKILL.md`。
- 这些都在 **JSPACE 块内、但生成子块外**（AGENTS.md 三个）或 seed 模板（README.md）。gen-assets 只重渲染 TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV 两个子块（skill-frontmatter.ts:110-111），其余散文原样保留 → 改名后若只重跑 gen-assets，这三处旧名会残留并随 upgrade 物化进既有工作台。

### B3. 测试 fixture 的旧名（改名后失配或过时）

- 必红（真实生成物耦合）：`application/workspace/workspace.test.ts:339,369-374,396,400,420,426-427`；`cli/lifecycle-and-safety.test.ts:19,38,52`；`scripts/skill-frontmatter.test.ts:11,15,25`。
- 仍绿但过时（自包含 fixture）：`application/workspace/manifest.test.ts:23,54,66,71-73,83,91,102-105,111,118,122`；`core/contracts/skills.test.ts:24`。
- 不改会留下"旧名只活在测试里"的漂移。

### B4. skill 目录文件名与内容旧名

- `skills/jspace-bootstrap/references/example-bootstrap.md:1` — 标题含 `jspace-bootstrap`；文件名本身是 `example-bootstrap.md`（被 SKILL.md:68 与 manifest 引用）。改名若重命名文件，`SKILL.md:68`、`cli/assets.generated.ts`、`manifest.generated.ts` 的引用同步改。
- `skills/jspace-bootstrap/agents/openai.yaml:2-4` — `display_name: "jspace bootstrap"`、`default_prompt: "Use $jspace-bootstrap to …"`。
- 概念词"bootstrap"散落：`GOAL.md:56,83`、`skills/asset-ingest/references/gbrain-write.md:58,61`、`cli/lifecycle-and-safety.test.ts:2,37,46`（测试名）、`cli/embed.ts:91`（注释）。若新名不含 "bootstrap"，这些措辞需逐条评估（是否仍指"首次配置阶段"）。

### B5. harness-config 对旧名的反向路由

- `skills/harness-config/SKILL.md:3,22` — `Do NOT use for 单个 JSpace 工作台首配(→jspace-bootstrap)`。
- `skills/harness-config/references/harnesses.md:277` — 「与 jspace-bootstrap 底稿的差异」。
- harness-config 是**机器级全局 skill**（不随工作台物化，skills-manifest.json:30-37），用户可能已装到 `~/.agents/skills/`。改名后旧安装副本里的路由指向旧名；需在模板更新（+ 用户侧自装副本自行更新）。

---

## C. 生成物/源码边界（generated-vs-source boundary）

### C1. 边界总体清晰，但有一个"半自动"缺口

- 清晰部分：gen-assets 拥有 `cli/assets.generated.ts` / `cli/manifest.generated.ts` / `cli/skills.generated.ts` + AGENTS.md 两个生成子块；`scripts/check-skills.ts` C4（:120-141）强制"重跑 gen-assets → git diff 干净"，把生成物边界钉死。
- 缺口：AGENTS.md **同一文件内一半生成、一半手写**。生成子块（:117,192）自动更新，但同文件手写散文（:129,158,185）引用同一批 skill 路径却不会自动更新 —— 生成器管不到它们，也没有测试覆盖它们与 manifest 的一致性（check-skills C2/C3 只查生成块）。改名时最容易被"只重跑 gen-assets"骗过。

### C2. 跨 skill `../` 引用无自动化可达性校验

- `cli/assets-reachability.test.ts:31-45` `resolve()` 只处理 `skills/` 前缀与 `references/`/`scripts/` 相对引用，**对 `../<skill>/references/x.md` 返回 null**（:44）→ memory-writeback 的 5 处 `../jspace-bootstrap/...` 引用不受该测试保护。
- 唯一守护是 `scripts/check-skills.ts` C1（:46-56，解析 `..\/[\w-]+\/references\/...` 并断言磁盘存在）。这是 dev 侧脚本（非 CI 测试），改名漏改时靠它兜底。

### C3. 生成物里的"内容即键"双重存在

- `cli/assets.generated.ts` 同时包含：① bundle 键 `skills/jspace-bootstrap/*`（:11-17）；② 其它资产内容里**嵌着**旧名字符串 —— `skills/memory-writeback/SKILL.md` 等（:33-35）与 `templates/workbench/AGENTS.md`（:8）、`README.md`（:9）。改名后即使重跑 gen-assets，若源文件没改干净，生成物会继续携带旧名 —— 生成物只是镜像，**漂移的根源在源文件**（B2/B4 的清单）。
- 同样，`cli/manifest.generated.ts:15-21` 的旧路径条目若源目录已改而没重跑，会残留不存在的路径（C4 抓）。

### C4. bundle_version 与内容变更解耦

- `cli/manifest.generated.ts:7` — `bundle_version` 来自 `VERSION`（cli/version.generated.ts，由 scripts/gen-version.ts 从 git tag 生成）。改名产生大量 sha256 变化但**不自动升版本**；版本 bump 依赖发布流程（git tag）。这本身不是缺陷，但改名发布时若忘了升 tag，旧版 CLI 的 update 比较会认为"同版本无更新"。
