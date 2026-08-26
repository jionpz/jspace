# M4 记忆精度打磨 — 执行计划

## 前置 gate(每次进入实施前复查)

- [ ] 用户已审阅并批准本计划(最终规划摘要)。
- [ ] **锁处置已与用户确认**:协调结束持锁会话 86973(禁 kill serve / 禁独立重启)。
- [ ] 会议纪要归属已由用户定夺为**归位到具体项目/领域**(不允许「跳过」;若跳过 → Q1 降级为不验收,记录原因)。

## 阶段 A:环境准备

1. **记录锁现状**:`ps -o pid,ppid,etime,command -p 86989` + 86973(证据留档,不依赖此状态做判断)。**本阶段不做 gbrain 深度检查**(serve 持锁时 models doctor 被阻断)。
2. **刷 JWorkspace skills**:
   - 备份:`mkdir -p ~/.jspace-backup/m4-<ts>/ && cp -r /Users/jionpz/jspace-work/skills/ ~/.jspace-backup/m4-<ts>/`(持久路径,非 /tmp)。
   - **覆盖前 diff 预检**:`diff -rq skills/ /Users/jionpz/jspace-work/skills/` 列出差异清单,记入验收文档,确认无本地待保留改动后再覆盖。
   - 复制 REPO `skills/`(含 asset-ingest / jspace-bootstrap)覆盖 JWorkspace;harness-config 不复制(非模板技能)。
   - 验证:`diff -rq -x harness-config skills/ /Users/jionpz/jspace-work/skills/` 无输出。
3. **确认验收素材**:`jspace doctor --dir /Users/jionpz/jspace-work`(hub/filehub 校验)+ `_inbox/` 2 文件在位。

## 阶段 B:锁处置 + 端到端入库

4. **锁处置(用户协调)**:协调用户结束 86973 会话 → 确认 `gbrain serve` 已退出(`ps` 无 gbrain serve)→ 锁释放。**禁 kill serve 子进程、禁独立重启**。serve 保持停止直到阶段 C 记录完毕。
5. **embedding 可达快照(硬性)**:`~/.bun/bin/gbrain models doctor --json` → 记录 embedding_config / embedding_reachability;不可达 = 环境故障,**阻塞验收,不进校准循环**。
6. **入库(asset-ingest 真实流程,serve 停泊窗口内)**:
   - 第一遍确定性处理:机器学习笔记 → 归位 `areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md` → gbrain reference `assets/机器学习/机器学习基础-第二章笔记`(M2 纪律,embedding 正常写)→ **首文件建 `areas/机器学习/index.md`**(文件名+日期+slug 行)。
   - 第二遍:会议纪要归属短清单 → 用户定夺归位到具体项目/领域 → 归位 `projects/<项目>/...` + 写页 + 项目 index 登记。
7. **召回自检**:`gbrain query <关键词>` 确认命中(不得静默)。

## 阶段 C:召回验收(canonical=CLI,serve 停泊窗口内)

8. **四条逐字固定规范查询 + 稳定性 + 负对照**:
   - Q1 `历史数据迁移涉及多少存量?` → 会议纪要页
   - Q1' `那 30 个 G 的数据怎么搬?` → 会议纪要页(负对照:ML 页不得排第一)
   - Q2 `MSE 损失对 w 的梯度是什么?` → ML 笔记页
   - Q2' `损失函数怎么对参数求导?` → ML 笔记页(负对照:会议页不得排第一)
   - 每条连续 ≥3 次重跑,全 top-1 才算过。
   - **双路径留证**:每条同时记录 `gbrain search <query>` 与 `gbrain query <query>` 输出,证明语义层加分。
9. **指针断言序列(四连过才计该用例过)**:
   - ① `gbrain get <slug>` → 取 Pointer 字段
   - ② `test -f "<Pointer>"` 成立
   - ③ `grep -c "30GB" "<Pointer>"` ≥1(ML 笔记用 `grep -c "∂L/∂w"`)
   - ④ `gbrain query` 输出 top-1 slug == 目标 slug
10. **记录**:每用例贴实际 `search`/`query` 原始输出(含 top-N 与命中页 slug)、重跑次数、embedding 快照时间。

## 阶段 D:校准循环(仅未命中;≤3 轮)

11. 诊断类别:slug / tags / embedding 配置 / 查询措辞 / 纪律缺口。
12. **REPO 修正**(源)→ 刷 JWorkspace → 重跑;每处记录「现象→原因→修正→重跑结果」。≥2 次稳定 top-1 才算过。
13. **终止**:3 轮未过 → 显式终态二选一(接受关键词降级记入验收文档 / 上报用户)。embedding 不可达 = 环境故障,不进循环。
14. ROI 护栏:配置/措辞类只记入验收文档,不改纪律。

## 阶段 E:产物落盘

15. 写 **REPO 中性版** `docs/MEMORY-ACCEPTANCE.md`:`<filehub>`/`<workspace>` 占位,无 owner 路径/真实文件名/PID;含前置/用例(四条查询+断言)/校准终止/操作约束(锁时序、embedding 快照)/基线标注。**真实证据**写 `.trellis` 任务记录 + JWorkspace(非 git)。
16. **gbrain.md 纪律修订**:新增「dated memory record(周快照)」写模式(note+日期 slug=每周新页,当前状态由 `project/<id>/state` 承担;注明注入取舍)。
17. **模板 cron.json**:weekly-report / memory-consolidate `enabled:true`;契约**内联进 prompt**(目标位置/slug/写语义),禁「见 design.md」;JSON 校验。**真实 JWorkspace cron.json 原地编辑**(仅翻转 enabled+更新 prompt,其余任务不动;改前备份 `cp ... ~/.jspace-backup/m4-<ts>/` + JSON 校验)。
18. `GOAL.md`:去重 M4 两行、改描述为「校准召回+端到端验收(不重设 M2 已锁 slug 骨架)」、标记完成、更新日期。
19. 若有 skill 纪律修正 → 检查 README/AGENTS 引用一致性。

## 阶段 F:校验与提交(Phase 3)

20. **校验**(serve 停泊窗口内读回):
   - `diff -rq -x harness-config skills/ /Users/jionpz/jspace-work/skills/` 无输出
   - `jspace doctor --dir /Users/jionpz/jspace-work` 通过
   - 模板 + 真实 cron.json JSON 合法(`python3 -m json.tool`);prompt 内契约可 grep(不含「见 design.md」)
   - gbrain 页读回 `gbrain get <slug>`(serve 停泊窗口内)
   - `bun run cli/main.ts --version` 回归
21. **trellis-check**:spec 对齐、无回归。
22. **提交**:REPO git commit(清理 docs/ 无 owner 路径;`version.generated.ts` 保持 `0.0.0-dev` 占位)。

## 验证命令(canonical=CLI,serve 停泊窗口内)

```bash
diff -rq -x harness-config skills/ /Users/jionpz/jspace-work/skills/
jspace doctor --dir /Users/jionpz/jspace-work
~/.bun/bin/gbrain models doctor --json            # embedding_reachability 快照(锁释放后)
~/.bun/bin/gbrain query "历史数据迁移涉及多少存量?"   # Q1
~/.bun/bin/gbrain query "那 30 个 G 的数据怎么搬?"    # Q1'
~/.bun/bin/gbrain query "MSE 损失对 w 的梯度是什么?"  # Q2
~/.bun/bin/gbrain query "损失函数怎么对参数求导?"      # Q2'
~/.bun/bin/gbrain search "历史数据迁移涉及多少存量?"  # 关键词对照(双路径留证)
~/.bun/bin/gbrain get assets/机器学习/机器学习基础-第二章笔记   # 指针断言 ①
grep -c "30GB" "<Pointer>"                          # 指针断言 ③
```

## 风险文件 / 回滚点

- **REPO skills references / 模板 cron.json / GOAL.md**(git 可回滚)。
- **JWorkspace skills/、cron.json**(非 git):改前备份到 `~/.jspace-backup/m4-<ts>/`(持久),恢复 = `cp -r` 还原 + `diff -rq` 验证;cron.json 改坏 → 还原备份。
- **filehub 移动 / gbrain 页**:asset-ingest 撤销路径(移回 `_inbox/`、`gbrain delete` 软删);会议纪要归属改动用户在场确认。
- **gbrain 锁**:不 kill serve、不独立重启;协调结束 86973,恢复 = 该会话重连/正常结束;失败即停、不绕过锁。

## 交接要点

- 机器端 install 与首次实跑(cron run)属后续动作;验收文档含 **rehearsal gate**(install 前先 `jspace cron run` 各一次核对产出位置/slug 后再启用)。
- 若用户选择在 86973 会话内做 gbrain 操作(而非结束它),本计划阶段 B/C 改为「在 86973 内经 MCP 执行入库/查询」,canonical 面随之切换,需保持三份文档同步。
