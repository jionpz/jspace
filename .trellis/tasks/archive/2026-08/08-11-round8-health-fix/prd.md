# Round 8 全量健康审查修复 (issue #9) — P1+P2

## Goal

修复 issue #9 全量健康审查认定的 9 项偏差（P1×6 + P2×3）。单一事实源：GitHub issue #9（正文含各子项文件定位、动作与回归要求）；本文件为任务级要求面，子项各自 prd 见对应子任务。

## Requirements

按合入顺序（先止血后统一）：

1. **#9-01 [P1-6]** 模板 workbench-retro slug 对齐：`memory/retro` → `records/retro`，新 init 的 workbench 不再生成已迁移路径。
2. **#9-02 [P1-1]** doctor `checkGBrain` JSON.parse 崩溃兜底：非法 JSON 降级为结构化 info，不再整体崩溃。
3. **#9-03 [P1-2]** doctor 注入 readJson lambda 解析异常兜底：返回结构化失败供上层转 info。
4. **#9-04 [P1-3]** 调度器三平台外部命令统一经 timeout 保护（gbrain 同款红线），不允许裸阻塞 spawnSync。
5. **#9-05 [P1-4]** cron add 在 Windows 与 install 一样显式拒绝不可安装调度（消除 PLATFORMS.md 超卖）。
6. **#9-06 [P1-5]** AGENTS.md 命令面与真实 CLI 对齐（移除 registry、补齐 update/inbox）。
7. **#9-07 [P2-1]** tomlSkillsDirWired 严格限定目标 section。
8. **#9-08 [P2-2]** 备份走原子写。
9. **#9-09 [P2-3]** 文档计数/口径漂移三项。

## Acceptance Criteria

- [ ] 逐项修复，每条交付物含「代码/文档 + 针对性回归测试 + 复测证据」。
- [ ] 全部过：`bunx tsc --noEmit`、`bun test`、`gen-assets fresh 无 diff`、三 check 脚本（skills/harness/manifest）绿。
- [ ] commit footer 以 (issue #9 #9-xx) 互相链接，PR/提交按 P1 独立拆分。

## Notes

- 关键决策（详见 design.md）：先止血后统一；P1-4 选改代码对齐文档；gbrain 红线平移而非新建抽象。
- 非目标：不重排 Round 7 已闭环结论；不修主线程 Shell/Read 工具缓存污染；不引入 M6 之后新需求。
- 来源证据文档 `_issues/2026-08-11-round8-full-health-review.md` 本地缺失，以 issue 正文为唯一事实源。
