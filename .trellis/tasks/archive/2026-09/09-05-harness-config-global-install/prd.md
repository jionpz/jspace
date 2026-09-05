# 修复harness-config global技能无获取路径问题(#37)

## Goal

让 `scope: global` 的机器级技能（当前唯一条目 `harness-config`）获得真实可用的获取通道：`jspace skills install` 把它安装到 `~/.agents/skills/<name>`，官方技能中 13 处引用从死链变为可达；doctor 对缺失可发现。

## Background

- `skills-manifest.json` 声明 `global: [harness-config]`（源文件 5 个齐全），但 gen-assets 不嵌入、`installHandler` 只遍历 workbench 清单、`manifest.global` 运行时零引用 → release 二进制机器上无法取得该技能，13 处官方引用全部为死链（详见 `research/issue-37.md`）。
- 现状是"文档一致性有测试、可获取性无人管"：`assets-reachability.test.ts` 断言其不进 bundle，`check-skills` 只验仓库源，doctor 不查机器级技能存在性。

## Requirements

- **R1 嵌入**：gen-assets 把 `manifest.global` 声明的技能源文件嵌入二进制，产出独立生成模块 `cli/global-skills.generated.ts`（**不**混入 `ASSETS`，见 D2）。
- **R2 安装**：`jspace skills install` 同时安装 workbench + global 技能到 `~/.agents/skills/<name>`，沿用现有 fill-gaps / `--refresh` / `--dry-run` 语义；输出行可区分来源清单（global 条目一并列出）。
- **R3 升级通道一致**：`jspace workspace upgrade` 刷新 `~/.agents/skills/` 时同样覆盖 global 技能（与 workbench 技能同语义）。
- **R4 doctor 检查**：新增 `skills.global_missing`（severity: info）——`manifest.global` 声明的技能在其 `install_path`（机器路径，tilde 展开）不存在时报告，message 指向 `jspace skills install`；存在则无诊断。
- **R5 契约更名**：`install_source` → `install_path`（语义即安装目标路径；build-time 数据，无迁移负担），decoder 约束同步（global 必填、workbench 禁用）。
- **R6 文档措辞**：jspace-use 中描述 harness-config 获取方式的措辞（`references/harnesses.md` 及各 `harness-<name>.md` 中涉及"按其 Phase 1 自装"类表述）改为指向 `jspace skills install`；harness-config 技能自身内容不动。
- **R7 不变式守卫**：更新 `assets-reachability.test.ts`——global 技能进 `GLOBAL_SKILLS` 但**不**进 `ASSETS`；global 技能 md 的内部引用可解析；不进任何工作台物化路径。

## Acceptance Criteria

- [ ] AC1 全新机器（无 `~/.agents/skills/harness-config`）：`jspace skills install --dry-run` 列出 harness-config 且不写盘；真实执行创建该目录并落 5 个文件（`SKILL.md`、`references/`×3、`scripts/detect.sh`）。
- [ ] AC2 已存在 `~/.agents/skills/harness-config`（含本地修改）时：默认 fill-gaps 保留本地编辑；`--refresh` 仅重写与 bundle 内容不同的文件。
- [ ] AC3 结构不变式：`jspace init` / `workspace upgrade` 后工作台内（`.jspace/skills/`、`.claude/skills/` 等投影）不存在 harness-config——由 `GLOBAL_SKILLS` 不进 `ASSETS`、物化机制只读 `ASSETS` 保证，并有测试断言。
- [ ] AC4 `jspace workspace upgrade` 会刷新 `~/.agents/skills/harness-config` 中与 bundle 不一致的文件（语义同 workbench 技能）。
- [ ] AC5 doctor：目录缺失时输出 info 级 `skills.global_missing`（含 `jspace skills install` 指引）；目录存在时无该诊断；`--dry-run`/真实安装后该诊断消失。
- [ ] AC6 jspace-use 文档不再出现"要装 harness-config 先读 harness-config"的循环指引；获取措辞指向 `jspace skills install`。
- [ ] AC7 全部门禁通过：`bunx tsc --noEmit`、`bun test`、`bun run scripts/gen-assets.ts` 后 `git diff` 干净（含新生成文件被跟踪）、`check-skills` / `check-harness-consistency` / `check-manifest-integrity` 全过；smoke（init + doctor 于 `/tmp/jspace-smoke`）通过。

## Non-goals

- 不做 release 资产下载 / 网络获取通道（嵌入即离线可用，符合"静态组合"哲学）。
- 不把 harness-config 内容并入 jspace-use（独立能力是产品意图，AGENTS.md 明确记载）。
- 不修改 harness-config 技能自身内容（其 Phase 1 手装指引作为无 CLI 场景的兜底保留）。
- cron 技能目标解析（`definitions.ts` 只查 workbench）维持现状：global 技能无 `entrypoints`，本就不该被 cron 定位。
- `harness wire` 的技能要求检查维持现状（global 技能不是 wire 的前置）。

## Key Decisions

- **D1 获取通道选嵌入，不选下载/删引用**：release 二进制 + 无仓库 clone 是 issue 报告的真实环境，下载通道引入网络依赖与发布流水线改动；删引用则砍掉已存在且被 check-skills 校验的完整能力。嵌入 568 行 md/sh 成本可忽略，且与全部官方技能同渠道分发。
- **D2 global 内容走独立生成模块，不混入 `ASSETS`**：`materializedRels` 对 `skills/` 前缀一律映射到工作台物化路径；若把 harness-config 嵌进 `ASSETS`，必须让 `materializedRels`/`materializeTree`/`diffBundle`/ownership 都感知 scope，"不进工作台"靠多点运行时检查维持。独立 `GLOBAL_SKILLS` map 让不变式成为结构保证（物化机制根本看不见它）。
- **D3 `install_source` → `install_path`**：该字段从未被当"来源"使用，嵌入方案下内容来源恒为 bundle，字段唯一语义就是安装目标。skills-manifest.json 是 build-time 仓库数据，不存在用户数据迁移。
- **D4 doctor 用 info 级**：global 技能是可选机器级治理件，缺失不是错误状态。

## Notes

- 复杂度定为 complex（跨 gen 管线 / 契约 / CLI / application 四层），故按流程补 `design.md` + `implement.md`。
