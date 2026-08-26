# Research: gen-assets 生成链路契约

- **Query**: scripts/gen-assets.ts 决定嵌入哪些 skill 文件、产出什么；改名 jspace-bootstrap → jspace-use 后重跑 gen-assets 的影响面。
- **Scope**: internal
- **Date**: 2026-08-06

## 入口与单源

`scripts/gen-assets.ts`（全文 107 行）。关键契约：

1. **skills-manifest.json 是"哪些 skill 进包"的唯一事实源**（gen-assets.ts:15-19 注释 + 实现）。
   - `decodeSkillsManifest`（core/contracts/skills.ts:40-54）解析 `skills-manifest.json`；失败即 throw。
   - `skillDirs = skillsManifest.workbench.map((s) => `skills/${s.name}`)`（:27）。
   - 逐个 `statSync(join(repoRoot, d))` 断言目录存在，缺失即 throw（:28-32）。
2. **SOURCES = ["templates/workbench", "templates/filehub", ...skillDirs]**（:33）。
   - 注意：`templates/filehub` 会被扫进 assets map（键前缀 `templates/filehub/`），但 `materializeTree`/`materializedRel` 都不物化它（filehub 由 `filehub init` 按需生成，见 audit-ownership.md）。
3. **walk()**（:45-60）：
   - 排序遍历保证可复现（APFS vs ext4 readdir 顺序差异，:46-48 注释）。
   - 跳过 `__pycache__` / `.git` / `node_modules`，`.pyc`/`.pyo`/`.DS_Store`（:42-43,49,54）。
   - 每个文件键 = `baseRel/rel`（相对 repoRoot 的 / 分隔路径），值 = UTF-8 原文（:55-57）。
4. **renderAgentsBlocks**（:39，实现 scripts/skill-frontmatter.ts:96-114）：
   - 对每个 workbench skill 读 `skills/<name>/SKILL.md`，`parseSkillFrontmatter` 取 `name`/`description`/`triggers`。
   - 重渲染 templates/workbench/AGENTS.md 两个生成块：TRELLIS-BRAIN-OPS（triggers，:68-73）+ TRELLIS-SKILL-GOV（name+description，:75-79）。
   - **写回模板文件本身**（:112），同时同一份 bytes 被下方 walk 嵌入 → 模板落盘与嵌入 bytes 恒一致（:37-38 注释）。
   - 若 `skills/<name>/SKILL.md` 无 frontmatter 或缺 name/description → throw（:101-104）。

## 产出三件套

5. **cli/assets.generated.ts**（:65-75）——`ASSETS: Record<string, string>`，bundle key → 内容。运行时由 `cli/embed.ts:97-121` 物化。
6. **cli/manifest.generated.ts**（:78-96）——`BUNDLE_MANIFEST: DistributionManifestV1`：
   - 每条 `{ path, sha256: sha256Of(v), ownership: ownershipFor(k) }`。
   - `bundle_version = VERSION`（import 自 cli/version.generated.ts，:11；由 scripts/gen-version.ts 从 git tag 生成）。
   - `ownershipFor` 按路径前缀泛化：`skills/` → "seed"（application/workspace/manifest.ts:25-30）。
7. **cli/skills.generated.ts**（:100-106）——`SKILLS_MANIFEST` 原样 JSON 嵌入（含 name/version/scope/dependencies/entrypoints）。

## 校验契约（为什么改名后必须重跑）

- `scripts/check-skills.ts`：
  - C1（:29-62）：解析所有 `skills/<dir>/**` 里 `` `references/x.md` `` 与 `` `../<skill>/references/x.md` `` 引用并断言磁盘存在。**memory-writeback 的 `../jspace-bootstrap/references/gbrain.md` 会被解析到 `skills/jspace-bootstrap/`**；改名后不更新这 5 处引用 → C1 红。
  - C2/C3（:64-118）：Brain operations / Skill Governance 块与 frontmatter + manifest 集合一致。改名后 frontmatter name / manifest name 未同步 → C2/C3 红。
  - C4（:120-141）：重跑 `bun run scripts/gen-assets.ts` 并断言 4 个文件（assets.generated.ts / manifest.generated.ts / skills.generated.ts / templates/workbench/AGENTS.md）git diff 干净。**改名后未重跑 gen-assets 则 C4 红**。
- `cli/assets-reachability.test.ts:47-51`：`ASSETS[skills/${s.name}/SKILL.md]` 必须存在 → 改名后新目录必须存在且被嵌。
  - 注意其 `resolve()`（:31-45）**不解析跨 skill 的 `../` 引用**（返回 null）；所以 memory-writeback 的 `../jspace-bootstrap/...` 引用若漏改，此测试不会抓，只有 check-skills C1 会抓。

## 改名 jspace-bootstrap → jspace-use 后的影响面

| 变化 | 细节 |
|---|---|
| **嵌入清单键** | `skills/jspace-bootstrap/*`（7 键）→ `skills/jspace-use/*`（同 7 文件）。旧键消失、新键出现；assets.generated.ts 整体 diff。 |
| **AGENTS.md 模板** | 生成块（GOV 行 117、BRAIN 行 192）自动随 frontmatter 改名重渲染；但**手写散文 129/158/185 与 README.md:36 不在生成块内，gen-assets 不会改**——需手工编辑模板（见 audit-issues.md）。 |
| **manifest 哈希** | SKILL.md 的 `name:`/triggers 变化 → 内容变 → 该文件 sha256 变；references/*.md 若只改目录名而内容不变 → 文件内容不变，但 **path 变了所以 manifest 条目整体替换**。memory-writeback 3 个文件若更新 `../jspace-bootstrap/` 引用 → 内容变 → sha256 变。 |
| **ownership** | `ownershipFor("skills/jspace-use/...")` → "seed"（前缀泛化，无名字逻辑）→ 不受影响。 |
| **bundle_version** | 由 VERSION（git tag）决定，非 gen-assets 决定；改名属产物变更，应按发布流程升 tag（gen-version.ts:9-16）。 |
| **SKILLS_MANIFEST** | name 改 → skills.generated.ts 同步；若改 skills-manifest.json 的 dependencies（jspace-bootstrap → jspace-use）→ 同步。 |
| **既有工作台升级** | 见 audit-ownership.md：旧 `.jspace/skills/jspace-bootstrap/` 在 journal 有记录且未改动 → upgrade 走 `remove`；有本地改动 → `stale`（保留）。新 `jspace-use` → `create`。 |
| **校验** | 重跑后需 check-skills C1-C4 + assets-reachability 全绿；漏改任一 `../jspace-bootstrap/` 引用 C1 即红。 |

## 结论

gen-assets 的嵌入清单完全由 `skills-manifest.json`（名字）+ `skills/<name>/` 磁盘树（内容）驱动，**对 skill 名本身零硬编码**——它只按 manifest 里的名字拼路径。改名 = 改 skills-manifest.json 的 name（+dependencies）+ 重命名磁盘目录 + 更新所有 frontmatter/正文内的旧名引用，然后重跑 `bun run scripts/gen-assets.ts`，让三件套生成物 + AGENTS.md 模板同步刷新。C4 保证"重跑后无 diff"；漏跑或漏改会被 C1/C4 拦住。
