# JSpace 记忆精度验收协议(MEMORY-ACCEPTANCE)

> 可复跑的中文语义召回验收协议。**基线版**:2 文档语料,验证「问一句,找到那个文件里的那个数」。随语料增长追加区分性查询并重跑本协议。
> 本文件为**中性版**(`<filehub>`/`<workspace>`/`<领域>` 占位)。某台机器的真实证据(路径/文件名/PID/校准记录)留在该机 JWorkspace 与任务记录,不进入此文件。

## 前置条件

- JWorkspace skills 为待验收版本(与源 REPO `skills/` 排除非模板技能后 diff 无差异)。
- gbrain 锁已处置(见「操作约束」):持锁会话已释放 PGLite 锁,验收全程在 serve 停泊窗口内用 CLI。
- filehub 已注册(`type: filehub` resource,primary path 可解析),`_inbox/` 有待入库真实文件。
- **embedding 可达快照已记录**:`gbrain models doctor --json` → `embedding_config` / `embedding_reachability` 必须 `ok`,连同 run 时间留档。不可达 = 环境故障,阻塞验收,不写「通过」。

## 验收用例(canonical 查询串逐字固定)

语料:2 份示例资料,分别归入 `<领域A>`(含数值事实 X)与 `<领域B>`(含公式 Y)。参考目标页 slug 按记忆模型 v2 纪律派生(`assets/<项目id|领域>/<语义名>`,**项目用 ascii id**、领域用中文名——与 `project/<id>/state` 的 ascii 项目 id 一致)。

| # | 查询(逐字) | 期望 top-1 | 负对照(不得排第一) |
|---|---|---|---|
| Q1 | `历史数据迁移涉及多少存量?` | `<领域A>` 页 | `<领域B>` 页 |
| Q1' | `那 12.8T 的数据怎么搬?`(换说法,语义同) | `<领域A>` 页 | `<领域B>` 页 |
| Q2 | `MSE 损失对 w 的梯度是什么?` | `<领域B>` 页 | `<领域A>` 页 |
| Q2' | `损失函数怎么对参数求导?`(换说法,语义同) | `<领域B>` 页 | `<领域A>` 页 |

通过标准(全部满足该用例才算过):
1. 原型+变体均 top-1 正确页,负对照不串台。
2. **稳定性**:同一查询连续 ≥3 次重跑全部 top-1。
3. **双路径留证**:同时记录 `gbrain search <query>`(纯关键词)与 `gbrain query <query>`(hybrid)输出,证明语义层确实加分。
4. **指针断言序列**(四连过):① `gbrain get <slug>` → 取 Pointer 字段;② `test -f "<Pointer>"` 成立;③ `grep -c "<事实关键词>" "<Pointer>"` ≥1;④ `gbrain query` 输出 top-1 slug == 目标 slug。

## 校准循环(≤3 轮)

- 未命中 → 诊断类别:slug / tags / embedding 配置 / 查询措辞 / 纪律缺口。
- 每轮 = 1 次源 REPO 修正 + 刷新 JWorkspace + 重跑;记录「现象→原因→修正→重跑结果」。
- **终止**:≥2 次稳定 top-1 才算过;3 轮未过 → 显式终态二选一:接受关键词降级并记入本文档为已知限制 / 上报用户决策(扩语料、换 embedding 配置)。
- ROI 护栏:配置/查询措辞类问题只记录,不改 skill 纪律。
- 每次重跑前重查 embedding 可达性并留痕;重跑必须同一 canonical 面(CLI,serve 停泊窗口内)。

## 操作约束

- **gbrain 锁**:`gbrain serve` 是某 harness 会话的 stdio 子进程,非独立 daemon。**禁 `kill` serve、禁独立重启**(独立重启会变幽灵锁持有者)。处置:协调结束持锁会话释放锁 → CLI 窗口内完成验收 → 持锁会话重连/正常结束自然恢复 serve。窗口内勿唤醒持锁会话。
- **在线 embedding 依赖**:embedding 不可达 = 环境故障阻塞,不进校准循环,不写「通过」。provider(SiliconFlow / OpenRouter bge-m3)不固定,以验收时刻 `gbrain models doctor --json` 可达为准。
- **canonical 面**:验收与重跑统一用 CLI(`gbrain`),serve 停泊窗口内;真实使用面(MCP)在锁恢复后补一次 `query` 冒烟对齐。
- **读回校验**(`gbrain get`)须在 serve 停泊窗口内完成。

## 基线验收结果(2026-08-03)

- **语料**:2 文档(含数值事实 X 的领域页 + 含公式 Y 的领域页)。结果已在两台真实运行下交叉验证,分数逐位一致:
  - Q1 / Q1' / Q2 / Q2' 各连续 ×3 重跑**全部 top-1 正确**,负对照不串台;指针断言四连全部成立。
  - 校准循环**未触发**(首跑即全过)。
- **双路径诚实记录**:基线语料下 `search`(关键词)与 `query`(语义)top-1 **一致**——关键词路径已能命中,语义层不劣化但差异加分未凸显。变体查询(Q1'/Q2')证明语义同构表达可召回。「语义层加分」的差异证据留待语料增长后验证(见扩展性)。
- **embedding 可达性**:在 SiliconFlow 与 OpenRouter 两个在线 bge-m3 provider 下分别验收,`embedding_reachability: ok`,均通过。
- **后续跑**:每次重跑需重查 embedding 可达性并留痕,约束同「操作约束」。

## 换机解析扩展(M5)

验证「换一台机器,记忆重建索引后指针仍可解析」。**原四用例与断言不变**;本扩展新增换机侧断言。

**前置**:reference 页含 `rel_path` frontmatter(相对 filehub 根的全相对路径,由 asset-ingest 写页产出);目标机 `hub.json` 有 `type: filehub` resource 且 primary path 可解析。

**用例**:从源机 `<workspace>/<filehub>` 导出记忆(`gbrain export`)→ 在目标机(独立工作台 / 独立 filehub / 独立 brain)导入重建(`import` + `embed --all`)→ 指针换机解析 + 召回对照:

1. **rel_path 解析**:读目标机 `hub.json` 的 filehub primary path(根)→ 根 + `rel_path` → 目标机 Pointer → `test -f "<Pointer>"` 成立。
2. **召回对照**:目标机四条规范查询(Q1/Q1'/Q2/Q2')top-1 与源机一致,负对照不串台。
3. **问一句闭环**:目标机按 memory-recall skill 召回,答案引用**目标机**文件路径。

**通过标准**:rel_path 解析成功 + `test -f` 成立;四条查询 top-1 与源机一致;问一句引用目标机路径。**原四用例断言(逐字串/重跑/负对照/指针四连)不变**。

**记录**:目标机查询原始输出 + rel_path 值 + 源机对照分数;失败 → 按校准循环诊断(rel_path 缺失 / 根读不到 / 资产未同步)。

## office 深度抽取扩展(#4)

验证「excel/ppt 经深度抽取后,关键数字/表格内容可召回」(asset-ingest 深入路径 + 伴生 `.extract.md`)。

**前置**:JWorkspace 的 `.jspace/skills/asset-ingest/scripts/office-extract.py` 为待验收版本(与源 REPO diff 无差异);待验收文件为**真实 excel/pptx**(含数值事实)。

**用例**:

| 步 | 动作 | 断言 |
|---|---|---|
| 1 | 归位:真实 xlsx 经 asset-ingest 移到 `<filehub>/projects/<项目>/`,命名 `YYYY-MM-DD-语义名-vN.xlsx` | 文件存在;`projects/<项目>/index.md` 登记行 |
| 2 | 深度抽取:`python3 office-extract.py <文件> --out <文件>.extract.md` | 伴生 `.extract.md` 存在;含 sheet 名 + 单元格引用 + 值;**幻影行(全空高空行)不输出**;超 `ROWS_LIMIT` 行有截断注记 |
| 3 | 策展写页:gbrain asset 指针页 slug `assets/<项目id>/<语义名>-vN`(项目 id 用 ascii,与 state 卡一致) | 页含 Key Facts(关键数字带 `[Source: <rel_path>, Sheet <名> <列>, 日期]`) + `抽取:` 注记行 + `rel_path` |
| 4 | 召回:① `gbrain query "<关键数字相关措辞>"` ② `gbrain search "<关键词>"` ③ 指针断言四连(`get` → Pointer → `test -f` → top-1 slug 一致) | query 与 search 均 top-1 目标页;指针四连成立 |

**通过标准**:步骤 1–4 全过;关键数字的语义查询与关键词查询均 top-1;幻影行过滤与截断行为符合契约。

**验收样例记录(2026-08-03,含#4)**:真实 xlsx(7 sheet;含 1048574 行幻影行的名单 sheet,过滤后 419 行非空;抽取 132MB→265KB;页 Key Facts 含关键数字)经深度抽取后,该关键数字的语义查询与关键词查询均 top-1 目标页,指针四连成立。*具体文件路径/项目名/金额为机器真实证据,按本文件「中性版」约定留该机,不进入此文档。*

## 扩展性

- 基线验收后,每次语料增长(新增领域/项目)追加 1 条区分性查询(表面词尽量不与目标页重叠)并整体重跑,top-1 命中率回退即触发校准。
- 本协议只锁「用例/断言/终止/操作约束」;内容结构随真实使用涌现。
