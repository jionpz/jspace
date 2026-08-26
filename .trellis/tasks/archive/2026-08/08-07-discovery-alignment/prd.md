# 发现层对齐：CLAUDE.md 指针 + skill 物化到官方发现路径

> 子任务 A of `08-06-workbench-context-wiring`。父任务持有问题全貌与跨子任务验收。
> **依赖**：无。可与子任务 B（注入层）并行。
> **被依赖**：子任务 C 的「AGENTS.md 瘦身」必须等本任务完成——官方 skill selector 接管之后，
> AGENTS.md 里的 Skill Governance 渲染块才成为冗余。

## Goal

让 Claude Code 用**它自己的官方机制**看见工作台：根 `CLAUDE.md` 被加载，
4 个官方 skill 出现在 Skill 列表里、可被 `/jspace-use` 直接调用。

不改任何 skill 正文，不改 AGENTS.md 内容——本任务只解决"放在哪 harness 才找得到"。

## 背景（父任务 P1/P2 摘要）

- Claude Code 只读 `CLAUDE.md`，不读 `AGENTS.md`（官方文档明述，且本机实测印证）
- 官方 skill 物化在 `.jspace/skills/`（`cli/embed.ts:102`），
  而 Claude Code 只扫 `~/.claude/skills/` 与 `<project>/.claude/skills/`

## Requirements

- **A1** `jspace init` 在工作台根生成 `CLAUDE.md`，内容为 `@AGENTS.md` import。
  用 import 不用 symlink：Windows symlink 需管理员/开发者模式，官方文档对该场景直接推荐 import。
- **A2** 官方 skill 在保留 `.jspace/skills/<name>/` 的同时，**同字节**复制到
  `.claude/skills/<name>/`。`.jspace/skills/` 保持 harness 无关事实源地位，
  `.claude/skills/` 是它的 Claude Code 特化投影。
- **A3** 两份副本必须字节一致。该风险已真实发生：`~/jspace-work` 根 `skills/` 存有 4 个官方 skill
  的旧副本，与 `.jspace/skills/` 内容已分叉（`diff -rq` 多处 differ + 缺文件）。
- **A4** 新增路径纳入 `BUNDLE_MANIFEST`，ownership = `seed`（未改随升级刷新、改过保留 `skip`）。
  注意 `ownershipFor`（`application/workspace/manifest.ts:22-27`）当前按 key 前缀判定，
  新增投影路径需要确认落在正确分支。
- **A5** `jspace workspace upgrade` 能让既有工作台平滑获得新文件，无需重新 `init`。
- **A6** `jspace doctor` 新增诊断：
  - `claude.pointer_missing` — 根 `CLAUDE.md` 缺失或未 import `AGENTS.md`
  - `skills.projection_drift` — `.claude/skills/<name>` 与 `.jspace/skills/<name>` 内容分叉
  - `skills.legacy_root_copy` — 根 `skills/` 下出现**官方 skill 名**的目录（历史布局遗留）。
    现有 `skills.orphan_dir` 检测不到这种情况：`doctor.ts:97-98` 注释明确
    "Root skills/ (user-created) is never scanned"

## 约束

- 不破坏所有权模型：`hub.json` / `cron.json` 永不覆盖；用户改过的 seed 文件保留 `skip`
- 不动 skill 正文，不动 `AGENTS.md`（那是子任务 C 的范围）
- 改 `templates/workbench/` 或 `skills/` 后必须重跑 `bun run scripts/gen-assets.ts`
  同步 `cli/assets.generated.ts` + `cli/manifest.generated.ts`
- 仓库 PUBLIC：新增内容中性占位，无真实个人/项目数据
- 不接线 Pi / Codex / Cursor，但物化逻辑要留出加目标目录的扩展位

## Acceptance Criteria

- [ ] AC-A1 `jspace init --dir <空目录>` 后，根存在 `CLAUDE.md`，内容含 `@AGENTS.md`
- [ ] AC-A2 该目录存在 `.claude/skills/{jspace-use,asset-ingest,memory-recall,memory-writeback}/SKILL.md`
- [ ] AC-A3 `diff -r .claude/skills .jspace/skills` 无差异（同字节）
- [ ] AC-A4 在该目录启动 `claude`，`/context` 的 Memory files 列出 `CLAUDE.md`
- [ ] AC-A5 同一会话 Skill 列表含 4 个官方 skill；`/jspace-use` 可直接调用
- [ ] AC-A6 `~/jspace-work` 跑 `jspace workspace upgrade` → 新文件到位；
      `hub.json`/`cron.json` 未被触碰；用户改过的文件报 `skip`
- [ ] AC-A7 `jspace doctor --dir ~/jspace-work` 报出 `skills.legacy_root_copy`（当前漏报）
- [ ] AC-A8 人为改一份投影副本 → `doctor` 报 `skills.projection_drift`；
      副本处于 stale（bundle 前进）时 `upgrade` 可刷新消除，
      真实用户编辑按 seed 保留（`skip`）——以手动 reconcile 为准（诊断旨在暴露分叉，不强制覆盖）
- [ ] AC-A9 删掉 `CLAUDE.md` → `doctor` 报 `claude.pointer_missing`
- [ ] AC-A10 `bun run scripts/gen-assets.ts` 后 `git diff` 干净；`tsc` 与既有测试全绿

## 非目标

- 不做 hook 注入（子任务 B）
- 不改 AGENTS.md 内容或 skill 正文（子任务 C）
- 不清理 `~/jspace-work` 的历史遗留副本——本任务只负责**让 doctor 报出来**，
  实际清理由用户按诊断提示决定（涉及删文件，属破坏性操作）

## Key Decisions

- **复制而非 symlink**：官方文档确认 `.claude/rules/` 支持 symlink，但 skills 未明说；
  复制规避该不确定性，代价是需要 A3 的同字节校验与 `skills.projection_drift` 诊断。
- **保留 `.jspace/skills/`**：不迁移。它是 harness 无关事实源，后续 Pi/Codex/Cursor 各自投影。
- **`.claude/skills/` 归 seed 而非 managed**：与现有 skill 文件所有权保持一致，
  用户改动被尊重（报 skip），代价是投影可能漂移——由诊断兜住而不是强制覆盖。
