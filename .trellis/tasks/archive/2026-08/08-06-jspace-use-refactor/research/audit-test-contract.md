# Research: 与 bootstrap 名相关的测试断言与期望结构

- **Query**: core/contracts/skills.test.ts、cli/lifecycle-and-safety.test.ts、scripts/skill-frontmatter.test.ts、application/workspace/workspace.test.ts、application/workspace/manifest.test.ts 中与 bootstrap 相关的断言、mock 路径、期望工作台结构。
- **Scope**: internal
- **Date**: 2026-08-06

## 分类：改名后哪些会红、哪些仍绿

| 测试文件 | 耦合方式 | 改名后状态 |
|---|---|---|
| `core/contracts/skills.test.ts` | fixture 名字（任意合法 id） | 仍绿（名字仅用于 decoder 验证） |
| `application/workspace/manifest.test.ts` | 示例路径字符串 + 映射断言 | 仍绿（但 fixture 名过时，命名漂移） |
| `application/workspace/workspace.test.ts` | **真实 BUNDLE_MANIFEST + ASSETS** | **红**（断言键是旧 rel） |
| `cli/lifecycle-and-safety.test.ts` | **ASSETS 键直接寻址** | **红**（键不存在 → undefined） |
| `scripts/skill-frontmatter.test.ts` | **读真实 SKILL.md + 断言 fm.name** | **红**（name 断言失败） |

---

## 1. core/contracts/skills.test.ts

- `skills.test.ts:24` — `validManifest()` 的 workbench fixture：`entry("jspace-bootstrap", "workbench")`。
- 用途：`decodeSkillsManifest` 纯解码测试的合法输入。名字只要求匹配 `ID_PATTERN`（core/contracts/skills.ts:75-77）。改名成 `jspace-use` 后依然是合法 id，**测试逻辑不依赖这个名字**。
- 若改名，仅建议同步 fixture 以免误导；不红。

## 2. application/workspace/manifest.test.ts

fixture manifest（:15-26）含 `{ path: "skills/jspace-bootstrap/SKILL.md", sha256: sha256Of("new-skill"), ownership: "seed" }`（:23）。相关断言：

- `:54` — `ownershipFor("skills/jspace-bootstrap/SKILL.md")` → `"seed"`（前缀规则，不依赖具体名）。
- `:66` — `materializedRel("skills/jspace-bootstrap/SKILL.md")` → `.jspace/skills/jspace-bootstrap/SKILL.md`。
- `:71-73` — `skillRel("jspace-bootstrap")` → `.jspace/skills/jspace-bootstrap`；`materializedRel(...)` 用 `skillRel("jspace-bootstrap")` 拼接。
- `:83,91` — diff fixture：磁盘 `.jspace/skills/jspace-bootstrap/SKILL.md: "new-skill"` → `no-op`。
- `:102-105,111` — recorded base = `.jspace/skills/jspace-bootstrap/SKILL.md` 旧哈希 → bundle 前进 → `update`。
- `:118,122` — 本地改过 → `skip`。

这些全是**自包含 fixture**（不走真实生成物），名字只是示例路径。改名后断言仍成立（映射是纯函数）；但 fixture 里旧名会过时 → 建议同步（命名漂移，见 audit-issues.md）。

## 3. application/workspace/workspace.test.ts（真实生成物耦合，改名必红）

顶部 import 真实生成物（:20-21）：`BUNDLE_MANIFEST` + `ASSETS`。相关用例：

- `:336-347` "modified workbench skill is never overwritten"：`skillRel = ".jspace/skills/jspace-bootstrap/SKILL.md"`（:339）→ 断言 diff 为 `skip`（:343）、upgrade 后内容保留（:345）。改名后真实 bundle 里没有该 rel，`find` 返回 undefined → `e?.action` 为 undefined ≠ "skip" → 红。
- `:349-376` "legacy workbench: unmodified root skills/ copy is removed"：模拟旧布局根 `skills/jspace-bootstrap/SKILL.md`（:353-354）+ journal 记录旧 rel（:363）→ 断言 `.jspace/skills/jspace-bootstrap/SKILL.md` = `create`（:369）、根 `skills/jspace-bootstrap/SKILL.md` = `remove`（:370）、upgrade 后 `.jspace/skills/jspace-bootstrap/SKILL.md` 存在（:373）。改名后新 rel 是 `.jspace/skills/jspace-use/SKILL.md`，旧断言键失配 → 红。
- `:378-402` "modified root skills/ copy is kept as stale"：同理断言根旧 rel `stale`（:396）、`.jspace/skills/jspace-bootstrap/SKILL.md` 落盘（:400）→ 红。
- `:404-429` "remove during upgrade is backed up and restored by --rollback"：同样用旧名（:407-408,416,420,426-427）→ 红。

**关键点**：这些测试不仅验证机制，还模拟"旧版工作台升级到新版"——正是改名场景要覆盖的迁移路径。改名后应把 fixture 里的旧 rel 改成 `jspace-use`，且**建议保留一组"旧名 → 新名"的迁移断言**（legacy 清理），因为真实存量工作台里就存在旧名。

## 4. cli/lifecycle-and-safety.test.ts（ASSETS 键直接寻址，改名必红）

- `:19-25` — `ASSETS["skills/jspace-bootstrap/references/harnesses.md"]`，断言存在 + 含 "Lifecycle 能力矩阵" + 四个 grade。改名后 key 不存在 → `expect(matrix).toBeDefined()` 失败。
- `:37-49` — `ASSETS["skills/jspace-bootstrap/SKILL.md"]`，扫 `bash|iex` 管道行并断言 8 行窗口内有"不默认执行/显式确认/下载到临时文件/核验"守卫（AC-D5）。改名后 key 不存在 → 红。
- `:51-57` — `ASSETS["skills/jspace-bootstrap/references/gbrain.md"]`，断言含 "版本兼容"/"gbrain doctor --json"/"升级前健康检查"。改名后红。

这些是**内容级**守卫（skill 内容必须包含安全措辞），改名后应把寻址键更新为新名，断言内容本身不变。

## 5. scripts/skill-frontmatter.test.ts（读真实文件 + name 断言，改名必红）

- `:11` — `const SKILL = join(ROOT, "skills", "jspace-bootstrap", "SKILL.md")`。
- `:15` — `expect(fm?.name).toBe("jspace-bootstrap")`。
- `:25` — CRLF 用例同样 `expect(fm?.name).toBe("jspace-bootstrap")`。

改名后路径不存在（readFileSync 抛错）→ 红；即使路径改了，name 断言也红。

## 6. cli/assets-reachability.test.ts（泛化，改名不红但需注意）

- `:47-51` — `ASSETS[skills/${s.name}/SKILL.md]` 存在（泛化自 SKILLS_MANIFEST）→ 新名自动通过。
- `:53-63` — harness-config 不进 bundle（泛化）→ 不受影响。
- `:65-78` — bundle 内引用可达性。`resolve()`（:31-45）**不解析跨 skill 的 `../` 引用**（返回 null）→ memory-writeback 的 `../jspace-bootstrap/references/gbrain.md` 漏改时此测试**不会**抓到；check-skills C1 才会（见 audit-generation.md）。

## 其它相关

- `cli/init.test.ts`：无 bootstrap 引用（已 grep 确认）。
- `scripts/check-skills.ts`：C2/C3 断言 AGENTS.md 生成块与 frontmatter/manifest 一致（泛化），改名后只要 frontmatter+manifest+生成块同步就不会红；C1 会因 memory-writeback 的 `../jspace-bootstrap/` 引用漏改而红；C4 因生成物未重跑而红。

## 期望的工作台结构（测试隐含契约）

- 官方 skill 物化到 `.jspace/skills/<name>/`，根 `skills/` 归用户（manifest.test.ts:66、workspace.test.ts:373-374 等）。
- AGENTS.md 以 JSPACE 块承载、块外用户内容不碰（manifest.test.ts:110,121,170 等）。
- seed 未修改随升级刷新、本地修改 skip、旧布局 remove、用户改动 stale（manifest.test.ts:111,122；workspace.test.ts:343,369-374,396）。
- 这些结构契约**与名字无关**，改名后依然成立；需要改的只是 fixture 里的旧名 rel。
