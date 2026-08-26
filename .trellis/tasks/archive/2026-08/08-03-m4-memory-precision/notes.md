# M4 任务记录(真实证据,不入 git)

## 环境证据(2026-08-03 实测)

- REPO 源: `/Users/jionpz/mycode/jspace`(git,干净)。
- JWorkspace: `/Users/jionpz/jspace-work`(非 git;hub 含 owner 域 jspace-dev/agent-infra/files;filehub 资源已注册 primary=`/Users/jionpz/filehub`)。cron.json 与旧模板一致。
- filehub: `/Users/jionpz/filehub`;projects/areas 空;_inbox 2 真实文件:
  - `会议沟通记录.txt`(353B;含「历史数据迁移方案待定,涉及约 30GB 存量」)
  - `机器学习基础-第二章笔记.md`(611B;含「MSE 损失对 w 的梯度: ∂L/∂w = (2/n) Σ x_i(w·x_i + b - y_i)」)
- gbrain 0.42.71,embedding=SiliconFlow bge-m3(在线),chat=litellm:deepseek-v4-flash(本地代理 127.0.0.1:2006);doctor 95(brain 100,唯一 warn=connection)。
- **锁现实**:`gbrain serve`(PID 86989)= 活跃 claude 会话 **86973**(ttys006,`--dangerously-skip-permissions`,2026-08-01 22:00 起)的 stdio 子进程。本 M4 会话 = ttys000 claude(PID 43867)。另 ttys003 claude(PID 44183)。
- `jspace` CLI **未安装**到本机(JWorkspace 由源码 `bun run cli/main.ts` 生成);doctor 用 `bun run cli/main.ts -- doctor --dir`.

## 阶段进度

### 阶段 A ✅
- 锁留档(86989←86973)、skills 备份 `~/.jspace-backup/m4-20260803-141746/`、JWorkspace skills 刷新(排除 harness-config,diff 无差异)、doctor ok(0 error;2 warning=2 份 inbox + cron 未装)。

### Phase E 非 gbrain 部分(先行完成 ✅)
- `gbrain.md`:新增「Dated memory record (weekly snapshot) — M4 authorized exception」节(周快照=新页,state 页承担当前态,embed_skip/tag 缓解注入噪声,同周幂等)。
- `templates/workbench/.jspace/cron.json`:weekly-report / memory-consolidate `enabled:true`,契约内联进 prompt(weekly→`<filehub>/areas/周报/<YYYY-MM-DD>-周报.md`+`assets/周报/<YYYY-MM-DD>`;memory→`memory/consolidate/<YYYY-MM-DD>`+回写 state),无「见 design.md」。JSON 合法。
- `docs/MEMORY-ACCEPTANCE.md`:中性占位版协议(4 用例/断言/校准终止/操作约束/基线标注)。
- `GOAL.md`:M4 两行去重、改描述「校准召回+端到端验收(不重设 M2 已锁 slug 骨架)」、更新日期(仍 ⏳,待验收通过标完成)。
- `templates/workbench/AGENTS.md`:cron 节改为两任务 enabled + 自包含契约 + install 前 rehearsal gate。
- JWorkspace skills 已再刷同步。

### 阶段 B ✅ 端到端入库(上一会话完成;本会话锁释放后复核)
- `_inbox/` 2 份真实文件已归位(文件 mtime 14:31-14:37,早于本会话):
  - ML 笔记 → `areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md`(611B,含 `∂L/∂w = (2/n) Σ x_i(...)`)
  - 会议纪要 → `projects/报表模块/2026-07-会议沟通记录.txt`(353B,含「约 30GB 存量」;归属定夺为项目 `报表模块`,非跳过)
- gbrain reference 页已写(与 M2 纪律一致):`assets/机器学习/机器学习基础-第二章笔记`、`assets/报表模块/会议沟通记录`(type: reference, project, tags 齐全,Pointer=绝对路径)。
- index 登记:`areas/机器学习/index.md`(首文件建)、`projects/报表模块/index.md`。

### 阶段 C ✅ 召回验收(2026-08-03 锁释放后,canonical=CLI 独立重跑交叉验证)
- **embedding 快照**:`gbrain models doctor --json` → `embedding_config: openrouter:BAAI/bge-m3`(1024 维),`embedding_reachability: ok`(174ms)。⚠️ 注意:notes 早期记录为 SiliconFlow bge-m3,实测定为 **openrouter**——provider 已切换,不影响验收(可达即通过)。
- **四条逐字固定查询 ×3 重跑,全部 top-1 正确且稳定(分数逐次一致)**:
  - Q1 `历史数据迁移涉及多少存量?` → `assets/报表模块/会议沟通记录`(0.8751)×3;负对照 ML 页第二(0.8155)。
  - Q1' `那 30 个 G 的数据怎么搬?` → `assets/报表模块/会议沟通记录`(0.8528)×3;负对照 ML 页第二(0.8140)。
  - Q2 `MSE 损失对 w 的梯度是什么?` → `assets/机器学习/机器学习基础-第二章笔记`(0.8953)×3;**仅召回 ML 一页**(更强负对照)。
  - Q2' `损失函数怎么对参数求导?` → `assets/机器学习/机器学习基础-第二章笔记`(0.8774)×3;负对照会议页第二(0.7977)。
- **双路径(search 关键词 / query 语义)**:四条 top-1 两路径一致且正确。诚实记录:2 文档基线语料下**关键词路径已能命中**,语义层未凸显差异加分(不劣化);「语义层加分」的差异证据留待语料增长后验证。
- **指针断言四连全部成立**:① `gbrain get` → Pointer 字段在;② `test -f` 两 Pointer 均在;③ `grep -c "30GB" 会议文件`=1、`grep -c "∂L/∂w" ML文件`=2;④ query top-1 slug == 目标 slug。
- **校准循环:无需触发**(首跑即全过)。
- **锁时序**:86973/gbrain serve 均已退出(PID 86989、86973 无进程);CLI 全程 serve 停泊窗口内完成。

### 阶段 E ✅ 产物落盘
- 见上「Phase E 非 gbrain 部分」+ 本会话补充:
  - `docs/MEMORY-ACCEPTANCE.md`:补「基线验收结果(2026-08-03)」中性记录。
  - GOAL.md:M4 已标 ✅(上一会话),本会话复核证据一致。
  - 真实 JWorkspace cron.json 与模板**一致**(diff 无差异;mtime 14:41:33,三任务 enabled:true、prompt 含 YYYY-MM-DD 契约)。

## 收尾确认(本会话)

- [x] embedding 可达快照已留档(openrouter bge-m3, ok)。
- [x] 四条 ×3 重跑 + 双路径 + 指针断言四连,全过,负对照成立,无需校准。
- [x] JWorkspace skills 刷新后 diff 无差异;cron.json 与模板一致。
- [x] GOAL.md M4 完成。
- [ ] `jspace doctor` 3 warning = 三 cron 未 install(显式后续动作,rehearsal gate 后再装)。
- [ ] REPO 提交(M4 变更 + 本会话验收证据不入 git,留此文件)。

### 阶段 C 验收(2026-08-03,serve 停泊窗口内,CLI canonical)

embedding 快照:embedding_config ok / embedding_reachability ok(SiliconFlow bge-m3,149ms);chat ok;expansion unknown(超时不阻塞)。

四条查询 ×3 重跑(全 top-1 正确,负对照不串台)+ search 双路径:

| 查询 | run1/2/3 top-1 | search top-1 | 通过 |
|---|---|---|---|
| Q1 历史数据迁移涉及多少存量? | 会议沟通记录 0.8751×3 | 会议沟通记录 | ✓ |
| Q1' 那 30 个 G 的数据怎么搬? | 会议沟通记录 0.8528×3 | 会议沟通记录 | ✓ |
| Q2 MSE 损失对 w 的梯度是什么? | 机器学习笔记 0.8953×3 | 机器学习笔记 | ✓ |
| Q2' 损失函数怎么对参数求导? | 机器学习笔记 0.8774×3 | 机器学习笔记 | ✓ |

指针断言(四连过):
- 会议纪要: Pointer=/Users/jionpz/filehub/projects/报表模块/2026-07-会议沟通记录.txt;file ✓;grep 30GB=1 ✓;query top-1==slug ✓
- ML 笔记: Pointer=/Users/jionpz/filehub/areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md;file ✓;grep ∂L/∂w=2 ✓;query top-1==slug ✓

**结论:验收通过,无需校准循环。** 基线(2 文档语料)下 search 与 query 同 top-1(语料小无法区分关键词/语义,已按基线标注;变体查询证明语义同构表达可召回)。

### 阶段 D
- 未触发(首跑全过)。
