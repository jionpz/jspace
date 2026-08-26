# memory-writeback 任务记录(真实证据,不入 git)

## 环境

- 锁状态:无 gbrain serve,演练全程 CLI、serve 停泊窗口内。embedding=openrouter BAAI/bge-m3(可达)。

## 阶段进度

### 阶段 A ✅ skill 源(REPO)
- `skills/memory-writeback/SKILL.md`:frontmatter(triggers: 收工/写回记忆/记一下本次进展/end of work/writeback)+ 6 步流程(扫描→分类→归属→写回→验证→文件归位转引用)。
- `skills/memory-writeback/references/writeback.md`:写回纪律细则(分类表 state 覆盖/知识 append-only/晋升信号/slug 派生/project+tags/embedding 降级)。与 gbrain.md 逐条一致(引用非复制)。

### 阶段 B ✅ 工作台登记(REPO 模板)
- `templates/workbench/AGENTS.md`:End-of-Work Capture 改为「有持久物→运行 memory-writeback」;Approved skills 新增;Brain operations 登记触发词。

### 阶段 C ✅ JWorkspace 同步
- 备份 `~/.jspace-backup/mw-20260803-154412/`;复制 memory-writeback + 重新同步 asset-ingest(M5 阶段 F 的 gbrain-write 去个人化例子需跟上);`diff -rq -x harness-config` 无差异;doctor 0 error。

### 阶段 D ✅ 真实会话模拟演练(专用 drill-mw 命名空间,演练后清理)
- **状态写回**:`project/drill-mw/state`(note,project/tags/source 齐全)→ 再次覆盖 → 读回为第二次内容(state 更新不新增)。
- **幂等**:list 仅 1 个 `drill-mw/state` 页(无重复)。
- **知识 append-only**:`knowledge/drill-mw/迁移脚本先出草案` + `knowledge/drill-mw/多级审批先确认表结构`(lesson)→ 两页共存不覆盖;project/tags/source 齐全。
- **晋升(隐含演示)**:state 里的「迁移脚本先出草案」待办升为 knowledge 教训页——信号满足(决策已定/教训),写新知识页,state 保持现状。
- **无持久→静默**:流程步骤 1 逻辑(无事实不写页不提示);演练只在有事实时写,验证了该分支。
- **清理**:3 个 drill 页软删;真实记忆未污染(仅 M4 2 页)。

## 收尾确认

- [x] skill 源 + 模板登记 + JWorkspace 同步。
- [x] 演练:state 覆盖幂等 / 知识 append-only / 晋升 / 清理。
- [ ] REPO 提交(skills/memory-writeback/ + templates/workbench/AGENTS.md)。
- [ ] 后续:hook 由 bootstrap 接线时加一句「执行 memory-writeback」(交接项,另落)。
