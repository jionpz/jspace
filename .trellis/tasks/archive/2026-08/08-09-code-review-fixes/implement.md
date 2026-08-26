# Issue #2 修复 — 总执行计划

## 批次顺序与门禁

每批次:`task.py start <child>` → 实现 → 全仓验证 → `task.py finish` → commit → 下一批。

| 序 | 批次 | 激活 | 完成后 |
|---|---|---|---|
| 1 | 08-09-p0-correctness-deadlinks | task.py start | bun test + tsc 绿 → finish → commit |
| 2 | 08-09-p1-ci-gaps | 同上 | 同上 |
| 3 | 08-09-p2-data-integrity-refactor | 同上 | 同上 |
| 4 | 08-09-p2-architecture-cleanup | 同上 | 同上 |
| 5 | 08-09-p3-p4-docs-structural | 同上 | 同上 |

## 每个批次内执行

1. 读该批次 prd.md + 本 design.md(架构批)。
2. 对每项:定位代码 → 修 → 补回归用例(issue 要求的)。
3. 改动 `templates/` 的批次:重跑 `bun run scripts/gen-assets.ts`。
4. 验证命令(每批完成后):
   - `bun test`(全仓,目标 ≥409 全绿)
   - `bunx tsc --noEmit`
   - 相关 python 回归:`python3 skills/asset-ingest/scripts/extract.test.py`(P3 批)
   - `git status` 检查无未同步 generated 文件
5. `task.py finish` → 独立 commit(commit 信息含 issue 编号 + 批次)。

## 验证 / 回滚

- 每批 commit 前是回滚点;某批红 → 只回滚该批文件,重来。
- 主工作台回归:`cd ~/jspace-work && jspace doctor`(本地开发版二进制或 `bun run cli/main.ts` 视仓库脚本而定)保持 0 warning。
- 全 5 批完成后,回到父任务:复核跨子任务 AC → 告知用户,由 jionpz 决定是否关闭 issue #2(不自行动 close)。

## 风险点

- **P2-2 hub contract 改动**:影响主工作台真实 hub.json → 先读现有 hub.json 确认形态,再决定重建 / 兼容读;在子任务内单独 review gate。
- **P2-1 scheduler 端口重构**:多 adapter + application 两处联动 → 先 P1-3 瘦身、后 P2-1 重构,每步跑 scheduler 相关测试。
- **CI 配置改动(P1-1/P3-1)**:无法本地全量跑 CI,改完后人工 review workflow 语法(`bunx actionlint` 若有,否则 yaml 校验) + 提 PR 观察。
