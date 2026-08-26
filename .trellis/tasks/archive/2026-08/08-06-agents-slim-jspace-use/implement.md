# Implement — AGENTS 块瘦身 + jspace-use 承接治理细节

## 执行清单

- [ ] **S1 重写模板散文** `templates/workbench/AGENTS.md`
  - 保留：块头注释（JSPACE:START 受管块说明）、`## Brain operations` + `TRELLIS-BRAIN-OPS` 区间、`## Skill Governance` 中 `TRELLIS-SKILL-GOV` 区间 + 其「区间内由 gen-assets 渲染」说明行、`<!-- JSPACE:END -->`。
  - 重写：定位段精简 + gbrain 一句；`## Modes` / `## Language` / `## Daily Work Intake` / `## Durable Knowledge Routing` / `## Agents` / `## Confirmation Rules` / `## End-of-Work Capture` / `## Quality Checks` 保留（措辞可微调）。
  - 精简：`## Domain Governance` → ~6 行（涌现原则 + 指向 jspace-use 第 8 章）；`## Resource Governance` → ~4 行（入口概念 + 指向 references/registry.md）；`## Registry Access` 保留三文件 + doctor 入口；`## Development Mode` 收敛 3 步 + 升级句指 README；`## Scheduled Tasks (cron)` → ~2 行（session start 跑 cron check + 上报；细节→第 8 章）。
  - 新增：定位段后加 R2 指针行。
  - 目标：块内正文 ≤ ~110 行。

- [ ] **S2 新增 jspace-use 第 8 章** `skills/jspace-use/SKILL.md`
  - 追加「## 8. 治理细节」：域（创建信号 / 最小形态 / 确定度分级 / 何时加 AGENTS|runbook）；资源（schema/drift → references/registry.md）；skill（提议信号 / 禁区 / 用户确认）；cron（session start 契约 / 定义即代码 / rehearsal gate / → references/headless-ops.md）。
  - 同步「## 按需深入」与「## 参考」指针列表（如第 8 章承接内容需列出）。
  - 清理：删去与 AGENTS 块重复/互推的句子（如「此处不复制，读那两处」），保持 AGENTS → 第 8 章单向承接；保留第 1 章所有权模型正文。
  - 不改 frontmatter（name/description/triggers）。

- [ ] **S3 重跑生成并校验无漂移**
  - `bun run scripts/gen-assets.ts`（或项目约定的 gen-assets 命令，见 package.json）。
  - `git diff -- templates/workbench/AGENTS.md` 应只含 S1 的散文改动 + 生成块字节一致；若有生成块 diff → 检查 frontmatter 是否被误改。
  - 必要时重跑 `build`（gen-assets 输出 `cli/assets.generated.ts` / `manifest.generated.ts` 变更时）。

- [ ] **S4 静态与测试**
  - `bun tsc` 通过。
  - 全部测试通过（init / upgrade / agents-block / workspace / skills 相关）。
  - `bun run scripts/check-skills.ts`（C1–C4）通过。

- [ ] **S5 行为验证**
  - 临时目录 `jspace init` → `jspace doctor --dir .` 0 error；读生成的 AGENTS.md 确认精简块 + 生成块完整。
  - 对既有带 marker 工作台 `jspace workspace upgrade --dry-run`：AGENTS.md 显示 `block-update`，块外内容不动。

- [ ] **S6 评审门（review gate）**
  - diff review：生成块 marker 区间与字节、块头注释、指针行、第 8 章内容与 AGENTS 移除信息一致、无互推句残留。
  - 行数复核：`wc -l templates/workbench/AGENTS.md` ≤ ~110（正文）。

## 验证命令

```bash
bun run scripts/gen-assets.ts          # 重渲染生成块
bun tsc                                # 类型
bun test                               # 单测（init/upgrade/workspace/skills）
bun run scripts/check-skills.ts        # skill 契约 C1-C4
# 临时 init + doctor:
tmp=$(mktemp -d) && jspace init "$tmp" --yes && jspace doctor --dir "$tmp" && rm -rf "$tmp"
# 已有工作台 upgrade 预览:
jspace workspace upgrade --dry-run --dir <workbench-root>
```

## 评审门

- 提交前核对：生成块（Brain ops / Skill Gov）字节与任务前一致；块头注释未丢；R2 指针在；第 8 章信息完整。
- 若任何检查红：回到对应步骤修复，不跳过。

## 回滚点

- 源码：`git revert <commit>`（S3 生成物随模板/SKILL 一并还原）。
- 工作台侧（若已 upgrade）：`jspace workspace upgrade --rollback <id>`。
