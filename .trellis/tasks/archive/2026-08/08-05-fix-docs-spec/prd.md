# 文档与 spec 同步

## Goal

消除评审确认的文档/实现漂移：docs、模板、spec 三处与代码现状对齐；并修正 spec 中描述落后于实现的反向漂移。

## Requirements

1. **PLATFORMS.md**：plist 名改 tag-scoped（`com.jspace.cron.<tag>.<id>.plist`）；crontab 标记改 `# jspace crons (managed) DO NOT EDIT`；「tag 注入未落地」段落改写为已落地（scheduler adapters）；doctor 断言表与现状一致。
2. **templates/workbench/README.md**：结构清单补 `memory-recall` / `memory-writeback` 两个 skill（与 AGENTS.md 4 个对齐）。
3. **AGENTS.md / jspace-bootstrap SKILL.md 刷新路径**：`jspace init --force .`（已确认死路，init 对已有 marker 硬失败）改为 `jspace workspace upgrade --dry-run` → `jspace workspace upgrade`。
4. **.trellis/spec/backend/directory-structure.md**：删去「no adapters/scheduler yet」过时陈述；如实记录 adapters/scheduler 现状与真实反向边（在层环收敛修复后更新，或标注过渡态）。
5. **.trellis/spec/backend/quality-guidelines.md**：测试数 218/30 → 当前实际（267/34，或改为不写死数字只保留 gate）。
6. **README.md**：示例路径 `~/jspace-work` 改中性占位（如 `~/jworkspace`）——与 fix-p0-redline 分工：本任务管路径占位，P0 管真实数据点。
7. 模板/skill 文档改动后重跑 `gen-assets`（若影响嵌入资产）。

## Acceptance Criteria

- [ ] 上述 6 处文档全部与代码现状一致；改后 `git diff` 复核无遗留过时断言。
- [ ] 模板文档改动触发 gen-assets 的已同步；`git diff --exit-code cli/*.generated.ts` 通过（如受影响）。
- [ ] spec 与代码一致性的「反向漂移」已消除（spec 不再声称代码不存在的东西）。
- [ ] `bun test` + `tsc --noEmit` 绿（纯文档改动也应验证不破坏任何引用测试，如 assets-reachability 可能断言模板文本）。
- [ ] 若依赖 cron 收敛（directory-structure 层环描述），标注执行顺序。

## Notes

- 轻量任务：PRD-only 有效。
- 执行顺序：建议在 fix-cron-convergence 之后做（PLATFORMS/directory-structure 描述将引用收敛后的真实状态）。
