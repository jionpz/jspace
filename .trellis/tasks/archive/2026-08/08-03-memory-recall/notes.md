# memory-recall 任务记录(真实证据,不入 git)

## 环境与顺序

- 顺序依赖 M4 已满足:M4 验收通过并归档(commit `0e9f5be` + `0a9066b`;任务已 archive)。语料已在位:会议纪要 → `projects/报表模块/` + `assets/报表模块/会议沟通记录`;ML 笔记 → `areas/机器学习/` + `assets/机器学习/机器学习基础-第二章笔记`。
- gbrain 锁已释放(86973/gbrain serve 已退出),验收全程 CLI、serve 停泊窗口内。
- embedding 快照:`gbrain models doctor --json` → `openrouter:BAAI/bge-m3`,`embedding_reachability: ok`。

## 阶段进度

### 阶段 A ✅ skill 源(REPO)
- `skills/memory-recall/SKILL.md`:frontmatter(name/description/triggers: 问一句/找那个文件/那个数/精准召回/帮我找/recall/find the file)+ 5 步流程(语义查询 → 校验 → 指针断言链 → 作答引用 → 未命中校准 ≤3 轮)。
- `skills/memory-recall/references/discipline.md`:纪律细则(canonical 面 / 防假阳性 / 断言四连 / 稳定性双路径 / 诊断五类+终止 / embedding 降级)。与 `docs/MEMORY-ACCEPTANCE.md` 逐条一致(引用非复制)。

### 阶段 B ✅ 工作台登记(REPO 模板)
- `templates/workbench/AGENTS.md`:"Approved workbench skills" 新增 memory-recall 行 + "Brain operations" 登记触发词(`问一句 | 找那个文件 | 那个数 | 精准召回 | 帮我找 | recall`)。

### 阶段 C ✅ JWorkspace 同步
- 备份 `~/.jspace-backup/memory-recall-20260803-145103/`;diff 预检干净。
- ⚠️ 一次 cp 语义失误:`cp -r skills/memory-recall/ dest/` 尾斜杠把内容直落 dest,产生杂散 `skills/SKILL.md` + `skills/references/`;已 rm 修正 + 正确复制 `skills/memory-recall/`。
- 验证:`diff -rq -x harness-config skills/ <workspace>/skills/` 无差异;`jspace doctor --dir <workspace>` 0 error(3 warning = 三 cron 未 install,属显式后续)。

### 阶段 D ✅ 演示验收(「问一句」跑通)
- Q1 `历史数据迁移涉及多少存量?` → top-1 `assets/报表模块/会议沟通记录` → Pointer 存在 → `grep "30GB"`=1 → 四连全过。答案:约 30GB 存量(迁移方案待定),引用 `/Users/jionpz/filehub/projects/报表模块/2026-07-会议沟通记录.txt` + slug。
- Q2 `MSE 损失对 w 的梯度是什么?` → top-1 `assets/机器学习/机器学习基础-第二章笔记` → Pointer 存在 → `grep "∂L/∂w"`=2 → 四连全过。答案:`∂L/∂w = (2/n)Σ x_i(w·x_i + b - y_i)`,引用 `/Users/jionpz/filehub/areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md` + slug。
- 校准未触发(首跑全过);embedding 降级提示路径未演示(可达场景下无触发)。

## 收尾确认

- [x] REPO skill + 模板登记 + JWorkspace 同步,全部落位。
- [x] 演示验收通过(两问四连全过)。
- [x] M4 验收不回归(未改 M4 已锁 slug/纪律)。
- [ ] REPO 提交(skills/memory-recall/ + templates/workbench/AGENTS.md)。
- [ ] 后续(另立/watch):收工写回 memory-writeback;weekly-report/memory-consolidate 升格评估;M5 换机重建。
