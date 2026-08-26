# M5 分发 — 执行计划

## 前置 gate(每次进入实施前复查)

- [ ] 用户已审阅并批准本计划(最终规划摘要)。
- [ ] M4 已验收通过并归档(M4 语料在位:`assets/报表模块/会议沟通记录` + `assets/机器学习/机器学习基础-第二章笔记`,Pointer/rel_path 齐全)。
- [ ] 演练前 A 侧 serve 锁状态确认(禁 kill serve / 禁独立重启;占用则协调停泊窗口)。

## 阶段 A:前置 probe(验证机制前提,全部 CLI)

1. **gbrain 多 brain 机制**:实测 `gbrain --help` / `gbrain init --help` 是否支持 `--home`/`--dir`/env;记录 B brain 隔离方案。
2. **export 产物 probe**:`gbrain export --dir ~/.gbrain-export` → 检查产物结构(是否含图谱边/backlink、frontmatter 字段);记录「边/backlink 是否随导出」。
3. **embedding 可达快照**:`gbrain models doctor --json` → 记录 A 侧 embedding provider / reachability(不可达 = 环境故障,降级方案见阶段 D)。

## 阶段 B:指针方案落地(REPO 源,先改源再演练)

4. **纪律修订**(REPO):
   - `skills/asset-ingest/references/gbrain-write.md`:写页模板新增 `rel_path:` frontmatter(相对 filehub 根)。
   - `skills/asset-ingest/SKILL.md`:步骤 3「入脑」加 rel_path 计算(Pointer 去 filehub 根前缀;根从 hub.json `type: filehub` primary path 读)。
   - `skills/memory-recall/references/discipline.md`:§3 指针断言适配换机解析;新增 §8 换机解析规则(读目标机 hub.json 根 + rel_path → 重解析 → test -f)。
   - `docs/MEMORY-ACCEPTANCE.md`:新增「换机解析扩展(M5)」中性节(rel_path 规则 + B 侧断言),原用例/断言不动。
5. **刷 JWorkspace**:备份 `~/.jspace-backup/m5-<ts>/` → diff 预检 → 复制 REPO skills → `diff -rq -x harness-config` 无差异 + `jspace doctor --dir ~/jspace-work` 通过。
6. **存量页补 rel_path**:给 A 侧 2 个 reference 页(`assets/报表模块/会议沟通记录`、`assets/机器学习/机器学习基础-第二章笔记`)补 `rel_path` frontmatter(`gbrain put` 覆盖,内容与 Pointer 相对 filehub 根一致)。

## 阶段 C:建机器 B 环境

7. **建 B 工作台**:`jspace init ~/jspace-work-b`(或源码 `bun run cli/main.ts init`);`jspace filehub init ~/filehub-b --register`(hub 注册 filehub-b primary)。
8. **复制 filehub**:`cp -r ~/filehub ~/filehub-b`(内容一致、前缀不同;确认 2 份资料 + index 在)。
9. **B brain 隔离 + 导入**:
   - 按阶段 A probe 确定的机制建独立 B brain(首选 `--home`/独立目录)。
   - `gbrain import ~/.gbrain-export --no-embed` → **验证图谱边/backlink 回灌**(记录保留/丢失)。
   - `gbrain embed --all` 重建 embedding;快照 reachability。

## 阶段 D:双机演练(闭环验证)

10. **指针换机解析**:B 读 `~/jspace-work-b/.jspace/hub.json` 的 filehub primary path(根)→ 根 + `rel_path` → 目标 Pointer → `test -f` 断言。
11. **召回对照**:B 上四条规范查询(Q1/Q1'/Q2/Q2')top-1 与 A 侧记录一致(0.8751/0.8528/0.8953/0.8774 参考),负对照不串台;双路径 search/query 记录。
12. **问一句闭环**:B 上按 memory-recall skill 跑「历史数据迁移涉及多少存量?」→ 指针断言四连(rel_path 重解析后)→ 答案引用 `~/filehub-b/...` 路径。
13. **结论裁决**:指针双字段方案在 B 侧是否成立(rel_path 解析成功 = 采用;失败 = 回退二选一留痕)。

## 阶段 E:结论落档

14. **GOAL.md**:开放问题 #1 关闭(结论 = 记忆层可移植假设成立/不成立 + 指针方案采用/回退 + 真实换机待跟踪);M5 里程碑更新。
15. **REPO 中性结论**:演练结论以中性描述落档(无 owner 路径/真实文件名);真实证据(路径/导出物/分数/PID 时序)在任务 notes + JWorkspace(非 git)。
16. **notes.md**:记录完整真实证据(probe 结果、rel_path 值、B 侧查询分数、边回灌结果、锁时序)。

## 阶段 F:校验与提交(Phase 3)

17. **校验**:
    - `diff -rq -x harness-config skills/ ~/jspace-work/skills/` 无输出(含 B 侧按需)。
    - `jspace doctor --dir ~/jspace-work` 通过;`bun run cli/main.ts --version` 回归;`bunx tsc --noEmit`。
    - M4 验收不回归:rel_path 为新增字段,原 Pointer 断言不变;`docs/MEMORY-ACCEPTANCE.md` 原用例未改。
    - 去个人化:REPO 侧无 owner 路径/真实文件名/PID(git grep)。
18. **trellis-check**:spec 对齐、无回归。
19. **提交**:REPO git commit(仅本任务相关文件)。
20. **(R4 可选)** CI Linux cron 冒烟:若 CI 改动成本低,加一步 `jspace cron install` + `run` 冒烟;不阻塞主任务。

## 验证命令

```bash
gbrain export --dir ~/.gbrain-export          # A 导出(serve 停泊窗口内)
gbrain import ~/.gbrain-export --no-embed     # B 导入
gbrain embed --all                            # B 重建 embedding
gbrain query "历史数据迁移涉及多少存量?"        # B 侧对照
jspace doctor --dir ~/jspace-work-b           # B 工作台
test -f "<B filehub 根>/<rel_path>"            # 指针换机解析断言
```

## 风险文件 / 回滚点

- **REPO 纪律修订**(git 可回滚):gbrain-write / asset-ingest / memory-recall discipline / MEMORY-ACCEPTANCE。
- **JWorkspace skills**(非 git):改前备份 `~/.jspace-backup/m5-<ts>/`;恢复 = cp -r + diff 验证。
- **A 侧 gbrain 页 rel_path 补写**:2 页覆盖写(先 `gbrain get` 备份内容到 notes,改坏可恢复)。
- **B brain 隔离**:优先独立 home;若机制不支持,退路 = 备份 `~/.gbrain` → 用 B 数据 → 结束恢复(留痕)。
- **锁时序**:不 kill serve / 不独立重启;占用则协调停泊窗口;失败即停。

## 交接要点

- 真实第二机验证:本任务只做本机模拟,结论标注效力有限;GOAL 开放问题 #1 关闭时明确「真实换机待跟踪」。
- 已解锁 cron 任务实跑 + 机器端 install:rehearsal gate 后作为后续动作(M4 遗留,不属 M5)。
- 指针 rel_path 是新纪律:后续 asset-ingest 写页自动带;存量页按需补(工具化与否留涌现)。
