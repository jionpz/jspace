# memory-recall 精准召回 skill — 执行计划

## 前置 gate（每次进入实施前复查）

- [ ] M4 验收已完成（两份真实语料入库 + 验收通过 + GOAL M4 标记完成）——本任务顺序依赖 M4。
- [ ] 用户已审阅并批准本计划（最终规划摘要）。

## 阶段 A：skill 源（REPO）

1. 写 `skills/memory-recall/SKILL.md`：frontmatter（`name: memory-recall` / `description` / `triggers`）+ 流程步骤（前置 → 语义查询 → 校验 → 指针断言链 → 作答引用 → 未命中校准）。纪律引用 MEMORY-ACCEPTANCE，不复制全文。
2. 写 `skills/memory-recall/references/discipline.md`：召回纪律细则（canonical 面约束 / 防假阳性 / 指针断言四连 / 未命中诊断五类 + 终止 / embedding 降级固定提示 / 双路径留证用途）。
3. **纪律一致性自检**：逐条对照 `docs/MEMORY-ACCEPTANCE.md`，skill 的断言链与诊断类别与协议一致（引用而非改写）。

## 阶段 B：工作台登记（REPO 模板）

4. `templates/workbench/AGENTS.md`：
   - 「Approved workbench skills」新增 `memory-recall`（一行描述：读侧精准召回，问一句→找数→引用出处）。
   - 「Brain operations」登记触发词（中文：问一句 / 找那个文件 / 那个数 / 精准召回；英文：recall / find the file）。
5. JSON/格式校验：frontmatter 合法；触发词与 SKILL.md 一致。

## 阶段 C：真实 JWorkspace 同步

6. 备份：`mkdir -p ~/.jspace-backup/memory-recall-<ts>/ && cp -r <workspace>/skills/ ...`（持久路径，非 /tmp）。
7. diff 预检：`diff -rq skills/ <workspace>/skills/` 列出差异，确认无本地待保留改动。
8. 复制 REPO `skills/memory-recall/` 进 JWorkspace（harness-config 不复制）。
9. 验证：`diff -rq -x harness-config skills/ <workspace>/skills/` 无输出；`jspace doctor --dir <workspace>` 通过。

## 阶段 D：演示验收（「问一句」跑通）

10. **前置（沿用 M4 canonical 面）**：gbrain serve 停泊窗口内；embedding 可达快照（`gbrain models doctor --json` embedding_reachability=ok）已记录。
11. 用 M4 已入库语料跑通 skill：Q1 类问题（会议纪要）→ top-1 正确页 → 指针断言四连全过 → 答案引用出处；Q2 类问题（ML 笔记）同理。
12. 未命中路径演示（可选，代价低时）：故意用无关措辞 → 走诊断 → 记录「现象→原因→结论」；embedding 不可达提示不静默。
13. 记录：每用例贴实际 query 输出 + 断言结果 + embedding 快照时间；真实证据落 `.trellis/tasks/08-03-memory-recall/notes.md`（非 git）。

## 阶段 E：产物落盘

14. 本任务 notes.md：真实证据（路径/断言输出/快照时间）+ 决策留痕。
15. 检查引用一致性：skill 引用的协议路径正确；README/AGENTS 无遗漏提及。

## 阶段 F：校验与提交（Phase 3）

16. **校验**：
    - `diff -rq -x harness-config skills/ <workspace>/skills/` 无输出
    - `jspace doctor --dir <workspace>` 通过
    - frontmatter / AGENTS.md 改动点 grep 断言（批准列表含 memory-recall、Brain operations 含触发词）
    - M4 验收不回归（已锁 slug/纪律未被改动；如触发修订，走 M4 授权流程留痕）
17. **trellis-check**：spec 对齐、无回归。
18. **提交**：REPO git commit（仅本任务相关文件；无 owner 路径泄漏）。

## 验证命令

```bash
diff -rq -x harness-config skills/ <workspace>/skills/          # JWorkspace 同步
jspace doctor --dir <workspace>                                  # 工作台健康
<gbrain> models doctor --json                                    # embedding 可达快照
<gbrain> query "历史数据迁移涉及多少存量?"                        # Q1 演示
<gbrain> get assets/<项目|领域>/<语义名>                          # 指针断言 ①
grep -c "<关键词>" "<Pointer>"                                   # 指针断言 ③
```

## 风险文件 / 回滚点

- **REPO skills/memory-recall + templates/workbench/AGENTS.md**（git 可回滚）。
- **JWorkspace skills/**（非 git）：改前备份 `~/.jspace-backup/memory-recall-<ts>/`；恢复 = `cp -r` 还原 + diff 验证。
- **gbrain 锁**：演示沿用 M4 canonical 面（serve 停泊窗口）；不 kill serve、不独立重启。
- **顺序依赖 M4**：M4 未完成时本任务仅规划，不实施。

## 交接要点

- 收工写回（memory-writeback）为分析识别的次缺口，已**另立任务**（实施后可再立项）。
- weekly-report / memory-consolidate 升格为 skill 属 watch 项（M4 最小契约决策暂不拆），真实使用暴露更多程序后再评估。
