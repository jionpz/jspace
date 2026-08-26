# P5: 跨 harness 一致性 + 文档 + CI 锁定

## Goal

最后一层**防漂移**：`capabilities.yaml` 成为支持集唯一事实源后，用脚本把文档与 CI 也绑到它上面——`scripts/check-harness-consistency.ts` 断言代码/模板/文档里的 harness 列表**与 capabilities.yaml 一致（含字段值级）**；`harnesses.md` 全景表 machine-render（数据源 = P1 加入的 `lifecycle` 字段）；创建 `harness-{claude,grok,opencode,cursor}.md`；支持集文档同步（父任务 D6：Cursor 保留、Grok/OpenCode 入）。

父任务：`08-09-multi-harness-support`。依赖：P1–P4 全。

## Confirmed Facts（已核实）

- `skills/jspace-use/references/harnesses.md:7/55-72/79-96` 现为手维能力矩阵 + Lifecycle 矩阵（**含 Cursor 行**，D6 保留）
- `docs/PLATFORMS.md:21-35`「Harness 能力矩阵」手维（cron argv 表）+ 引用 harnesses.md
- `core/contracts/cron.ts:27` `HARNESSES` 是运行时 enum 契约（P1 R6 双向锁 + 本任务文件级锁）
- `templates/workbench/AGENTS.md` harness 声明句含 Cursor（机器生成块外，gen-assets 不渲染）
- `skills/jspace-use/SKILL.md:162` 引用区现指「harnesses.md」（拆分子文件后需更新）
- P1 后：capabilities 含 lifecycle 分级字段、skills_projection 拆 workbench/user、codex 标 documented:false、pi 标 via/source:extension、**cursor 会话 harness 条目（D6 保留，无 headless）**

## Requirements

- **R1** 新增 `scripts/check-harness-consistency.ts`（断言集，全部字段值级而非仅名单级）：
  1. 扫 `skills/jspace-use/references/harness-*.md`：文件集 = capabilities keys 中 `documented: true` 子集（codex 豁免——防「加了 harness 忘建文档」）
  2. **`core/contracts/cron.ts` HARNESSES == capabilities keys（双向）**；`templates/workbench/.jspace/cron.json` 各 harness 值 ∈ keys
  3. 扫 `adapters/harness/*.ts` 文件名 ∈ capabilities keys
  4. 每个 harness 的 `workbench_projection` 目标在模板有对应 materialize 目录；`via_pi_mcp_adapter` 字面量同存 capabilities.pi 与 harness-pi.md；grok/opencode 每个 sessions 事件有对应 hook/plugin 分支
  5. 断言 `skills/jspace-use/SKILL.md` 引用区覆盖每个 harness-*.md
  6. grep `templates/` + `skills/jspace-use/references/` 中手写 harness 列表（**显示名↔key 映射表**：Claude Code=claude、Grok Build=grok、OpenCode=opencode、Pi=pi、Cursor=cursor、Codex=codex），断言 = 全支持集（claude/grok/opencode/pi/cursor + codex）；**扫描限定 jspace 域，显式排除 `skills/harness-config/`（机器级接线文档，含 hermes 等非 jspace 支持集 harness）**
- **R2** `skills/jspace-use/references/harnesses.md` 改造成 machine-render：全景表 = capabilities 字段表（含 lifecycle 分级，**数据源是 P1 加入的 `lifecycle` 字段**），由 capabilities.yaml render；手写部分缩到「架构说明」一段；render 产物入库 + 断言「入库产物 == 现 render 结果」（防手改漂移）
- **R2b** 创建 `harness-claude.md` / `harness-grok.md` / `harness-opencode.md` / `harness-cursor.md`（内容来源：P1 现状接线 / P2 Grok 验证素材与 notes / P3 OpenCode 验证素材 / 现状 harnesses.md:55-72 Cursor 节；harness-pi.md 已由 P4 创建）
- **R2c** 支持集文档同步（**父任务 D6：Cursor 保留、补入 Grok/OpenCode**）：`templates/workbench/AGENTS.md` harness 声明、`harnesses.md` 矩阵行、`docs/PLATFORMS.md`——Cursor 行保留，Grok/OpenCode 行加入，支持集声明统一为新集合
- **R3** `docs/PLATFORMS.md`「Cron Harness」表 render 自 capabilities.yaml（或由脚本断言一致）
- **R4** `verify.yml` 加 `bun run scripts/check-harness-consistency.ts`（tsc/bun test 之后）
- **R5** references 索引统一：`skills/jspace-use/SKILL.md:162` 引用区更新为覆盖全部 harness-*.md（P4 的 references 动作并入本任务）

## Acceptance Criteria

- [ ] AC1 `bun run scripts/check-harness-consistency.ts` 本地通过（6 条断言全过）
- [ ] AC2 手工制造漂移 → 脚本红，断言生效：① 某手写列表漏 Grok；② harness-pi.md 与 capabilities 的 mcp 字段不一致；③ cron.ts HARNESSES 与 keys 不一致；④ 加 harness 忘建 harness-*.md
- [ ] AC3 CI verify.yml 含该检查
- [ ] AC4 harnesses.md 全景表 = capabilities.yaml render 结果（含 lifecycle 列）；Cursor 行保留、Grok/OpenCode 行已入
- [ ] AC5 harness-claude/grok/opencode/cursor.md 四份 + harness-pi.md 落地；SKILL.md 引用区覆盖全部 5 份 harness-*.md
- [ ] AC6 模板 AGENTS.md / PLATFORMS.md 的 harness 声明已同步为新支持集（Cursor 保留 + Grok/OpenCode 入，D6）
- [ ] AC7 `bunx tsc --noEmit` + `bun test` 全过；gen-assets 重跑后 asset freshness 通过

## Out of Scope

- 新增 harness（本任务只保证一致性，不引入第 5 个）
- 改写 lifecycle 分级语义（分级标准保留，值来自 P1 capabilities.lifecycle）
