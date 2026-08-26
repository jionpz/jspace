# 专家团队 Review 报告 — jspace-use 重构规划

- **评审对象**:`prd.md` / `design.md` / `implement.md` / `research/audit-*.md` ×5
- **评审方式**:4 视角并行评审(架构一致性 / 证据核实 / 实施可执行性 / 风险与发布)→ critical/major 对抗性验证 → 综合主席裁决
- **日期**:2026-08-06
- **最终裁决**:**APPROVE_WITH_CHANGES** — 设计扎实、无根本缺陷,但 3 个 CONFIRMED major + 1 个 PLAUSIBLE major 需先修订再进实施。

---

## 一、各视角结论摘要

| 视角 | 结论 |
|---|---|
| 架构与产品一致性 | 规划质量高;D1/D2/D4/D5/D7/D9/D10 与 PRD 自洽;§2.1 归属矩阵无职责重复;§4 数据流完整;未越 Out of Scope。2 major + 3 minor |
| 证据核实 | 独立全仓 grep 交叉核验:引用清单无遗漏、file:line 证据高度真实、测试分类准确、dependencies 死元数据确认。1 major + 2 minor |
| 实施可执行性 | Phase A-H 顺序与 gate 成立,可执行。5 minor(无 major) |
| 风险与发布 | 数据安全面成立(user 数据不覆盖、remove 前备份、rollback 充分、无兼容层);pipe-install 守卫干净。1 major + 4 minor |

---

## 二、CONFIRMED major(必须修订)

### M1. G7 残留终检与 F1 迁移测试互相矛盾
- **冲突**:F1(implement L80)要求 legacy 迁移测试保留 `jspace-bootstrap` 字面量(旧 rel → remove 断言),但 G7(implement L100-101)豁免清单仅列 `.trellis/`/git 历史/`.template-hashes.json`,不含测试文件 → Gate G 不可达或被迫删迁移断言。
- **证据**:workspace.test.ts:349-429 现有 21 处旧名字面量;`git ls-files` 确认测试为已跟踪活动代码。
- **修复**:G7 豁免清单显式加入「workspace.test.ts legacy 迁移回归测试(旧名→新名断言)」,以带注释排除行纳入;AC9 散文与 G7 操作定义同步口径。**切勿为过 grep 删迁移断言**(那是真实存量工作台 upgrade-removal 路径的唯一回归保护)。

### M2. D6 概念词软策略误归 GOAL.md:56 活体指代
- **问题**:GOAL.md:56「三者由工作台规则与 bootstrap skill 保障」的「bootstrap skill」是本次改名 skill 的**现役产品指代**(紧邻 :57 引用其 references/harnesses.md 路径),不是「首次配置阶段」纯概念。D6 将其归软桶 → 字面执行会产生「由工作台规则与首次启用保障」的失去实体指代病句;AC9 精确串 grep 无法兜住「bootstrap skill」。
- **修复**:GOAL.md:56 移入**硬目标**,改写为「工作台规则与 jspace-use 指南保障」(保留实体指代);仅 GOAL.md:83(M2 历史里程碑)保留概念词;Phase G7 追加对「bootstrap skill」「bootstrap 指南」等非精确串的人工/正则复查。

### M3. remove/stale 仅对 journal 有记录的 rel 生效,pre-journal 存量孤儿静默残留
- **机制确认**:manifest.ts:165-176 remove/stale 分支只遍历 `Object.keys(deps.recorded)`(materialized journal);磁盘上「既不在新 manifest、也不在 recorded」的文件不产出任何 DiffEntry。workspace.ts diff/upgrade 完全由 diffBundle 条目驱动,无目录扫描兜底;doctor 无 orphan 检测。
- **真实路径**:journal.ts:32「absent = no known base (old workbench / fresh clone)」→ journal 缺失即空集。pre-journal 版本 init 物化的工作台、更早 root `skills/` 布局副本会静默残留。
- **修复**:design §4.2 显式写明 remove/stale 前提(仅 journal 有记录);为「磁盘存在但无 journal 记录」的旧名副本增加处理或诊断(doctor warning / diff 报告 orphan),并纳入 G5 演练。

## 三、PLAUSIBLE major(建议采纳)

### P1. 跨 skill `../` 引用在 CI 无任何护栏
- **核实**:memory-writeback 5 处 `../jspace-bootstrap/...` 存在;assets-reachability resolve()(:44) 对 `../` 返回 null 跳过;PR 门禁 verify.yml 只有 bun test + gen-assets 新鲜度 + smoke,**无 check-skills** → 跨 skill 引用漏改可静默通过。
- **修复**:扩展 `cli/assets-reachability.test.ts` resolve() 支持 `../<skill>/references/x.md` 与 `../<skill>/SKILL.md`;在 PR 门禁(verify.yml)补跑 check-skills 或 assets-reachability 的跨引用断言。

---

## 四、minor(12 条,采纳清单)

| # | 建议 | 落地 |
|---|---|---|
| m1 | D3 校验落点移入 renderAgentsBlocks 循环(消除双解析) | design D3 + implement B1 改写 |
| m2 | §2.2「七章/六章」口径统一 | 提升 3.1-3.3 为一级章凑足七章(对应 PRD R2 七主题),implement C2 同步 |
| m3 | §2.2 悬空 §3.3 引用;triggers 关键词清单未定义 | 补明确 triggers 建议(upgrade/doctor/cron check 等) |
| m4 | §1.1 头部「23+ 处」无法溯源且低估(实测 89 处原始出现) | 改为可溯源精确表述 |
| m5 | audit-references §8 漏 SKILL.md:84 对 example-bootstrap.md 的引用 | 补列 |
| m6 | 存量 cron.json bootstrap target 改后报错未提 | Phase D/G5 补说明(手动改 target.skill 或注明) |
| m7 | bundle_version 不随内容升,H4 仅软提醒 | H4 升级为硬性收尾门禁(新 tag ≥1.0.9 + 收敛演练) |
| m8 | upgrade 后 journal 重写丢旧 rel,rollback 孤儿未断言 | G5 --rollback 追加断言(旧目录还原 / journal 不含旧 rel / 再升级幂等) |
| m9 | harness-config 旧副本反向路由无落地动作 | Phase H 补发布动作(release note 提示重装);G7 断言 harness-config 源码无旧名 |
| m10 | pipe-install 守卫 ±8 行窗口与「示例必须留 SKILL.md」未显式化 | C2 + F2 显式化 |
| m11 | Phase C 回退点未覆盖 example-*.md 重命名残留 | 回退点表补全 |
| m12 | 验证清单可补 assets-reachability / D3 负向用例 / Phase C 中段禁跑 | E2/Gate C 补 |

---

## 五、裁决依据

设计扎实点:单一事实源加固(D3)合理;升级全 manifest 泛化(改名对机制零改动)确认;无兼容改名符合 PRD R5;证据真实度极高(24 文件清单交叉核验一致)。3 个 major 均为**口径断点/边界缺口**,非方向错误,在文档/计划层修订即可,无需返工设计。
