# Research: 生成物漂移 / 校验现状

- **Query**: 运行 `bun run scripts/check-skills.ts` 与 `bun run scripts/gen-assets.ts`，确认 C1-C4 是否绿；找出「本不应是生成物但被手改」或「生成物里残留陈旧内容」。
- **Scope**: internal
- **Date**: 2026-08-06

## 结论一：C1-C4 全部通过（现状验证）

`bun run scripts/check-skills.ts` 输出：

```
ok: C1 references resolve (77 refs)
ok: C2/C3 Brain operations consistent with frontmatter + manifest
ok: C3 Skill Governance set matches workbench manifest
ok: C4 gen-assets output is fresh (regenerate changes nothing)
PASS: 全部 skills 自检通过
```

- 实跑 `bun run scripts/gen-assets.ts` 后 `git status` 无新增改动（仅会话前已存在的 `.trellis/.template-hashes.json`），确认 C4 非虚报：**生成物与源码当前一致，无漂移**。
- `bunx tsc --noEmit` 通过（0 错误），类型面健康。

## 结论二：生成物内无陈旧内容

- `cli/assets.generated.ts` / `cli/manifest.generated.ts` / `cli/skills.generated.ts` 中无 `jspace-bootstrap` 残留；skill 名单为 `["jspace-use","asset-ingest","memory-recall","memory-writeback"]`，与 `skills-manifest.json` 一致。
- `templates/workbench/AGENTS.md` 两个生成块（TRELLIS-BRAIN-OPS / TRELLIS-SKILL-GOV）由 gen-assets 从 frontmatter 渲染，与 `skills/*/SKILL.md` 的 name/description/triggers 一致（C2/C3 已断言）。
- 生成物与手写源边界清晰：gen-assets 只拥有 3 个 generated.ts + AGENTS.md 两个生成子块；C4 钉死「重跑无 diff」。

## 结论三：生成链路相关漂移（非生成物本身）

### 3.1 package.json 版本号与 gen-version 输出漂移

- `scripts/gen-version.ts` 从 git tag（或 CI 的 `JSPACE_BUILD_VERSION`）写 `cli/version.generated.ts`，当前为 `1.0.9`。
- `package.json:3` 手工维护的 `"version": "1.0.8"` **未随 tag bump**。全仓无代码读 package.json version（grep 确认），故无运行时影响，但作为发布元数据漂移。
- **判断**：需确认——建议发布流程把 package.json version 纳入 bump（或声明其为非事实源）。

### 3.2 `bin/` 本地编译产物（git 忽略，不入仓）

- `bin/` 现有 8 个编译二进制，全部被 `.gitignore` 的 `bin/jspace` / `bin/jspace-*` / `bin/jspace-*.exe` 覆盖，**git 未跟踪**（`git ls-files bin/` 为空）。
- 其中 `jspace-1.0.8.bak`（62MB）是自更新备份残留；`jspace-linux-arm64` / `jspace-linux-x64` / `jspace-macos-arm64` / `jspace-macos-x64` / `jspace-windows-arm64.exe` / `jspace-windows-x64.exe` 是 `build:all` / CI 交叉编译产物。合计约 630MB 本地磁盘占用。
- **判断**：非仓库冗余（不入仓、不随发行物）；属本地磁盘清理项，可手动删除 `jspace-1.0.8.bak` 与不需要的交叉编译产物。

### 3.3 `skills/jspace-use/agents/openai.yaml` 是随包物化的无消费方资产

- 该文件被嵌入并在每个工作台物化为 `.jspace/skills/jspace-use/agents/openai.yaml`（`cli/manifest.generated.ts:16` 有 manifest 条目，ownership: seed）。
- **全仓无任何文件引用它**：`skills/jspace-use/SKILL.md` 不引用 `agents/` 目录；模板 AGENTS.md 的 Agents 节明确「不物化成各 harness 的 agent 文件」；支持的四 harness（Pi/Claude Code/Codex/Cursor）均不读取 `openai.yaml` 格式。
- 这是旧 skill 资产格式的遗留（上轮 audit-references 记为 jspace-bootstrap 的 7 个嵌入文件之一）。
- **判断**：需确认——删除该文件 + 重跑 gen-assets 即可从 bundle 移除（manifest 条目与 AGENTS.md 生成块不依赖它，C1 不涉及 yaml 引用）；但若未来计划支持 OpenAI 系 agent 描述可保留。当前为每个工作台的白占 seed 资产。

## 判定汇总

- **校验现状**：C1-C4 全绿；gen-assets 重跑无 diff；tsc 通过。**生成物无漂移。**
- **需确认（生成链路侧）**：package.json version 漂移（3.1）；`openai.yaml` 无消费方资产（3.3）。
- **本地清理（非仓库问题）**：`bin/` 残留编译产物与 `.bak`（3.2）。
