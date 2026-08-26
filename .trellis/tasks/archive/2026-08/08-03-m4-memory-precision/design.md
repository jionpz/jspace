# M4 记忆精度打磨 — 技术设计

## 定位

本任务是**验证 + 校准**,不是特性构建。核心是一次真实环境端到端验收(校准召回),加上验收暴露问题的修正与 cron 解锁契约。技能/模板以 REPO 为源(`/Users/jionpz/mycode/jspace`),真实使用环境是 JWorkspace(`/Users/jionpz/jspace-work`,非 git、生成物)。

## 边界

**IN(交付物)**
1. 真实环境 E2E 验收证据:inbox 2 份真实文件 → asset-ingest 归位 + gbrain 页 → 中文语义查询 top-1 命中 + 指针找到「那个数」。
2. 验收暴露缺陷在 REPO 源修正(skill references),并刷新真实 JWorkspace skills。
3. 可复跑验收协议:**REPO 侧中性占位版** `docs/MEMORY-ACCEPTANCE.md`(<filehub>/<workspace> 占位,无个人数据);**真实证据**落 `.trellis` 任务记录 + JWorkspace(非 git)。
4. cron 解锁:`templates/workbench/.jspace/cron.json` 两任务 `enabled:true` + **prompt 内联自包含契约**;真实 JWorkspace cron.json 原地同步(备份+校验)。
5. gbrain.md 纪律修订(dated memory record 周快照)+ `GOAL.md` M4 去重/改描述/标记完成。

**OUT**
- 机器端 `jspace cron install`(创建 launchd 任务)——显式后续动作,附 **install 前 rehearsal gate**(先 `jspace cron run` 各一次核对契约再 install)。
- gbrain 内部机制 / 检索权重调参——策略留给涌现(M2 决策)。
- 双机重建冒烟(开放问题 #1)——重排至 M5(留痕)。
- Linux/Windows 真机、office 逐表抽取。

## 环境与约束(证据,2026-08-03 实测复核)

| 项 | 现状 | 约束 |
|---|---|---|
| REPO(源) | 干净,skills/templates 为当前版 | 所有修正先落 REPO;REPO 公开 → 验收产物去个人化 |
| JWorkspace | `/Users/jionpz/jspace-work`,hub 含 owner 域 + filehub 已注册 | skills 过期;**只刷 skills,不动 hub/owner 域** |
| filehub | `/Users/jionpz/filehub`(_inbox 2 真实文件) | 验收素材现成;areas 无 index,首文件时建 |
| gbrain | 0.42.71,embedding=SiliconFlow bge-m3(在线),chat=litellm 本地代理;doctor 95 | 锁现实见下;embedding 在线依赖 |
| **gbrain 锁(实测)** | serve(86989)= 活跃 claude 会话 86973 的 **stdio 子进程**(PPID=86973 `--dangerously-skip-permissions` ttys006;同会话挂 gbrain/context7/playwright MCP) | **非 daemon,禁 kill / 禁独立重启**;唯一安全路径 = 协调结束 86973 释放锁后 CLI,或在该会话内做 gbrain 操作 |
| gbrain 接线 | M4 执行会话未接 gbrain MCP(仅 context7/playwright) | canonical 验收面 = CLI(serve 停泊窗口内) |

## E2E 验收协议(可复跑核心)

前置:JWorkspace skills = REPO 当前版;filehub 注册;**锁已释放**(86973 已结束,serve 停泊);embedding 可达快照(`gbrain models doctor` embedding_reachability=ok)已记录。

1. **入库(asset-ingest 真实流程)**:
   - 第一遍确定性处理:机器学习笔记 → `areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md` + reference 页 `assets/机器学习/机器学习基础-第二章笔记` + **首文件建 `areas/机器学习/index.md`**。
   - 会议纪要归属不确定 → 第二遍短清单给用户,**归位到具体项目/领域**(不允许跳过,否则 Q1 无页可查)→ 归位 + 写页 + 登记。
   - 写页纪律(slug/frontmatter/supersedes)按 M2 已锁规范;embedding 正常写。
2. **召回验收(「问一句」,canonical=CLI serve 停泊窗口)**:
   - 四条逐字固定规范查询:Q1 `历史数据迁移涉及多少存量?` / Q1' `那 30 个 G 的数据怎么搬?` → 会议纪要页;Q2 `MSE 损失对 w 的梯度是什么?` / Q2' `损失函数怎么对参数求导?` → ML 笔记页。
   - 通过标准:**原型+变体均 top-1 且负对照不串台 + 连续 ≥3 次重跑全 top-1** + 记录 search/query 双路径(证明语义层加分)。
   - **指针断言序列**(四连过才算该用例过):① `gbrain get <slug>` → Pointer 字段;② `test -f "<Pointer>"`;③ `grep -c "30GB" "<Pointer>"` ≥1(ML 用 `grep -c "∂L/∂w"`);④ query top-1 slug == 目标 slug。
3. **校准循环(有终止,≤3 轮)**:未命中 → 诊断(slug/tags/embedding 配置/查询措辞/纪律缺口)→ **REPO** 修正 → 刷 JWorkspace → 重跑。≥2 次稳定 top-1 才算过;3 轮未过 → 显式终态二选一(接受关键词降级记入验收文档 / 上报用户)。embedding 不可达 = 环境故障阻塞,不进循环。

## cron 最小契约(汇总周报形态,自包含)

| 任务 | 产出位置 | gbrain 页 | 写语义 | 元数据 |
|---|---|---|---|---|
| weekly-report | `<filehub>/areas/周报/<YYYY-MM-DD>-周报.md`(单一汇总,周起始日命名) | `assets/周报/<YYYY-MM-DD>`(reference,**以指针为主**,极薄 Summary,事实以 consolidate 为准) | 周快照(固定 slug 覆盖,同周重跑幂等) | project: jspace, tags: [weekly] |
| memory-consolidate | 无 filehub 文件(纯记忆操作) | `memory/consolidate/<YYYY-MM-DD>`(type:note,**dated memory record**) | 周快照(每周新页);回写涉项 `project/<id>/state` 固定 slug 覆盖 | project: jspace, tags: [consolidate, weekly] |

- 契约**全文内联进模板 cron.json 的 prompt 字符串**(自包含,禁「见 design.md」;JWorkspace 无 .trellis 也能解析)。
- **纪律修订落档(gbrain.md)**:新增「dated memory record(周快照)」写模式 = note + 日期 slug = 每周新页,当前状态由 `project/<id>/state` 承担;注明 recent-injection 会混入历史周页,可用 embed_skip / 专用 tag 减轻。weekly-report 周页同属周快照。
- 解锁=契约锁定,未运行验证;机器端 install 前跑 rehearsal gate(`jspace cron run` 各一次核对产出位置/slug)。

## 操作约束与风险

- **gbrain 锁(最高优先级)**:serve 是 86973 的 stdio 子进程,不是可独立重启的 daemon。**禁 `kill` serve、禁 `gbrain serve &` 独立重启**。处置:协调用户结束 86973(释放锁)→ M4 全程 CLI 在停泊窗口内完成入库+验收 → 86973 重连/正常结束自然恢复 serve。CLI 窗口内勿唤醒 86973;重跑必须同一 canonical 面。
- **SiliconFlow 在线依赖**:验收时刻 embedding 不可达 → 环境故障阻塞验收,不进校准循环,不写「通过」;每次重跑前重查可达性留痕。
- **JWorkspace 非 git**:skills/cron.json 改前备份到**持久路径**(`~/.jspace-backup/<ts>/`,非 /tmp)+ 显式恢复命令 + JSON 校验;hub/owner 域一律不动。
- **去个人化**:REPO 侧验收文档中性占位;真实证据(路径/文件名/PID/校准)只在任务记录+JWorkspace;提交前清理。
- **ROI 护栏**:配置/查询措辞类问题只记录,不改 skill 纪律。

## 决策留痕

- M4 范围按 `08-02-asset-layer` PRD:收缩为校准召回 + 端到端验收,不重设 M2 已锁 slug 骨架。
- 验收用**真实 inbox 文件**(用户选「真实端到端」);会议纪要归属须归位到具体项目/领域。
- cron 契约最小化 + 汇总周报(用户选「最小契约+汇总周报」)。
- 多专家评审修正(2026-08-03):锁处置改写(禁 kill/禁独立重启 serve,协调结束 86973);验收防假阳性(变体查询/负对照/重跑/双路径);校准终止 ≤3 轮;cron 契约内联自包含;dated memory record 纪律落档;验收证据去个人化。
- 双机重建冒烟重排至 M5(对齐 GOAL M5 多机演练,替代 M2「不晚于 M3」承诺)。
