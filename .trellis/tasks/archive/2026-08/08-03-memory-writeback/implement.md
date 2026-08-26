# memory-writeback 收工记忆写回 skill — 执行计划

## 前置 gate（每次进入实施前复查）

- [ ] 用户已审阅并批准本计划（最终规划摘要）。
- [ ] gbrain 锁状态确认（演练在 serve 停泊窗口内 CLI；禁 kill serve / 禁独立重启）。

## 阶段 A：skill 源（REPO）

1. 写 `skills/memory-writeback/SKILL.md`：frontmatter（`name`/`description`/`triggers`：收工 / 写回记忆 / 记一下本次进展 / end of work）+ 6 步流程（扫描 → 分类 → 归属 → 写回 → 验证 → 文件归位转引用）。
2. 写 `skills/memory-writeback/references/writeback.md`：写回纪律细则（分类表 state 覆盖 / 知识 append-only / 晋升信号 / slug 派生 / project+tags / embedding 降级）。
3. **纪律一致性自检**：逐条对照 `skills/jspace-bootstrap/references/gbrain.md` 写回纪律，skill 引用而非改写；与 asset-ingest / memory-recall 命名空间不重叠。

## 阶段 B：工作台登记（REPO 模板）

4. `templates/workbench/AGENTS.md`：
   - 「End-of-Work Capture」改为引用 memory-writeback skill（散文保留为「何时触发」提示，不双写纪律）。
   - 「Approved workbench skills」新增 memory-writeback 行。
   - 「Brain operations」登记触发词（收工 / 写回 / 记一下进展 / end of work）。
5. 格式校验：frontmatter 合法；触发词与 SKILL.md 一致。

## 阶段 C：JWorkspace 同步

6. 备份 `~/.jspace-backup/mw-<ts>/` → diff 预检 → 复制 REPO `skills/memory-writeback/` 进 JWorkspace → `diff -rq -x harness-config` 无差异 + `jspace doctor` 通过。

## 阶段 D：真实会话模拟演练（serve 停泊窗口内 CLI）

7. **状态写回**：造「报表模块」会话（进展 + 一条教训）→ 按 skill 写 `project/报表模块/state`（覆盖）+ `knowledge/报表模块/<教训>`（新页）→ `gbrain get` 读回验证 project/tags/source 齐全。
8. **覆盖 + 幂等**：再次写同 slug → state 页更新不新增；知识页不重复建。
9. **晋升**：重复事实 → 触发晋升写知识页（记录信号）。
10. **无持久 → 静默**：无事实会话 → 无页写入、无提示。
11. **不回归**：asset-ingest / memory-recall 契约不动；已有 reference 页不因演练改变。

## 阶段 E：产物落盘 + 提交

12. notes.md：真实证据（演练各步 slug / 读回输出 / 锁时序）。
13. 校验：`diff -rq -x harness-config` 无差异；`jspace doctor` 通过；`bunx tsc --noEmit`；`bun run cli/main.ts --version`；去个人化（无 owner 路径）。
14. 提交：REPO git commit（仅本任务文件）。

## 验证命令

```bash
diff -rq -x harness-config skills/ ~/jspace-work/skills/     # 同步
jspace doctor --dir ~/jspace-work                              # 工作台健康
<gbrain> get project/报表模块/state                            # 状态页读回
<gbrain> get knowledge/报表模块/<主题>                         # 知识页读回
<gbrain> list -n 10                                            # 无重复页
```

## 风险文件 / 回滚点

- **REPO skill + 模板**（git 可回滚）。
- **JWorkspace skills**（非 git）：改前备份 `~/.jspace-backup/mw-<ts>/`。
- **演练写的 gbrain 页**：演练用临时 slug（如 `project/drill-<日期>/state`）或演练后清理（`gbrain delete` 软删），不污染真实 memory；真实页只在用户在场时写。
- **锁时序**：不 kill serve / 不独立重启；失败即停。

## 交接要点

- harness 会话结束 hook 由 bootstrap 接线；本 skill 是可执行体，bootstrap 文档可加一句「hook 执行 memory-writeback」。
- 晋升信号是判断题：skill 给信号，边界策略留给涌现（记入 skill 的「留给涌现」注）。
