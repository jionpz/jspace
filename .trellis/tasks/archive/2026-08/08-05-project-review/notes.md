# Notes · 全项目 8 维专家评审

## 会话流水（2026-08-05）

- 用户要求「召开专家团队，review 整个项目」；确认口径：建 Trellis 任务 + 全量 8 维 + 报告（不改代码）。
- 规划三件套（prd/design/implement）+ implement.jsonl（7 条 spec 基准）→ G0 通过 → `task.py start`（in_progress，基线 cc7bb1e）。
- 工作流 `wf_e99e7e0f-fb1`：8 名专家并行发现（architect / typescript-reviewer×3 / security-reviewer / code-reviewer / general-purpose×2）→ 6 名对抗怀疑者验证 P0/P1。14 agents · 0 errors · 1.3M tokens。
- 原始 58 条 findings → 去重后 ~35 独立问题；8 条 P0/P1 全部 CONFIRMED（0 REFUTED）。
- 主循环抽查核验 3 条关键 P2（linux tag 下标、failIngest 标记碰撞、cron.json 非原子写）→ 全部属实。
- 综合报告写入 `report.md`；git 零改动（任务目录被 gitignore，验收通过）。

## 关键结论（详见 report.md）

- **P0**：GOAL.md 公开仓库泄漏真实数据（30GB/梯度公式/2 份真实资料）；连带 example-recall.md。需用户决策是否改写 git 历史。
- **P1×3（全 CONFIRMED）**：Win32 `cron install` argv 往返损坏（schtasks /tr）；doctor 与 tag-scoped 调度器身份漂移（macOS/Windows 永久误报 + legacy plist 双触发风险）；adapters↔application 层环。
- **主题主线**：cron 子系统新旧过渡态（M5 遗留）未收敛，是 P1×2 + P2×6 的根因 → 建议作为一条「cron 收敛」任务主线。

## 留给后续

- 修复不在本任务范围。建议后续任务：① 中性化 GOAL.md/example-recall（P0，需用户确认历史改写）② cron 子系统收敛（含 win32/doctor/linux/原子写/补测试）。
- spec 与实现双向漂移（directory-structure "no adapters/scheduler yet"、quality-guidelines 218/30、PLATFORMS.md 三处）→ 建议纳入常规 gate。
