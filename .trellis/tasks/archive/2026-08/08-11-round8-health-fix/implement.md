# Implement — Round 8 健康审查修复 (issue #9)

## 执行顺序（串行，按 issue 推荐合入顺序）

1. **#9-01 [P1-6]** 模板 workbench-retro slug 对齐
   - 改 templates/workbench/.jspace/cron.json 的 input slug；同步 grep 其它模板/seed 与 migrate 脚本、skills 引用
   - 重跑 `bun run scripts/gen-assets.ts` 物化；check-skills + check-manifest 绿；/tmp/jspace-smoke 新 init 验证无旧 slug
2. **#9-02 [P1-1]** doctor checkGBrain JSON 兜底 → 新增 doctor.test.ts 非法 JSON 用例
3. **#9-03 [P1-2]** doctor readJson lambda 兜底 → 同测试文件补用例
4. **#9-04 [P1-3]** 调度器外部命令统一 timeout（linux/win32/darwin）→ 测试断言 timeout 透传
5. **#9-05 [P1-4]** Windows cron add 前置 isWindowsInstallable → use-cases.test.ts 增补
6. **#9-06 [P1-5]** AGENTS.md 命令面对齐 → 文档 review
7. **#9-07 [P2-1]** tomlSkillsDirWired section 作用域 → 单测含干扰用例
8. **#9-08 [P2-2]** 备份原子写 → 现有测试不变
9. **#9-09 [P2-3]** 文档口径漂移三连 → check-skills / 文档 review

## 验证命令（每子项 + 最终）

- 单子项：改后针对性测试（bun test <目标文件>）+ tsc
- 最终验收：
  ```bash
  bunx tsc --noEmit && bun test \
    && git diff --exit-code cli/*.generated.ts adapters/harness/capabilities.generated.ts \
    && bun run scripts/check-skills.ts \
    && bun run scripts/check-harness-consistency.ts \
    && bun run scripts/check-manifest-integrity.ts
  ```

## 审查门（review gates）

- 每子任务 `task.py start` 前：该子项 prd 与父级要求面核对
- 每子项完成：针对性回归通过 + 复测证据写入该子任务 notes
- 最终：全部 9 子项闭环 + 验收命令全绿后，父任务收尾并 commit

## 回滚点

- 每子项独立 commit，可单独 revert；commit footer 以 (issue #9 #9-xx) 链接
