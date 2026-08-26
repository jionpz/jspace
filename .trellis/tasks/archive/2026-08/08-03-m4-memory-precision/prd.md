# M4 记忆精度打磨

## Goal

**校准召回 + 端到端验收**(按 `08-02-asset-layer` 决策:M2 已锁实体/slug 骨架,M4 不重设规范,专注把召回调到可用并给出可复跑验收)。旗舰验收:**"问一句,找到那个文件里的那个数"** —— 用真实资料走完「入库 → gbrain 页 → 中文语义召回 → 指针打开文件找到事实」全链。同时解锁 `weekly-report` / `memory-consolidate` 两个 cron 任务(最小产出契约)。

## Background(证据)

- M2 已落地 slug 骨架:`gbrain.md`(type 语义、写回纪律、embedding 默认必需)+ `gbrain-write.md`(`assets/<项目|领域>/<语义名>` 派生、`-vN` + supersedes、embedding 降级)。M4 仅在校验收暴露缺陷时修订。
- 本机环境:gbrain 0.42.71(brain 已 init,embedding=SiliconFlow bge-m3 在线,chat=litellm 本地代理);真实 JWorkspace `/Users/jionpz/jspace-work`(hub 含 owner 域 + filehub 已注册);filehub `/Users/jionpz/filehub`,`_inbox/` 有 2 份真实文件(会议沟通记录.txt、机器学习基础-第二章笔记.md)。
- **锁现实(实测复核)**:`gbrain serve`(PID 86989)是活跃 claude 会话 86973(`--dangerously-skip-permissions`,ttys006,含 gbrain MCP)的 **stdio 子进程,非独立 daemon** → 禁 kill serve / 禁独立重启;唯一安全路径 = 协调结束 86973 释放锁后 CLI,或在 86973 内做 gbrain 操作。JWorkspace skills 与 REPO 有差异 → 验收前需刷 skills(不动 hub/owner 域)。
- cron 模板(M3 遗留):weekly-report / memory-consolidate 已 `enabled:false` 待 M4。

## Requirements

- **R1 验收环境校准**:真实 JWorkspace skills 刷新为 REPO 当前版(备份到持久路径,不动 hub/owner 域);gbrain 锁处置完成(见 R2);filehub 注册在位。
- **R2 锁处置(先决)**:协调用户结束持锁会话 86973 → 释放 PGLite 锁 → M4 全程 CLI 在「serve 停泊窗口」内完成。禁 kill serve 子进程、禁独立重启 serve;serve 保持停止直到阶段 C 记录完毕,阶段末由 86973 重连/正常结束自然恢复。CLI 窗口内勿唤醒 86973。
- **R3 真实端到端入库**:`_inbox/` 2 份真实文件经 asset-ingest 真实流程归位(第一遍确定性处理 ML 笔记;会议纪要归属走第二遍人工定夺,**必须归位到具体项目/领域,不允许「跳过」导致 Q1 无法验收**)+ 写 gbrain reference 页(slug/frontmatter/supersedes 按 M2 纪律)+ 登记 index(areas 首文件建 `areas/<领域>/index.md`)。
- **R4 中文语义召回验收(防假阳性)**:
  - 原型(词面重叠)+ 变体(换说法、语义同)双查询,规范串**逐字固定**:
    - Q1 `历史数据迁移涉及多少存量?` / Q1' `那 30 个 G 的数据怎么搬?` → top-1 = 会议纪要页
    - Q2 `MSE 损失对 w 的梯度是什么?` / Q2' `损失函数怎么对参数求导?` → top-1 = ML 笔记页
  - **负对照**:Q1/Q1' 不得把 ML 页排第一;Q2/Q2' 不得把会议页排第一。
  - **稳定性**:同一查询连续 ≥3 次重跑全部 top-1。
  - **双路径留证**:同时记录 `gbrain search`(纯关键词)与 `gbrain query`(hybrid)输出,证明语义层确实加分。
  - **通过前置**:验收时刻 embedding 必须可达(锁处置后 `gbrain models doctor` 快照 embedding_reachability=ok);不可达 = 环境故障阻塞验收,不写「通过」。
- **R5 校准循环(有终止)**:未命中 → 诊断(slug/tags/embedding 配置/查询措辞/纪律缺口)→ REPO 源修正 → 刷 JWorkspace → 重跑。**max 3 轮**(每轮=1 次修正+重跑),≥2 次稳定 top-1 才算过;3 轮未过 → 显式终态二选一:接受关键词降级并记入验收文档作为已知限制 / 上报用户决策(扩语料、换 embedding 配置)。配置/措辞类只记入验收文档(ROI 护栏),不改纪律。
- **R6 可复跑验收协议**:`docs/MEMORY-ACCEPTANCE.md` 写**中性版**(用 `<filehub>` / `<workspace>` 占位符,无真实路径/文件名/PID);真实证据(路径/文件名/校准记录/PID 时序)落 `.trellis` 任务记录 + JWorkspace(非 git)。协议含:前置条件、**固定 canonical 查询面(CLI,serve 停泊窗口内)与重跑同面约束**、用例与断言序列、校准循环与终止、操作约束(锁时序、embedding 快照)。标注本次为**基线验收**(2 文档语料),协议可扩展(语料增长后追加区分性查询重跑)。
- **R7 cron 解锁(最小契约,自包含)**:
  - 契约全文**内联进模板 cron.json 的 prompt 字符串**(自包含,禁「见 design.md」外部引用;JWorkspace 同步后可解析)。
  - weekly-report:输出 `<filehub>/areas/周报/<YYYY-MM-DD>-周报.md`(周起始日命名,符合 GOAL 资产规范)+ gbrain `assets/周报/<YYYY-MM-DD>`;**本周快照写语义(固定 slug 覆盖,防同周重跑违 append-only;与 consolidate 统一为周快照模式)**。
  - memory-consolidate:gbrain `memory/consolidate/<YYYY-MM-DD>`(type:note,**dated memory record 周快照**)+ 回写涉项 `project/<id>/state`(固定 slug 覆盖);聚合页元数据显式:`project: jspace`(工作台 owner 域),`tags: [consolidate, weekly]`。
  - weekly-report 页以**指针为主**(Source/Pointer + 极薄 Summary),事实以 consolidate 页为准(防双页漂移)。
  - 真实 JWorkspace cron.json **原地编辑**(仅翻转两个任务 enabled + 更新 prompt,其余任务不动;改前备份 + JSON 校验)。
  - 机器端 `jspace cron install` 为显式后续动作;解锁=契约锁定,未运行验证,验收文档如实标注。

## Acceptance Criteria

- [ ] 刷新后 JWorkspace skills 与 REPO diff 无差异(`diff -rq -x harness-config`,排除非模板技能)。
- [ ] 2 份 inbox 真实文件已归位 filehub(命名 `YYYY-MM-DD-语义名` 规范)+ gbrain 页(slug/frontmatter 符合 M2 纪律)+ index 登记(`areas/<领域>/index.md` 或项目 index)。
- [ ] Q1/Q1'/Q2/Q2' 四条规范查询(逐字一致)各连续 ≥3 次重跑全部 top-1 正确页,负对照不串台;`search`/`query` 双路径结果已记录。
- [ ] **指针断言序列全部成立**:① `gbrain get <slug>` → Pointer 字段;② `test -f "<Pointer>"` 成立;③ `grep -c "30GB" "<Pointer>"` ≥1(ML 笔记用 `grep -c "∂L/∂w"`);④ `gbrain query` 输出 top-1 slug == 目标 slug。
- [ ] 校准循环:若未命中,≤3 轮内修至通过或进入显式终态;每处记录「现象→原因→修正→重跑结果」。
- [ ] 验收时 embedding 可达快照(`gbrain models doctor` embedding_reachability=ok)+ 时间已记录;不可达则本次不写「通过」。
- [ ] `docs/MEMORY-ACCEPTANCE.md` 存在且为**中性版**(无 owner 路径/真实文件名/PID),含用例/断言/校准终止/操作约束;真实证据在任务记录+JWorkspace。
- [ ] 模板 cron.json 两任务 `enabled:true` 且 prompt 内联契约(含目标位置/slug/写语义),**可 grep 断言**(prompt 含固定模式,不含「见 design.md」);真实 JWorkspace cron.json 原地同步 + JSON 合法。
- [ ] `GOAL.md` M4 去重两行 + 改描述为「校准召回+端到端验收(不重设 M2 已锁 slug 骨架)」+ 标记完成 + 更新日期。
- [ ] `jspace doctor --dir /Users/jionpz/jspace-work` 通过;gbrain 页读回校验在 serve 停泊窗口内完成。

## Out of Scope

- 机器端 `jspace cron install`(创建 launchd 任务)——显式后续动作;验收文档含 **install 前 rehearsal gate**(先 `jspace cron run weekly-report` / `memory-consolidate` 各一次核对产出位置/slug 后再 install)。
- 双机重建冒烟(GOAL 开放问题 #1)——属 M5 分发(重排留痕见 Key Decisions)。
- Linux/Windows 真机验证;office 逐表抽取等深入召回路径。
- gbrain 内部检索权重/新鲜度调参(策略留给涌现)。

## Key Decisions

- **M4 = 校准召回 + 端到端验收**,不重设 M2 已锁 slug 骨架(沿用 `08-02-asset-layer` 决策)。
- **验收用真实 inbox 文件**(用户选「真实端到端」);会议纪要归属走第二遍人工定夺,须归位到具体项目/领域。
- **cron 最小契约 + 汇总周报**(用户选「最小契约+汇总周报」):只锁目标位置/文件名/slug,内容结构留真实使用涌现。
- **M4 授权一次纪律修订(多专家评审 C1/M3)**:gbrain.md 显式新增「dated memory record(周快照)」写模式(note + 日期 slug = 每周新页,当前状态由 `project/<id>/state` 承担;注明 recent-injection 会混入历史周页,可用 embed_skip/专用 tag 减轻);weekly-report 周页同属周快照(固定 slug 覆盖)。此修订落 gbrain.md,非仅留设计文档。
- **验收 canonical 面 = CLI(serve 停泊窗口内)**;MCP 面(真实使用面)在 86973 恢复后补一次 `query` 冒烟,两面对齐。
- **验收证据去个人化(多专家评审 M5)**:真实数据留任务记录+JWorkspace,REPO 侧中性占位,提交前清理 owner 路径(守住 depersonalize 边界)。
- **双机重建重排留痕**:M2 承诺「双机重建冒烟不晚于 M3」因 M3/M4 以单机记忆精度优先重排至 M5(对齐 GOAL M5 多机演练)。

## Risks / Deferred

- **gbrain 锁(已实测)**:禁 kill serve / 禁独立重启;协调结束 86973 释放锁;serve 保持停止到阶段 C 完成;CLI 窗口内勿唤醒 86973。
- **SiliconFlow 在线依赖**:验收时刻 embedding 不可达 = 环境故障阻塞,不进校准循环,不写「通过」。
- **JWorkspace 非 git**:skills/cron.json 改前备份到持久路径(非 /tmp)+ JSON 校验 + 显式恢复命令;hub/owner 域一律不动。
- **解锁=契约锁定未运行验证**:机器端 install 前必跑 rehearsal gate。
