# Notes · 评审修复（父任务）

## 集成验证（2026-08-05）

5/5 子任务完成并提交到 main：

| 子任务 | commit | 摘要 |
|---|---|---|
| fix-p0-redline | `2260aac` | GOAL.md + 4 技能文档中性化真实数据；顺手修主分支既有 tsc 红（DiffAction "migrate"） |
| fix-cron-convergence | `b131638` | 层环破 + win32 argv + doctor tag-scoped + linux tag/no-op + delete-only + 原子写 + darwin env.home |
| fix-reliability | `e916532` | failIngest 标记碰撞（改 1 固化 bug 测试）/ run·incident 原子写 / 空页 / 日志名 / dry-run hub / init--force 备份 |
| fix-test-coverage | `4ff17df` | doctor(6) / cron 用例(5) / filehub(4) / darwin tag 过滤 / handler 接线(4) = +20 测试 |
| fix-docs-spec | `bd2f613` | PLATFORMS 4 处 / 模板刷新路径改 upgrade / skill 清单补全 / README·AGENTS 占位 / spec 同步 |

追加：`invocation.test.ts` 夹具 `jspace-wb`→`jworkspace`。

## 父任务验收核对

- [x] 5 子任务全部实现；`bunx tsc --noEmit` 绿、`bun test` **297 pass / 38 files**
- [x] gen-assets 确定性 gate 绿（`git diff --exit-code cli/*.generated.ts`）
- [x] 真实数据复扫清零（`30GB|梯度公式|机器学习基础|2 份真实资料|真实验收|jspace-work|jspace-wb` 均无命中）
- [x] git 工作树干净
- [ ] **doctor 真机回归**：macOS `cron add → install → doctor` 无误报 —— 需真实系统调度器，**待用户授权后执行**（dry-run 冒烟已验证装配）

## 待用户执行（延期项）

1. **P0 历史改写**（用户已选「改写历史 + force push」）：runbook 在 `fix-p0-redline/notes.md`（filter-repo + 7 条替换规则 + 备份 + force push），需终端手动确认。
2. **push 到 origin/main**：当前 7 个 commit 均在本地。
3. **真实 doctor 回归**（可选项，动真实 LaunchAgents）。
