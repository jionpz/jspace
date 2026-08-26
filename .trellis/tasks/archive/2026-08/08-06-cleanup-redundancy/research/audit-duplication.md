# Research: 双重事实源 / 重复实现（DRY）审计

- **Query**: 同一信息在多处维护且无单向生成关系；明显重复的函数/逻辑；上轮重构（jspace-bootstrap → jspace-use）遗留的散落硬编码验证。
- **Scope**: internal
- **Date**: 2026-08-06

## 结论一：上轮命名重构已收敛（验证通过）

- 全仓 `jspace-bootstrap` 仅剩两处**测试 fixture**（`application/workspace/workspace.test.ts:5-8,359-436` 与 `application/workspace/doctor.test.ts:119-143`），且测试文件头明确标注「approved git grep jspace-bootstrap exemption」，作为旧布局升级的回归测试故意保留。
- 文档 / 模板 / 技能内无 `jspace-bootstrap` 残留；`skills/memory-writeback/*` 的跨 skill 引用已全部改为 `../jspace-use/...`（SKILL.md:62,78、writeback.md:3,48、example-writeback.md:3）。
- `init.ts:117` 提示串已指向 `.jspace/skills/jspace-use/SKILL.md`。
- 所有权/路径映射/diff/upgrade/journal/cron skill-target 全部按 manifest 前缀泛化，对 skill 名零硬编码（`application/workspace/manifest.ts:25-57`）。

## 结论二：重复实现（DRY 违反）

### 2.1 `sha256Of` 同名单函数定义两处

| 位置 | 签名 | 用途 |
|---|---|---|
| `application/workspace/manifest.ts:11` | `sha256Of(content: string): string` | 字符串内容哈希（manifest/diff/journal） |
| `cli/update.ts:56` | `sha256Of(buf: Uint8Array): string` | 二进制字节哈希（自更新校验和） |

- 同名、仅输入类型不同，`createHash("sha256").update(...).digest("hex")` 同构。可统一为一个以 `Uint8Array`/`Buffer` 为底、字符串包装的共享 helper（如 `core/shared/hash.ts`），或至少改名区分。
- **判断**：需确认（低严重度；两处均自包含、行为正确。统一需跨层放共享 kernel，改动面小）。

### 2.2 `safeReadFile`（读文件或 null）四处重复

| 位置 | 实现 |
|---|---|
| `application/workspace/workspace.ts:18-24` | `function safeReadFile` |
| `application/workspace/journal.ts:21-25` | `function safeReadFile`（**与上一条逐字相同**，同层同目录） |
| `cli/commands/helpers.ts:14-18` | `export const readFileOrNull` |
| `cli/embed.ts:65-71` | `function readExisting` |

- `workspace.ts` 与 `journal.ts` 同在 `application/workspace/`，逐字重复——**这是最明确的 DRY 违反**，可直接收敛为一个共享 helper。
- cli 层的 `readFileOrNull`/`readExisting` 因分层（cli 不 import application 私有函数）与 embed 语义（target-relative）略有差异，属分层内合理复制，但仍可考虑归并。
- **判断**：`workspace.ts` + `journal.ts` 的两处可安全收敛（同层）；cli 层两处需确认。

### 2.3 JSON 解析容错 helper 两处

- `application/workspace/workspace.ts:40-48` `parseHubJson(raw: string | null)`
- `adapters/fs/workbench-state.ts:24-36` `parseJsonFile(file, code, pathLabel)`
- 用途不同（一个解析字符串、一个读文件并产出 ContractIssue），属不同抽象层级。**保留**，仅记录。

### 2.4 `filehubRoot` 别名声明的冗余

- `application/automation/status.ts:21` `export const filehubRoot = resolveFilehubRoot;`——仅给 `cli/commands/cron.ts:12,138` 一个更短的名字。低价值别名。**需确认**（改引用点即可删）。

### 2.5 其余已核实的「重复」均不成立

- `isWithin`：`application/registry/helpers.ts:7-10`（node:path 版本）与 `core/registry/inspect.ts:27-30`（node:path 版本）——两个版本逻辑相同。一个在 application 层（registry 用），一个在 core 层（inspect 用）。分层原因，**保留**并记录。

## 结论三：路径常量 / 列表硬编码核查（无双重事实源）

- `.jspace` 前缀：`CONFIG_DIR = ".jspace"`（core/contracts/files.ts:4）单一来源，各处经它拼接。
- `.jspace-logs`（连字符）：`PENDING_LOG_DIR = ".jspace-logs"`（application/pending/envelope.ts:17）单一来源；CLI 与 skills 文档引用一致（grep 已核）。
- 默认 cron 数「3 个」：`templates/workbench/.jspace/cron.json` 定义 3 条（inbox-tidy / weekly-report / memory-consolidate），`docs/PLATFORMS.md:77` 的「3 默认任务」一致。
- harness 白名单：`HARNESSES`（core/contracts/cron.ts）单源；`docs/PLATFORMS.md` 表格与 `cli/commands/cron.ts:26` 的 help 文案一致。
- 官方 skill 列表：`skills-manifest.json` 是打包单源（gen-assets.ts:15-19 注释 + 实现），`cli/skills.generated.ts` 是其生成镜像——**存在单向生成关系，不是双重事实源**。

## 判定汇总

- **需确认**：`sha256Of` 双定义（manifest.ts:11 vs update.ts:56）；`safeReadFile` 在 workspace.ts:18 与 journal.ts:21 的逐字重复（可安全收敛）；`filehubRoot` 别名（status.ts:21）。
- **保留**：`parseJsonFile`/`parseHubJson`（层级不同）、`isWithin` 双版本（层级不同）、全部生成物镜像（有单向生成关系）。
- **已收敛**：命名重构遗留的散落硬编码（见结论一）。
