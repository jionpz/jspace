# Research: 冗余审计汇总（三档分类 + 清理优先级）

- **Query**: 汇总全仓冗余审计全部发现，按「可安全删 / 需确认 / 保留」三档分类，给出清理建议优先级。
- **Scope**: internal（全仓只读审计）
- **Date**: 2026-08-06

## 总体结论

- 上轮重构（jspace-bootstrap → jspace-use）**命名与路径漂移已彻底收敛**：全仓 `jspace-bootstrap` 仅存于测试 fixture（明确豁免），文档/模板/技能/生成物零残留。
- C1-C4 全绿、`bunx tsc --noEmit` 通过、gen-assets 重跑无 diff —— **生成物与源码无漂移**。
- 模块级无死文件；生产代码无「为已删除布局服务的过渡代码」（legacy 相关全是通用机制或回归测试）。
- 真实冗余集中在：**2 个死导出、1 处 spec 文档过时、7 个未填充 spec 模板、少量重复 helper、几个措辞/元数据漂移**。结构性冗余轻微，主要清理价值在文档与局部收敛。

---

## A 档：可安全删（改动面小、行为零变化、拿得稳）

| # | 项 | 证据 | 说明 |
|---|---|---|---|
| A1 | 死导出 `readAgentsFile` | `application/workspace/agents-block.ts:40-46` | 全仓零引用（含测试） |
| A2 | 死导出 `writeAgentsFile` | `application/workspace/agents-block.ts:48-51` | 全仓零引用（含测试） |
| A3 | `.trellis/spec/frontend/` 整目录 | 7 个文件全部「To fill」占位 | 项目无前端；纯 Trellis 未填充模板 |

> 优先级高：A1/A2 删函数 + 导出；A3 删目录。三者都不触发 gen-assets/C1 变化（A1/A2 无资产；A3 在 .trellis，gen-assets 不扫）。

## B 档：需确认（改动可做但需决策/拿不准）

| # | 项 | 证据 | 决策点 |
|---|---|---|---|
| B1 | `sha256Of` 同名单双定义 | `application/workspace/manifest.ts:11` vs `cli/update.ts:56` | 统一为共享 hash helper（string 包装 + bytes 底）还是保留？低严重度 |
| B2 | `safeReadFile` 逐字重复 | `application/workspace/workspace.ts:18-24` 与 `journal.ts:21-25` | 同层同目录，收敛为一个 helper 很稳；cli 层 `readFileOrNull`/`readExisting` 是否一并归并需评估分层 |
| B3 | 无意义导出（仅本文件用） | `readHub`/`readLocal`（workbench-state.ts:55,57）、`agentsRel`（agents-block.ts:53）、`applyOps`（scheduler-service.ts:59）、`formatJson`（workbench-state.ts:75）、`export { CONFIG_DIR }`（init.ts:21） | 去掉 export 关键字即可，行为零变化；是否值得逐个清理 |
| B4 | `openIncidents` 仅测试消费 | `application/automation/incidents.ts:92-94`（生产用内联 filter） | 保留为语义 helper，或移入测试？ |
| B5 | `openai.yaml` 无消费方资产 | `skills/jspace-use/agents/openai.yaml`（manifest.generated.ts:16 物化为 seed） | 随包物化但全仓无人引用；删文件 + 重跑 gen-assets 即从 bundle 移除。确认无未来 OpenAI 系计划后可删 |
| B6 | package.json version 漂移 | `package.json:3`=1.0.8 vs `cli/version.generated.ts`/git tag=1.0.9 | bump 到 1.0.9 或声明非事实源 |
| B7 | `REGISTRY_FILE` 旧名别名 | `core/contracts/files.ts:6`（仅 state.ts:16 用） | 内联 HUB_FILE 删别名（v3-era 命名收敛） |
| B8 | `filehubRoot` 别名 | `application/automation/status.ts:21` | 仅给 cron.ts 一个短名；改引用点可删 |
| B9 | `.trellis/spec/backend/database-guidelines.md` | 29 行 N/A 占位标 Active | 删除或并入 quality-guidelines 一条 |
| B10 | 降级日志路径语义 | `skills/asset-ingest/references/batch.md:57` vs `execute.ts:124-136` | 确认「skill 侧写工作台日志槽位」与「CLI 守卫不覆盖降级路径」是有意分工 |

## C 档：保留（必要通用机制 / 回归测试 / 生成物镜像）

| 类别 | 项 | 证据 |
|---|---|---|
| 通用机制 | init legacy-layout guard | `init.ts:53-62`（fail-fast 拒绝，非兼容层） |
| 通用机制 | remove/stale 通用分支 | `manifest.ts:165-176`、`workspace.ts:287-296` |
| 通用机制 | hub schema 迁移机制（当前空表） | `core/registry/migrations.ts:17,36-59` |
| 通用机制 | scheduler legacy untagged 守卫 | `darwin.ts:29,82`、`linux.ts:54,64` |
| 通用机制 | doctor orphan skill 诊断 | `doctor.ts:91-124` |
| 解码兼容 | UPGRADE_ACTIONS "delete" 别名 | `core/contracts/upgrade.ts:22`（journal 恢复关键） |
| 回归测试 | legacy 迁移测试（jspace-bootstrap fixture） | `workspace.test.ts:355-438`、`doctor.test.ts:119-143`（文件头豁免声明） |
| 分层复制 | `parseJsonFile`/`parseHubJson`、`isWithin` 双版本 | 层级不同，合理 |
| 生成物镜像 | assets/manifest/skills.generated.ts + AGENTS.md 生成块 | 有 gen-assets 单向生成关系 + C4 钉死 |

## 需要修改的漂移（文档/措辞，非删减）

| 项 | 证据 | 修法 |
|---|---|---|
| spec 所有权描述过时 | `quality-guidelines.md:25`「currently all managed」+ 缺 migrate | 改为 seed/user/managed 三态 + 补 `migrate` |
| spec「legacy cron/update」 | `backend/index.md:7`、`directory-structure.md:18,37` | 删 legacy 措辞 |
| `.gitattributes:13` 错误 spec 路径 | 引用 `.trellis/spec/cli/backend/...`（不存在） | 改 `.trellis/spec/backend/directory-structure.md` |
| 测试数陈旧 | `quality-guidelines.md:24`（339 → 实 361） | 更新数字 |
| cron uninstall 文案 | `cli/commands/cron.ts:96`「remove installed launchd agents」 | 泛化为 platform scheduler tasks |
| state.ts 注释 | `state.ts:2-3`「cli facade is deleted after migration」 | 更新为已完成态 |
| `manifest.ts:173`/`workspace.ts:288`「legacy seed copy」reason | 通用 remove 语义 | 可泛化为「recorded copy no longer in bundle」（措辞可选） |

## 清理建议优先级

1. **P0（顺手、零风险、价值明确）**：A1+A2 死导出、A3 未填充 spec 目录；同步修 `.gitattributes:13` 断链路径、package.json version（B6）。
2. **P1（文档漂移修正）**：quality-guidelines.md:25 所有权描述 + 缺 migrate、spec「legacy cron/update」措辞、测试数、cron.ts:96 文案、state.ts 注释。
3. **P2（收敛类，需小决策）**：B1 sha256Of、B2 safeReadFile（先收敛 workspace.ts/journal.ts 两处）、B3 无意义导出、B4 openIncidents、B7 REGISTRY_FILE、B8 filehubRoot。
4. **P3（需产品决策）**：B5 openai.yaml 是否随包保留、B9 database-guidelines、B10 降级日志路径语义确认。
5. **本地（非仓库）**：`bin/` 残留编译产物与 `jspace-1.0.8.bak`（约 630MB，git 已忽略，手动清理即可）。

## 关键 caveat（供主 agent 决策）

- 任何对 `skills/`、`templates/workbench/`、skill SKILL.md 的改动都必须重跑 `bun run scripts/gen-assets.ts`（C4 会拦）；删 `openai.yaml` 属此列。
- 删 `.trellis/spec/frontend/` 不影响 gen-assets（它不扫 .trellis）。
- 所有「可安全删」均不触碰 ownership/upgrade/journal 机制；不动任何 skill 名或打包清单。
