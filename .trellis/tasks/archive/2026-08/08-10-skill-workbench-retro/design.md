# workbench-retro — 技术设计

## 1. 定位与边界

**retro 审计「过程与纪律」,consolidate 归纳「事实内容」。** 两者都在周日跑,但看的是不同东西:

| | memory-consolidate | workbench-retro |
|---|---|---|
| 对象 | 本周产生了什么事实 | 本周纪律有没有被执行、流程哪里卡 |
| 输入 | gbrain 近一周页面 | gbrain + filehub + cron 日志 + registry 结构 |
| 输出 | `memory/consolidate/<date>` + state 回写 | `memory/retro/<date>` + 建议清单(不自动改) |
| 失败模式 | 事实丢失 | 纪律静默腐化 |

时序上 retro 排在 consolidate **之后**,可把 consolidate 的产出当输入之一(「本周巩固页说有 X 项目活动,但 X 的 state 页 10 天没动」这类交叉信号只有后跑才能拿到)。

SKILL.md 必须写清这条分工,否则两者会互相抄。

## 2. 关键设计决策

### D1 独立 skill,不并入现有(采纳)

按 jspace-use §8.3 提议信号,retro 命中 4 条(反复需要同一非显然流程 / 跨 gbrain+filehub+cron+registry 多工具 / 需要清晰触发规则 / 无 checklist 代价高=纪律静默腐化)。并入 memory-writeback 会污染其「收工写回」单一职责,并入 consolidate 会混淆内容与元过程。

### D2 触发 = 会话触发词 + cron 双通道(采纳)

只做会话触发是**自指陷阱**:retro 的核心职责是审计「该做没做」,如果它自己也依赖人记得触发,它会和写回一样停摆。而 2026-08-10 已证 cron 腿稳定在转(08-07 起每天自然触发),是可靠通道。

新 cron 直接用 `kind: skill` 形态(不用内联 prompt),理由:① inbox-tidy 已示范该形态;② 天然不产生 08-10-cron-contract-skills 要消除的「user 数据冻结」死角,并为那个任务提供迁移范例。`entrypoint` 在契约里是必填(`core/contracts/cron.ts:136`),取 `weekly`。

排期 `0 23 * * 0`(周日 23:00),在 memory-consolidate(22:00)之后。

### D3 输出落点 = gbrain 页 + cron 自带日志(采纳)

- 机器可召回:gbrain note 页 `memory/retro/<YYYY-MM-DD>`,按 gbrain.md 的 **dated memory record** 例外条款(每周新页、同周重跑覆盖同页、`tags: [retro, weekly]`)。
- 人可读:cron 框架已自动把每次运行输出落 `.jspace/logs/cron/workbench-retro/<timestamp>.md`,**无需另造落点**。
- **不写 filehub**:retro 是治理产物不是资产;写进 filehub 会污染资产层语义(资产 = 值得长期归档的重资产本体)。

### D4 检查项必须可机械取证(核心约束)

自省最容易退化成「AI 编一段听起来对的反思」。防呆手段:每条检查都绑定**具体取证命令**,判读规则写死,拿不到证据就报「无法判定」而不是猜。细则落 `references/checks.md`,SKILL.md 只留主流程与决策表。

### D5 只提议不改(红线)

输出分三级:**立即可做**(机械修复,如挂接缺失)/ **需你决策**(建域、改 skill、改纪律)/ **观察中**(信号不足,记录待下周复核)。任何规则、skill、README、hub.json 的修改都必须用户确认后另行执行。无头模式同理——只产报告,与 inbox-tidy 的「无头零提问」哲学一致。

## 3. 检查项设计(六条,均带取证命令)

| # | 检查 | 证据 | 判读信号 |
|---|---|---|---|
| 1 | 写回执行率 | `gbrain list --type note` 的 `project/*/state` updated_at;对比本周活动痕迹(filehub mtime / cron 日志) | 有活动但 state ≥7 天未动 → 写回缺口 |
| 2 | 挂接一致性 | `ls <filehub>/projects/` vs 域 README 项目表 vs `jspace project list` | 存在未挂接项目 → 立即可做 |
| 3 | 指针有效性 | 抽样 `gbrain list --type reference` → `gbrain get` 取 Pointer → `test -f` | 断指针 → 立即可做(或资产未同步) |
| 4 | 流程卡点 | `jspace cron check` / `jspace ingest list` / `jspace pending list` / `.jspace/logs/cron/*/` 里的 failed | 重复失败或堆积 → 需决策 |
| 5 | inbox 停滞 | `<filehub>/_inbox/` 中 mtime >7 天的文件 | 模糊项反复被跳过 → 第二遍从未人工过目 |
| 6 | 规则进化候选 | 本周新增 `knowledge/*` 页主题;cron 日志里重复出现的同类处置 | 同一主题反复 → 提议沉淀/建 skill/改 skill |

第 6 条是「skill 修订」的入口——jspace-use §8.3 只讲何时**新建**,retro 补上何时**修订**。

## 4. 改动面

| 文件 | 改动 |
|---|---|
| `skills/workbench-retro/SKILL.md` | 新建(frontmatter triggers + 决策表 + 六步 + 自检) |
| `skills/workbench-retro/references/checks.md` | 新建(六条检查的取证命令与判读细则) |
| `skills/workbench-retro/references/example-retro.md` | 新建(golden run) |
| `skills-manifest.json` | +workbench 条目(`dependencies: [jspace-use, memory-writeback, asset-ingest]`,`entrypoints: [weekly]`) |
| `templates/workbench/.jspace/cron.json` | +workbench-retro(`kind: skill`,`enabled: false` 随模板默认) |
| `skills/jspace-use/SKILL.md` | §7 路由表 +1 行(retro 何时用) |
| `AGENTS.md` L11 / `README.md` L16 / `core/contracts/skills.ts:35` / `skills/jspace-use/references/gbrain.md:16` | 「4 个」→「5 个」 |
| `cli/*.generated.ts` + `templates/workbench/AGENTS.md` | gen-assets 自动产出(Brain-ops 块自动渲染,勿手改) |

**无 TS 逻辑改动** —— 全部由 manifest 驱动,这是架构单一事实源设计的红利。

## 5. 兼容与回滚

- 新增 skill 对既有工作台是纯增量:`workspace upgrade` 会 create 新文件,不触碰已有内容。
- 模板 cron.json 是 **user ownership**(`application/workspace/ownership.ts:20`),升级永不覆盖 → 存量工作台(含本机 `~/jspace-work`)**不会自动获得该 cron**,需手动添加。本任务在本机手动加并记录,存量迁移通道由 08-10-cron-contract-skills 统一解决。
- 回滚:`jspace workspace upgrade --rollback <id>`;仓库侧 `git revert`。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| retro 报告变成套话 | D4 取证命令强约束;拿不到证据报「无法判定」 |
| 与 consolidate 重叠 | §1 分工表写进 SKILL.md;时序后置 |
| 建议清单没人看 | cron 日志 + gbrain 页双落点;下次会话 session-start 注入可带出 |
| 无头模式误改文件 | D5 红线:只提议不改,无头模式同样只产报告 |
