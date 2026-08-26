# M5 分发 — 技术设计

## 定位

**验证 + 落地**:验证记忆层可移植假设(GOAL 开放问题 #1),把指针从「绝对路径独苗」改为「绝对路径 + rel_path 双字段」并落地纪律。纯 CLI 消费 gbrain 能力,不封装、不改 gbrain 内部。

## 边界

**IN**
1. 本机模拟机器 B,跑「A 导出 → B 导入重建 → 指针换机解析 → 召回对照 → 问一句闭环」。
2. 指针双字段方案落地:REPO 纪律修订(gbrain-write / asset-ingest / memory-recall)+ M4 存量 2 页补 rel_path + JWorkspace 同步。
3. 结论落档:GOAL 开放问题 #1 关闭;REPO 侧中性,真实证据在任务 notes + JWorkspace。

**OUT**
- 真实第二机验证(本机模拟为裁决依据,结论标注效力有限)。
- 机器端 cron install / 已解锁任务实跑(rehearsal gate)。
- gbrain 内部实现改动、office 深入、媒体路径。
- Linux/Windows 真机(仅 R4 可选 CI Linux cron 冒烟)。

## 指针方案(双字段,核心决策)

| 字段 | 载体 | 角色 | 换机行为 |
|---|---|---|---|
| `Pointer` | 正文 `**Pointer:**` | 本机真理,日常打开用 | 保留原绝对路径(按机维护) |
| `rel_path` | frontmatter 新字段 | 机器无关标识(相对 filehub 根) | 换机按「目标机根 + rel_path」重解析 |

- **rel_path 定义**:从 filehub 根到文件的**全相对路径**(如 `projects/报表模块/2026-07-会议沟通记录.txt`),不含根前缀。
- **写侧计算**(asset-ingest 步骤 3):`rel_path` = Pointer 减去 filehub 根绝对路径前缀。filehub 根从 `hub.json` `type: filehub` resource 的 `primary: true` path 读。
- **换机解析规则**:读目标机 `hub.json` 的 filehub primary path(根)→ 根 + `rel_path` → 目标 Pointer → 断言 `test -f`。
- **回退触发**:演练中若 B 侧 rel_path 解析失败(结构变化/根读不到)→ 记录现象,回退方案二选一留痕:「保持绝对路径 + 换机重录」/「Pointer 只读相对 + resolver」。
- **存量页**:M4 的 2 个 reference 页无 rel_path → 演练前置给存量页补 rel_path(低成本,2 页),新写页由纪律保证。

## 演练环境(本机模拟双机)

| | 机器 A(真实) | 机器 B(模拟) |
|---|---|---|
| JWorkspace | `~/jspace-work`(hub 含 owner 域 + filehub 注册) | `~/jspace-work-b`(init 新工作台) |
| gbrain brain | `~/.gbrain`(现有,openrouter bge-m3 可达) | `~/.gbrain-b`(新建,独立) |
| filehub | `~/filehub`(含 M4 2 份资料 + index) | `~/filehub-b`(复制 A 内容;路径前缀不同→验证指针) |

- **B 侧 gbrain 多 brain 机制**:演练第一 probe 确认(gbrain 支持 `--home` / env / `init --dir` 之一),不确定则列命令实测;B brain 与 A 完全隔离。
- **embedding**:B 建 brain 后配可达 provider(与 A 同源或相同 provider);`import --no-embed` → `embed --all` 重建;不可达 → 降级记录 + 关键词冒烟(prd 已写)。

## 演练步骤(完整闭环)

1. **A 导出**:`gbrain export --dir ~/.gbrain-export`(serve 停泊窗口内;禁 kill serve / 禁独立重启)。**probe 产物**:导出物是否含图谱边/backlink(首要未知项),记录。
2. **建 B 环境**:
   - `jspace init ~/jspace-work-b`(生成新工作台);`jspace filehub init ~/filehub-b --register`(hub 注册 filehub-b 为 primary)。
   - `cp -r ~/filehub ~/filehub-b`(内容一致、前缀不同)。
   - B brain:`gbrain init`(独立 home)→ `gbrain import ~/.gbrain-export --no-embed` → 验证图谱边/backlink 回灌 → `gbrain embed --all`。
3. **指针换机解析**:B 读 `~/jspace-work-b/.jspace/hub.json` filehub 根 + `rel_path` → 断言 `test -f "<B根>/<rel_path>"`。
4. **召回对照**:B 上四条规范查询(Q1/Q1'/Q2/Q2')top-1 == A 侧记录(0.8751/0.8528/0.8953/0.8774);负对照不串台。
5. **问一句闭环**:B 上按 memory-recall skill 跑「历史数据迁移涉及多少存量?」→ 四连断言(用 rel_path 重解析后的 B Pointer)→ 答案引用 `~/filehub-b/...` 路径。

## 纪律修订内容(落 REPO 源)

| 文件 | 修订 |
|---|---|
| `skills/asset-ingest/references/gbrain-write.md` | 写页模板新增 `rel_path:` frontmatter(相对 filehub 根);说明换机解析用途 |
| `skills/asset-ingest/SKILL.md` | 步骤 3「入脑」:写页时计算 rel_path(Pointer 去 filehub 根前缀) |
| `skills/memory-recall/references/discipline.md` | §3 指针断言:日常用 Pointer;换机/导入场景按「hub.json 根 + rel_path」重解析后再断言;新增 §8 换机解析 |
| `docs/MEMORY-ACCEPTANCE.md` | 新增「换机解析扩展(M5)」节(中性):rel_path 规则 + B 侧断言;原四条用例与断言不变(R5 不回归) |

- JWorkspace skills 修订后同步(备份 + diff + doctor,沿用惯例)。
- M4 存量 2 个 reference 页补 rel_path(真实侧,不改 REPO 中性协议)。

## 与现有能力的关系

- **asset-ingest**(写侧):入脑时产出 rel_path——指针可移植的源头。
- **memory-recall**(读侧):换机场景用 rel_path 重解析——指针可移植的消费端。
- **gbrain**(记忆层):export/import/embed 提供「文本页 ↔ PGLite ↔ embedding」重建;sync `--missing-path skip` 兜底缺路径。
- **jspace CLI**:`init`/`filehub init --register`/`doctor` 提供工作台与 filehub 根解析。

## 风险与对策

- **图谱边/backlink 丢失**:probe 先行;丢失则记录范围 + 「边重建」结论 + 可能上报 gbrain 上游(不封装边界)。
- **gbrain 多 brain 机制未知**:阶段 A probe 实测;若 `--home`/env 均不支持,退路 = 临时设 `~/.gbrain` 为 B 用但**先备份 A brain**(`cp -r ~/.gbrain ~/.gbrain-bak`)再隔离演练,结束恢复——留痕。
- **embedding 不可达**:降级记录 + 关键词冒烟,结论如实标注。
- **锁时序**:全程 CLI、无 serve 常驻;A 侧导出/对照若被占用则协调停泊窗口。
- **真实换机**:本机模拟不能替代;结论标注「基于本机模拟,真实换机待跟踪」。

## 决策留痕

- **指针双字段**(Q3 已决):Pointer 绝对 + rel_path 相对;演练裁决,证伪则回退留痕。
- **真机不纳入**(Q2 已决):R4 CI Linux cron 冒烟可选。
- **单任务不分拆**:范围集中、顺序依赖强。
- **存量页补 rel_path**:演练前置,低成本。
