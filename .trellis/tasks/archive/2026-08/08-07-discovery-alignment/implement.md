# Implement — 发现层对齐

> 子任务 A of `08-06-workbench-context-wiring`。设计见 `design.md`，需求见 `prd.md`。
> **依赖**：无。可与子任务 B 并行。
> **禁止**：不改 skill 正文、不改 `AGENTS.md` 内容（子任务 C 的范围）。

## 验证命令（CI 同款，来自 `.github/workflows/verify.yml`）

```bash
bunx tsc --noEmit                              # 类型门禁
bun test                                       # 全量单测
bun test cli/assets-reachability.test.ts       # 嵌入式资产可达性
bun run scripts/check-skills.ts                # skill 渲染一致性
bun run scripts/gen-assets.ts && git diff --exit-code   # 生成物与模板一致
```

## 步骤

### S1 · 摸清现状（只读，不改代码）

- [x] S1.1 确认 `materializedRel` 的 7 个生产调用点各自要的语义（正查 or 反查）：
      - `manifest.ts:82`（diffBundle 主循环）→ 要**全部**投影
      - `manifest.ts:163`（recorded 清理）→ 要**全部**投影（`.includes(rel)`）
      - `journal.ts:57` / `journal.ts:81` → 要**全部**投影（每份投影独立记录）
      - `init.ts:70` → 要**全部**投影
      - `workspace.ts:254` → 需读代码确认
      - `workspace.ts:47` → **反查**（由 rel `.jspace/hub.json` 找 bundle key），
        改成数组后需用 `.includes()` 而非 `===`
- [x] S1.2 检查 `~/jspace-work` 的 materialization journal 是否记录了根 `skills/` 旧副本：
      `jspace workspace diff --dir ~/jspace-work --json | jq '[.[] | select(.rel|startswith("skills/"))]'`
      决定它走 `remove`/`stale` 还是只能靠新诊断提示手工处理
- [x] S1.3 记录当前基线：`jspace doctor --dir ~/jspace-work`（现为 0 error / 3 warning）

> **Review gate 1**：S1 结论若与 `design.md` §7「待验证」冲突，先回 design 修正再继续。

### S2 · `CLAUDE.md` 指针（最小、可独立验证）

- [x] S2.1 新增 `templates/workbench/CLAUDE.md`，正文仅 `@AGENTS.md`（不放任何规则）
- [x] S2.2 `bun run scripts/gen-assets.ts` → 确认 `cli/manifest.generated.ts`
      新增一行 `templates/workbench/CLAUDE.md` 且 `ownership: "seed"`（应自动，无需改 `ownershipFor`）
- [x] S2.3 `bun test && bunx tsc --noEmit`
- [x] S2.4 冒烟：`bun run cli/main.ts init --dir /tmp/jspace-a2` → 确认根有 `CLAUDE.md` 且含 `@AGENTS.md`

**回滚点 R-S2**：删除模板文件 + 重跑 gen-assets 即可完全回退。

### S3 · 1:1 → 1:N 投影

- [x] S3.1 `application/workspace/manifest.ts`：新增 `SKILL_PROJECTIONS` 常量与
      `materializedRels(key): string[]`（签名与注释见 `design.md` §3.1）
- [x] S3.2 按 S1.1 的结论逐个改写 7 个调用点。
      **不保留 `materializedRel` 兼容封装**——7 个调用点全部在同一模块族内，
      留兼容层反而制造两套语义
- [x] S3.3 `cli/embed.ts:97-120` 的 `materializeTree` 改为复用 `materializedRels`，
      消除与 `manifest.ts` 的重复映射实现；保留 `AGENTS.md` 的块合并特判
- [x] S3.4 更新 `application/workspace/manifest.test.ts`（现有 3 处断言 `materializedRel`，
      line 64-73）→ 断言新语义：skill key 返回 2 个路径且第一个是 `.jspace/skills/…`
- [x] S3.5 新增测试：同一 skill 的两份投影 rel 不同、在 `diffBundle` 中各产生一条 entry
- [x] S3.6 `bunx tsc --noEmit && bun test && bun test cli/assets-reachability.test.ts`

**回滚点 R-S3**：`SKILL_PROJECTIONS = []` 即退回 1:1 行为。

### S4 · 端到端物化验证

- [x] S4.1 `bun run cli/main.ts init --dir /tmp/jspace-a4`
- [x] S4.2 `diff -r /tmp/jspace-a4/.claude/skills /tmp/jspace-a4/.jspace/skills` → **必须无差异**（AC-A3）
- [x] S4.3 确认 4 个 skill 都在：
      `ls /tmp/jspace-a4/.claude/skills`  → jspace-use / asset-ingest / memory-recall / memory-writeback
- [x] S4.4 既有工作台升级路径：
      `bun run cli/main.ts workspace diff --dir ~/jspace-work` → 确认新路径为 `create`、
      `hub.json`/`cron.json` 为 `skip` 或不出现

> **Review gate 2**：S4.4 若显示任何 `user` 所有权文件被计划改写，**停止**并回 design。

### S5 · doctor 三条诊断

- [x] S5.1 `claude.pointer_missing` — 根无 `CLAUDE.md` 或不含 `@AGENTS.md`
- [x] S5.2 `skills.projection_drift` — 两份投影内容不一致，message 列出分叉文件
- [x] S5.3 `skills.legacy_root_copy` — 根 `skills/<name>` 且 `<name>` ∈ `officialSkillNames()`；
      **只匹配官方名**，用户自建 skill 仍不扫描（保持 `doctor.ts:97-98` 的原有约定）
- [x] S5.4 三条均为 `warning` 级，写入 `application/workspace/doctor.test.ts` 对应用例
- [x] S5.5 `bun test`

### S6 · 真实环境验收

- [x] S6.1 `jspace doctor --dir ~/jspace-work` → 应报出 `skills.legacy_root_copy`（AC-A7，当前漏报）
- [x] S6.2 人为改一份投影副本 → 复跑 doctor → 报 `skills.projection_drift`（AC-A8）
- [x] S6.3 删 `/tmp/jspace-a4/CLAUDE.md` → doctor 报 `claude.pointer_missing`（AC-A9）
- [x] S6.4 **在 `/tmp/jspace-a4` 启动 `claude`**（需用户手动执行）：
      - `/context` 的 Memory files 含 `CLAUDE.md`（AC-A4）
      - Skill 列表含 4 个官方 skill，`/jspace-use` 可调用（AC-A5）

> **Review gate 3**：S6.4 需用户在真实 claude 会话里确认。这是本任务**唯一无法自动化**的验收项，
> 也是整个改动是否成立的判据——AC-A4/A5 不过则前面全部白做，必须在收工前拿到确认。

### S7 · 收尾

- [x] S7.1 全套验证命令跑通（见顶部）
- [x] S7.2 `bun run scripts/gen-assets.ts && git diff --exit-code` 干净（AC-A10）
- [x] S7.3 `docs/PLATFORMS.md` 与 `skills/jspace-use/references/harnesses.md` 的
      Claude Code 行按实际能力更新——**不虚报**：本任务只让 skill/CLAUDE.md 可被发现，
      session-start 注入是子任务 B 的事，此处不得写成 `automated`
- [x] S7.4 清理临时目录 `/tmp/jspace-a2` `/tmp/jspace-a4`

## 专家审查修复（2.2 · 多专家对抗审查确证）

> 5 lens 独立审查 + 对抗验证，5/5 确证并修复；2 个失败 lens 补跑后 2 条确证并修复。门禁：369 tests 绿。

| 缺陷 | 修复 |
|---|---|
| `diffDirs` 把运行时 `__pycache__/*.pyc` 误判为投影漂移 | 跳过 `__pycache__`（与 gen-assets `SKIP_DIRS` 一致） |
| `projection_drift` 提示「run upgrade to refresh」对用户编辑的 seed 副本无效 | message 改为「upgrade 刷新未改副本、用户编辑保留，查 workspace diff」 |
| `legacy_root_copy` 只匹配当前官方名 → 改名前的 `jspace-bootstrap` 遗留漏报 | 加历史官方名集合；实测 `~/jspace-work` 4 个副本全报出（原 3 个） |
| `pointer_missing` 对非 Claude harness 用户无条件 warning | message 注明可忽略（不引入 harness 机制，超范围） |
| 投影整目录缺失时守卫跳过、与 `diffDirs` 契约矛盾 | 按 journal 区分「从未物化」（不报）与「曾物化被删」（报） |
| README 未同步 `CLAUDE.md`/`.claude/skills/` 到结构/升级表（docs lens） | README 补两处；AGENTS.md/SKILL.md 表述归子任务 C |
| `pointer_missing` 判定过窄（`@./AGENTS.md` 合法写法误报） | `/@(?:\.\/)?AGENTS\.md/` 正则；补测试 |
| claude-official lens：design 断言「子目录启动不触发审批」过强 | 收窄为「根启动」，子目录场景标推测，移出 AC 承诺 |
| claude-official lens：upgrade 新建 `.claude/skills/` 后运行中会话不发现 | `harnesses.md` 写明「需重启 claude 会话」 |
| 观察项：skill 正文 CWD 相对引用从子目录调用不确定 | 移交子任务 C（implement.md S3.4，建议 `${CLAUDE_SKILL_DIR}`） |

## 不做

- 不清理 `~/jspace-work` 的历史遗留副本（涉及删文件；由用户按诊断提示决定）
- 不改 hook / 不做上下文注入（子任务 B）
- 不改 AGENTS.md 内容或任何 skill 正文（子任务 C）
- 不接线 Pi / Codex / Cursor（`SKILL_PROJECTIONS` 已留扩展位）

## 完成判据

`prd.md` 的 AC-A1 ~ AC-A10 全部勾选，其中 AC-A4 / AC-A5 需真实 claude 会话确认。
