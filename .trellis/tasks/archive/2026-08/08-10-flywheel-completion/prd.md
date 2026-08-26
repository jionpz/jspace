# 工作中心飞轮补全(父任务)

## Goal

2026-08-10 全面审查结论落地:让「越用越强」的三个飞轮全部转起来。审查判定:**建造质量远超使用里程**——记忆飞轮与资产飞轮有机制但几乎零转速,工作流进化飞轮完全缺失,且已建好的厚度没有到达使用现场(分发链过时)。父任务持有需求集、任务地图与跨子任务验收;子任务独立交付。

## 需求来源(审查关键事实,2026-08-10 基线)

- 本机二进制 `1.0.11-12-gd143e79` 落后 HEAD 30 个提交;工作台 `.jspace/skills/` 与用户级 `~/.agents/skills/` 均缺 5 个 per-harness reference,多文件过时。
- `~/jspace-work/AGENTS.md` 受管块外(约 L103-307)残留旧模板全文:引用已改名的 `jspace-bootstrap`、死链、旧 Brain-ops 触发行;每会话注入双份矛盾规则。
- `~/.claude.json` 的 gbrain server 无 `GBRAIN_SKILLS_DIR` env → gbrain 侧官方 skill 路由静默断(`skills/jspace-use/references/gbrain.md` 自述风险)。
- hub.json `projects: []`、`workspace/files/README.md` 仍是占位表,而 filehub 已有 2 个真实项目 → 「域↔项目↔记忆」挂接断裂,weekly-report 的项目发现源不成立。
- gbrain 全库 12 页(全部来自 8/3 验收 + 8/9 巩固演练 + 测试页),0 条图谱边;出现契约外 type(`concept`×2、`project`×1)。
- ~~launchd 三 cron 已装载但 `.jspace/logs/cron/` 不存在 → 零次自然触发~~ **【2026-08-10 更正,原判断错误】** cron 实际一直在自然触发:08-07 21:14 inbox-tidy 失败(API 520)→ 08-08 21:01 成功并 ack incident → 08-09 21:06 weekly-report / 22:11 memory-consolidate → 08-10 21:02 inbox-tidy 成功。误判根因:审查时用 `ls -lat <dir>` 探测,本机 `ls` 实为 eza,其 `-t` 需带参数,把目录路径吃掉导致输出为空(`2>/dev/null` 又吞掉报错)。**结论反转:cron 腿在转,GOAL 开放问题 #3 的观察条件已满足**(待父任务落笔关闭);真正不转的是「会话写回」腿。
- skill 覆盖缺口:weekly-report / memory-consolidate 只有 cron.json 内联 prompt(user 数据,升级不覆盖 → 契约冻结);项目生命周期无 checklist;工作流自省(retro)零覆盖。

## 任务地图

| 子任务 | 优先级 | 类型 | 依赖/顺序 |
|---|---|---|---|
| 08-10-p0-workbench-reconnect | P0 | 轻量(PRD-only,本机运维) | 先行——是后续所有验证的基线 |
| 08-10-skill-workbench-retro | P1 | 复杂(需 design+implement) | 无硬依赖;建议在 P0 后 |
| 08-10-cron-contract-skills | P1 | 复杂(需 design+implement) | 无硬依赖;与 retro 独立 |
| 08-10-project-lifecycle-checklist | P1 | 轻量(PRD-only) | 无硬依赖 |
| 08-10-doctor-drift-checks | P2 | 复杂(需 design+implement) | 建议最后——可一并校验前面子任务的产物 |

父/子非依赖系统;上表顺序为建议,子任务各自验收可测。

## 父任务直接工作(集成收口)

- 各子任务归档后做最终集成 review(模板改动统一过 `/tmp` smoke `init` + `doctor`)。
- C1 观察到真实定时触发后,更新 `GOAL.md` 开放问题 #3 为正式关闭(含证据落笔)。
- 审查报告中的持久要点按 memory-writeback 纪律写入 gbrain(`project/jspace/state` 更新)。

## 跨子任务验收标准

- [x] 分发链全量一致:本机二进制 = 仓库 HEAD 构建;`diff -rq` 工作台 `.jspace/skills/` 与仓库 `skills/`(除 harness-config)无差异;`~/.agents/skills/` 同步。
  → 仅余设计内差异(`.test.py` 不下发、`RESOLVER.md` 是 gbrain wire 占位)。**并且此后有了自动信号**:`skills.bundle_stale` 会主动报过时(实测在重建二进制后自发命中)。
- [x] `jspace doctor --dir ~/jspace-work` 无 error;`gbrain.skillsdir_unwired` 不再出现。
  → 终态 `0 error / 0 warning / 0 info`;`jspace cron check` needs_attention 0。
- [x] 工作台 AGENTS.md 仅存单份规则(受管块)+ 用户自有内容,无 `jspace-bootstrap` 残留。
  → 307 行 → 102 行;此后由 `agentsmd.stale_outside_block` 守住。
- [x] 新增/改动 skill 全部通过 `gen-assets` + `check-skills` + `check-harness-consistency` + CI。
  → 终态:tsc 0、**bun test 546 pass / 0 fail**、check-skills PASS、harness-consistency all pass、manifest-integrity 44 路径。
- [x] GOAL「终局的一天」环节覆盖表在周自省环节补齐后无「零覆盖」项。
  → `workbench-retro`(自省)+ `weekly-report` / `memory-consolidate`(周期产出升格为 skill)+ §8.7(项目生命周期)三处补齐;GOAL 四大支柱扩为五条(新增「自省」)。
- [x] GOAL.md 开放问题 #3 正式关闭。
  → 已落笔:真实定时触发 2026-08-10 观察确认(08-07 起每日自然触发,含一次失败→ack→恢复的完整闭环)。

## 收口记录(2026-08-10)

- **集成 review**:全新 `init` 端到端 —— 7 个官方 skill 齐备、4 个 cron 全为 `kind: skill`、doctor 0 error(2 info 为未配 filehub / 未 wire gbrain,新工作台的正常提示)。本机工作台终态 0/0/0。
- **GOAL.md 三处更新**:四大支柱 → 五条(补「自省」并写明三个飞轮);开放问题 #3 全部闭合(附 launchd 触发证据链);新增 **M6 里程碑**。
- **记忆写回**:`project/jspace/state`(覆盖更新,含本轮交付 + 关键决策 + 下一步)、`knowledge/jspace/单一事实源架构的红利与代价`(新知识页 —— 库内第一条 lesson,晋升通道首次被走通)。
- **移交后续**:`jspace workspace upgrade` 在工作台目录内不带绝对路径 `--dir` 会误报 `missing .jspace/marker.json`(疑似 cwd 解析缺陷,已在 P0 记录,待单独立任务复现);文档里「当前 N 个 skill」的硬编码计数无门禁守护(见 lesson 页)。

## Key Decisions

- 2026-08-10 用户批准创建任务树(「创建」);审查轮不启动实施,实施逐子任务经 artifact review 后 `task.py start`。
- 2026-08-10 审查前提更正:cron 自然触发已成立(见上);父任务的 GOAL #3 关闭工作从「待观察」变为「可直接落笔」。审查报告中据错误前提得出的「cron 零转速」结论作废。
- 本机不使用 subagent(网关 503 + 用户明确指示),Phase 1.3 sub-agent 上下文清单按需后补,默认内联执行。
- P2 中 gbrain type 契约检查的落点(doctor vs gbrain 侧 vs 验收协议)留给 doctor-drift-checks 的 design 决定,允许裁剪。

## Notes

- 复杂子任务在 `task.py start` 前须补 `design.md` + `implement.md`;轻量子任务 PRD-only 有效。
