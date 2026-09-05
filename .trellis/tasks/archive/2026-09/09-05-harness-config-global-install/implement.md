# implement — harness-config global 技能获取路径（#37)

按层推进，每步末尾有验证点；步骤间可独立回滚（revert 单步 + 按需重跑 gen-assets）。

## Step 1 — 契约更名（install_source → install_path）

- [x] `core/contracts/skills.ts`：`SkillEntry.install_path`；decoder 消息 `skills.entry.install_path.*`；约束不变（global 必填 / workbench 禁用）。
- [x] `skills-manifest.json`：`install_source` → `install_path`。
- [x] 若存在契约 round-trip 测试（grep `decodeSkillsManifest` 于 `*.test.ts`）同步更新。
- [x] 验证：`bunx tsc --noEmit`（预期仅 `cli/assets-reachability.test.ts:87` 报错，Step 6 修）。

## Step 2 — gen-assets 产出 GLOBAL_SKILLS

- [x] `scripts/gen-assets.ts`：global 目录存在性断言（同 workbench 模式）→ walk 进独立 map → emit `cli/global-skills.generated.ts`（`export const GLOBAL_SKILLS: Record<string, string>`，key 形 `skills/<name>/<rel>`；确定性排序同 walk 现状）。
- [x] `renderAgentsBlocks` 保持只传 workbench 名单（确认现有调用不被改动）。
- [x] 验证：`bun run scripts/gen-assets.ts` 产出新文件、5 个 key 齐全（SKILL.md / references×3 / scripts/detect.sh）；再次运行幂等（diff 干净）。

## Step 3 — skills install 覆盖 global

- [x] `cli/commands/skills.ts`：`installHandler` 名单 = workbench + global；`installDeps` 的 `assetKeys`/`assetContent` 改为 `ASSETS ∪ GLOBAL_SKILLS` 并集视图（`application/skills/install.ts` 零改动）。
- [x] `installSpec` summary/description 提及机器级技能。
- [x] 测试：`application/skills/install.test.ts` + `cli/commands/error-semantics.test.ts` 增补——global 技能落盘（deps 注入 GLOBAL_SKILLS 形态）、fill-gaps 保留本地编辑、`--refresh` 重写差异文件、写失败 → exit 1（对齐 issue #8 #9 语义）。
- [x] 验证：`bun test application/skills cli/commands/error-semantics.test.ts`。

## Step 4 — upgrade 通道一致

- [x] `cli/commands/workspace.ts:34`：refresh 名单含 global；deps 并集同 Step 3（两处命令共享一个组装函数则抽到 helpers，避免复制）。
- [x] 验证：`bun test cli/commands/workspace.test.ts`；smoke：`/tmp/jspace-smoke` 内 `workspace diff` / `upgrade` 无 global 相关异常条目。

## Step 5 — doctor skills.global_missing（info）

- [x] `application/diagnostics/deps.ts`：`SkillsDeps.globalSkills?: () => Array<{ name: string; installPath: string }>`（省略 = 检查静默跳过，同 `bundleStaleSkills` 模式）。
- [x] `application/diagnostics/checks/skills.ts`：新增检查块——tilde 展开后目录缺失 → info / `skills.global_missing` / path `skills.<name>` / message 指向 `jspace skills install`。
- [x] cli 组装：`cli/commands/helpers.ts`（`officialSkillNames` 同址）注入 `SKILLS_MANIFEST.global`；tilde 展开复用 `cli/embed.ts` `expandTilde`。
- [x] 测试：`application/diagnostics/doctor.test.ts` 增补——缺失报 info、存在无诊断、deps 未注入时跳过。
- [x] 验证：`bun test application/diagnostics`。

## Step 6 — 测试不变式更新（assets-reachability）

- [x] `cli/assets-reachability.test.ts`：
  - 原 `install_source` 断言（:78-87）改为：harness-config **不在** `ASSETS`、**在** `GLOBAL_SKILLS` 且 5 文件齐全、`manifest.global` 声明 `install_path`；
  - 引用可达性扫描：md 集合加入 GLOBAL_SKILLS 的 md；存在性探测用 `ASSETS ∪ GLOBAL_SKILLS` 并集（`resolve()` 因 key 同形可直接复用）。
- [x] 验证：`bun test cli/assets-reachability.test.ts`。

## Step 7 — 文档

- [x] `skills/jspace-use/references/harnesses.md` 及各 `harness-<name>.md`：获取措辞改指 `jspace skills install`（grep `Phase 1`/`自装`/`harness-config` 全量核对 13 处；分工/不用条目不动）。
- [x] 根 `AGENTS.md` global 技能描述句补「由 skills install 安装」（可选；名字清单与合计不变）。
- [x] 验证：`bun run scripts/gen-assets.ts`（重嵌 md）→ `bun run scripts/check-skills.ts` → `git diff` 干净。

## Step 8 — 全量门禁 + smoke（最后一轮全范围检查）

- [x] `bunx tsc --noEmit`
- [x] `bun test`
- [x] `bun run scripts/gen-assets.ts && git diff --exit-code cli/*.generated.ts adapters/harness/capabilities.generated.ts`（含新增 `cli/global-skills.generated.ts` 被跟踪：`git add` 后无残留 diff）
- [x] `bun run scripts/check-skills.ts && bun run scripts/check-harness-consistency.ts && bun run scripts/check-manifest-integrity.ts`
- [x] smoke：`bun run cli/main.ts init /tmp/jspace-smoke` → `doctor --dir /tmp/jspace-smoke`（首次无 global 技能时出现 `skills.global_missing` info；执行 `skills install` 后消失）→ `/tmp/jspace-smoke` 内 `skills install --dry-run` 列出 8 个技能。
- [x] 确认 `/tmp/jspace-smoke/.jspace/skills/` 与各投影目录**无** harness-config（AC3）。

## Review gates

- Step 3 后：安装语义与 issue #8/#9 的写失败语义一致性。
- Step 8 前：对照 PRD AC1-AC7 逐条自检。

## Rollback

- 单步 revert + 重跑 gen-assets；无持久状态（`~/.agents/skills/harness-config` 为普通文件，可留可删）。
