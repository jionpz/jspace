# Skill Manifest、Harness 能力矩阵与日常运维闭环 — Implementation Plan

## Execution Strategy

按里程碑顺序实现，每个里程碑保持 `tsc` + 139 tests 绿、skill 源与 bundle manifest 同提交，不触碰真实用户 harness 配置与真实 scheduler。M0 先修基线 flake。完成后运行全链验证 gate，提交并交付 review，更新父任务 acceptance mapping。

> 专家 review（2026-08-04）已定案：P0 = skills ownership seed→managed；P1（execute 迁移 / bootstrap §11 / AC17 partial / pending 交接 / 敏感屏蔽 owner / gen-assets 再生成）全部并入下方里程碑。

## Milestone Map

### M0 — 基线修复（前置）

- [x] 定位并修复 `application/automation/state.test.ts:58` 的 order-dependent 失败（全量 138 pass / 1 fail；单跑通过 → 共享状态/时序干扰）。
- [x] Validation：`bunx tsc --noEmit && bun test` → 139 全绿。

### M1 — SkillsManifest 契约 + ownership 修订

- [x] 新建 `core/contracts/skills.ts`：`SkillsManifestV1` / `SkillEntry`（name/version/scope/dependencies/install_source/description，**无 entrypoint**）/ decoder（diagnostics 模式；断言 scope⇒install_source 组合）。
- [x] 新建仓库根 `skills-manifest.json`（version 1）：workbench = bootstrap / asset-ingest / memory-recall / memory-writeback（dependencies 如实：memory-recall→asset-ingest；memory-writeback→asset-ingest,jspace-bootstrap）；global = harness-config（install_source `~/.agents/skills/harness-config`）。
- [x] `application/workspace/manifest.ts`：`ownershipFor` skills/ → **managed**；同步更新 `manifest.test.ts`（seed→skip 断言改为 managed→update/conflict）。
- [x] `core/contracts/skills.test.ts`：decoder round-trip、unknown-field、id/scope 约束、manifest↔skills 目录一致。
- [x] Validation：`bunx tsc --noEmit && bun test`。

### M2 — gen-assets 由 manifest 驱动 + 4 skills 入 bundle（F2）

- [x] `scripts/gen-assets.ts`：读并 decode `skills-manifest.json`，SOURCES = templates + `skills/<workbench.name>`（断言目录存在）；emit `cli/skills.generated.ts`（`SKILLS_MANIFEST`）。
- [x] `cli/embed.ts` materializeTree：缺失断言改为按 `SKILLS_MANIFEST.workbench` 遍历。
- [x] 重跑 gen-assets：ASSETS 与 BUNDLE_MANIFEST 含 memory-recall / memory-writeback（连同 references/scripts）。
- [x] 临时工作台 init 后断言 4 skills 物化（AC-D1 物化面）。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M3 — workbench 引用可达（RD2 / AC-D2）

- [x] `git mv docs/MEMORY-ACCEPTANCE.md skills/memory-recall/references/memory-acceptance.md`；更新 memory-recall SKILL.md（:3,61,66）/ discipline.md（:3,51,61）/ GOAL.md 引用。
- [x] 新建 `skills/jspace-bootstrap/references/headless-ops.md`（承接 docs/HEADLESS-OPS.md 运维要点）；AGENTS.md:159 改指 skill 内路径；GOAL.md 链接同步。
- [x] 新增引用可达 contract test：按 design §6 规则扫描物化工作台全部 md（含根 AGENTS.md），解析 `skills/`/`references/` 相对引用断言存在；`docs/` 引用仅允许 `[external]` 标注。
- [x] 全仓 grep 确认 skill 与模板无残留 `docs/MEMORY-ACCEPTANCE` / `docs/HEADLESS-OPS` 引用。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M4 — harness-config global scope（RD3 / AC-D6）

- [x] manifest global 条目完成；contract test：workbench 数组不含 harness-config、ASSETS 不含 `skills/harness-config/`、global 含 install_source、scope⇒install_source 约束生效。
- [x] 模板 AGENTS.md / bootstrap references「见 harness-config skill」表述标注机器级全局、不随工作台物化、需 Phase 1 自装。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M5 — Cron skill target 契约 + 模板（RD5）

- [x] `core/contracts/cron.ts`：`CronSkillTarget` + `CronDefinition.prompt?`/`target?`；`decodeCrons` 加 target 允许字段 + 校验恰好一个 prompt|target；既有 v1 文件向后兼容。
- [x] 模板 `templates/workbench/.jspace/cron.json`：`inbox-tidy` 改 `target`（skill asset-ingest、entrypoint batch、input 沿用现 prompt 语义）；weekly/consolidate 保持 prompt。
- [x] **新增** decodeCrons 契约测试（cli/cron.test.ts 现有无 decodeCrons 用例）：恰好一个校验、inbox-tidy target 解析、weekly/consolidate prompt 解析、旧 v1 文件兼容。
- [x] 文档注明旧二进制读含 target 的 cron.json → unknown-field，先升 CLI（不 bump schema）。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M6 — validateSkillTarget + resolveCronPrompt + execute 接线（AC-D4/D8）

- [x] `application/automation/definitions.ts`：`resolveCronPrompt`（target → 含 `<wbRoot>/skills/<skill>/SKILL.md` 绝对路径的 prompt 编译；prompt 原样返回）；`validateSkillTarget`（skill∈manifest / SKILL.md 存在 / entrypoint ∈ 声明集 / diffBundle 含 update|conflict|create|stale → 不兼容 + fix）。
- [x] `application/automation/execute.ts`：validate 插在 **dry-run 提前 return 之前**；失败开 incident 返回非 0 不 spawn；argv 用 `resolveCronPrompt`；**isInboxTask 迁移**为 `cron.id==="inbox-tidy" || cron.target?.skill==="asset-ingest"`。
- [x] `cron install` / rehearsal 对 skill-target 任务执行同一校验，前置失败给修复动作。
- [x] DI 接线：`cli/commands/registry.ts` 向 application/automation 注入 `SKILLS_MANIFEST` + journal/readFile（application 不 import cli）。
- [x] 测试：unknown skill / missing SKILL.md / entrypoint 未声明 / 旧 bundle 物化（diffBundle update|create）→ ok:false+fix；成功路径 argv 含 skill 路径；dry-run 无副作用；target 版 inbox-tidy「batch 日志未变化 → batch-stale incident」（F3 不回退）；存量工作台 upgrade 自动补全 4 skills（AC-D8）。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M7 — Harness lifecycle 能力矩阵 + automated 证据（RD4 / F8）

- [x] 为 `harnessArgv`（claude/codex/pi + allowedTools）补最小单测（automated 格证据）。
- [x] `skills/jspace-bootstrap/references/harnesses.md` 新增「Lifecycle 能力矩阵」节（四 harness × session-start/session-end/fallback/crash-recovery，逐格分级 + 验证方法；以 harness-config references 官方核查为据复核）。
- [x] `docs/PLATFORMS.md` 交叉引用矩阵 + argv 分级标注测试证据；contract test 断言两处 automated 集合一致（AC-D7）。
- [x] 措辞清理（AC-D3）：模板 AGENTS.md「does this automatically」等改分级措辞；bootstrap/harness-config references 检查；GOAL.md 仅加指针行不改写 vision。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M8 — Bootstrap 安全与 gbrain 兼容（RD6 / AC-D5）

- [x] bootstrap SKILL.md Phase 0 对齐父设计 §11：探测缺失 → 给命令不默认执行 → 下载到临时文件 + 展示来源/校验和 → 用户显式确认；删除「do not stop to ask」。
- [x] contract test：扫描 bootstrap bundle 文本，断言无未确认管道安装 + 管道行前后 3 行内含来源/校验和标记（定义判定规则）。
- [x] `skills/jspace-bootstrap/references/gbrain.md` 声明支持/已验证版本范围；fixture/test 断言 `gbrain doctor` 升级前健康检查步骤存在。
- [x] AC12 敏感屏蔽 owner 记录（既有 doctor/logging + Child F 全链验收复核；Child D 不新增泄密输出）。
- [x] Validation：`bunx tsc --noEmit && bun test && bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`。

### M9 — 全链验证 gate + 父任务交接（AC-D1~D8）

- [ ] `bunx tsc --noEmit`、`bun test`（139 全绿）、`python3 skills/asset-ingest/scripts/office-extract.test.py`（不回退）。
- [ ] `bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts`（asset freshness）。
- [ ] 临时工作台全链：`init → doctor` → 4 skills+references 物化 → `cron run inbox-tidy --dry-run`（validate 通过、无副作用）→ 人为移除 skill 后 dry-run 前置失败给修复动作 → 存量旧工作台 upgrade 补全。
- [ ] 更新父任务 implement.md checklist：pending write envelope 从 Child D 摘除、补入 Child E；AC12 敏感屏蔽 owner 标注；父任务 acceptance mapping 勾选 AC9 / AC15 / AC17（**partial** 标注）+ AC11 owner。
- [ ] 运行 `trellis-check`；交付 review。

## Validation Gates

```bash
bunx tsc --noEmit
bun test                          # 139 全绿（M0 后）
python3 skills/asset-ingest/scripts/office-extract.test.py
bun run scripts/gen-assets.ts
git diff --exit-code cli/assets.generated.ts cli/skills.generated.ts cli/manifest.generated.ts
# 临时工作台 init + doctor + 4 skills 断言 + cron run --dry-run（无副作用）
# 存量旧 bundle 工作台 upgrade 补全断言
```

## Rollback Points

- 每里程碑独立提交；skill 源（`skills-manifest.json` / skills/ 内容 / 模板）与 bundle 生成（`cli/*.generated.ts`）同一次提交，禁止「模板先声明、bundle 后补」中间态。
- M1 ownership 修订与 `manifest.test.ts` 同步提交，避免 seed→managed 中间不一致。
- M5 cron decode 变更与 M6 execute 接线（isInboxTask / validate / resolveCronPrompt）同里程碑落地，避免 `prompt` 可选化后的中间失效态。
- M3 docs 迁移用 `git mv` 保历史；convergence 时 grep 全仓修复遗漏引用。

## Follow-up Before `task.py start`

- [ ] `prd.md` / `design.md` / `implement.md` 三件齐备并经用户 review 批准。
- [ ] `implement.jsonl` / `check.jsonl` 至少各一条真实 spec/research 条目（已补齐；review 后如有新增 spec 引用再增补）。
- [ ] 父任务 checklist 交接（pending envelope → Child E、AC12③ owner）在 M9 落实。
- [ ] M0 基线 flake 先修，确保「139 全绿」成立后才开始各里程碑验证。
