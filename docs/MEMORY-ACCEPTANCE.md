# JSpace 记忆精度验收协议(MEMORY-ACCEPTANCE)

> 可复跑的中文语义召回验收协议。**基线版**:2 文档语料,验证「问一句,找到那个文件里的那个数」。随语料增长追加区分性查询并重跑本协议。
> 本文件为**中性版**(`<filehub>`/`<workspace>`/`<领域>` 占位)。某台机器的真实证据(路径/文件名/PID/校准记录)留在该机 JWorkspace 与任务记录,不进入此文件。

## 前置条件

- JWorkspace skills 为待验收版本(与源 REPO `skills/` 排除非模板技能后 diff 无差异)。
- gbrain 锁已处置(见「操作约束」):持锁会话已释放 PGLite 锁,验收全程在 serve 停泊窗口内用 CLI。
- filehub 已注册(`type: filehub` resource,primary path 可解析),`_inbox/` 有待入库真实文件。
- **embedding 可达快照已记录**:`gbrain models doctor --json` → `embedding_config` / `embedding_reachability` 必须 `ok`,连同 run 时间留档。不可达 = 环境故障,阻塞验收,不写「通过」。

## 验收用例(canonical 查询串逐字固定)

语料:2 份示例资料,分别归入 `<领域A>`(含数值事实 X)与 `<领域B>`(含公式 Y)。参考目标页 slug 按 M2 纪律派生(`assets/<领域|项目>/<语义名>`)。

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

## 扩展性

- 基线验收后,每次语料增长(新增领域/项目)追加 1 条区分性查询(表面词尽量不与目标页重叠)并整体重跑,top-1 命中率回退即触发校准。
- 本协议只锁「用例/断言/终止/操作约束」;内容结构随真实使用涌现。
