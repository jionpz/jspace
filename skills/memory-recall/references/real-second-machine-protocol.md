# 真实第二机演练协议(REAL-SECOND-MACHINE)

> 可复跑的**换机验证**协议:在**真实物理第二机**上证明「记忆可移植 + 指针可解析」,而不是再跑一遍本机模拟。
> 定位:`~/.agents/skills/memory-recall/references/memory-acceptance.md`「换机解析扩展(M5)」的**真机执行面**——指针语义、断言链、通过标准全部沿用,本协议只加真机前置、降级分级与回写字段,不另造第二套语义。
> 本文件为**中性版**(`<A>` / `<B>` = 两台机器、`<filehubA>` / `<filehubB>` = 各自文件中心根、`<export>` = 导出目录、`<date>` = `YYYY-MM-DD`)。真实主机名、绝对路径、查询分数留在本机证据台账,**不回填本文件**。

## 红线(先读,三条)

1. **B 必须是另一台物理机**。同机第二目录、`GBRAIN_HOME` 旁路、容器、CI、Cloud Agent 都**不得**用来关闭「真实第二机」跟踪项——它们的效力等同 M5 本机模拟(同机 / 同 OS / 同 embedding 可达),已被 M5 覆盖,再跑一遍不产生新信息。旁路只可作调试手段。
2. **不封装 gbrain、不自研同步**。全部动作走既有 CLI:gbrain Tier 3(`export` / `import` / `embed --all` / `models doctor`,见 `~/.agents/skills/jspace-use/references/gbrain.md`)+ `jspace init` / `filehub init --register` / `doctor`;资产走既有分层同步(网盘 / Obsidian Sync / 手工拷贝)。**不**新增「一键换机」命令。
3. **不伪造证据**。export 页数、`test -f` 结果、top-1 slug 一律以真实终端输出为准;真机未跑完前 `eco.verdict` 留空,不写 `confirmed`,也不用「协议已发行」冒充「真机已验证」。

## 角色与「真的是第二机吗」判据

| 角色 | 要求 |
|---|---|
| **机器 A**(源) | 已有工作台 + live gbrain + 已注册 filehub;至少一份带 `rel_path` 的 asset 指针页 + 可召回语料 |
| **机器 B**(目标) | 另一台物理机;独立工作台 / 独立 filehub 根 / 独立 brain。OS 可同可异,**须如实记录**(同 OS 同架构时效力边界照写) |

三条判据同时成立才算真机(任一不成立 → 本次只能记作模拟,不得关闭跟踪项):

1. 主机标识不同(`hostname` / `uname -a` 不同机器);
2. filehub **绝对根不同**(`<filehubA>` ≠ `<filehubB>`,不是同一物理目录的软链或同步挂载点的两个视图);
3. gbrain 数据目录彼此独立(B 是 `gbrain init` 建的新库,不是共享同一份 DB 文件)。

---

## 阶段总览(P0–P7)

| 阶段 | 目的 | 关键动作 | 必过断言 |
|---|---|---|---|
| **P0** 前置 | 两边可对照 | A 侧留基线快照 | embedding 可达留痕;目标页均有 `rel_path`;A 侧 top-1 可复述 |
| **P1** A 导出 | 文本规范源离机 | `gbrain export` | 导出页数 ≥ 预期;`rel_path` 保留;边/backlink 状态如实记 |
| **P2** B 建台 | 独立控制面 + 资产根 | `jspace init` + `filehub init --register` + 资产同步 | B filehub primary 可解析;`test -f "<filehubB>/<rel_path>"` 成立 |
| **P3** B brain | 独立记忆库 | `gbrain init`(即带正确 embedding)→ `import` → `embed --all` | B 与 A 隔离;`embedding_reachability: ok`(或走 R4 降级);import 页含原 `rel_path` |
| **P4** 换机解析 | 指针可移植 | 按 `rel_path` 重解析 | 解析成功 + 文件存在;旧 Pointer ≠ 新 Pointer 而 `rel_path` 相同 |
| **P5** 召回对照 | 记忆可移植 | B 侧跑与 A 相同的规范查询 | 声明的最小查询集 top-1 与 A 一致;负对照不串台 |
| **P6** 问一句闭环 | 产品句验收 | 按 memory-recall 走四连并作答 | 答案引用 **B 机绝对路径** + slug |
| **P7** 回写 | 闭合跟踪 | 填证据台账 → 回写 `GOAL.md` | 台账无空必填项;效力边界诚实 |

**P4 与 P5 独立记分**:embedding 暂不可达时,指针腿(P4)仍可判「真机过」,召回腿(P5)记降级待复跑——避免整单作废或整单假绿。

---

## P0 · A 侧基线(离机前必须留痕)

```bash
gbrain models doctor --json          # embedding_config / embedding_reachability,连同时间留档
gbrain get <slug>                    # 抽样确认 frontmatter 有 rel_path
gbrain query "<规范查询>"             # 记录 top-1 slug 与相对次序(≥2 条)
```

- 规范查询集:复用 `~/.agents/skills/memory-recall/references/memory-acceptance.md` 的 Q1 / Q1' / Q2 / Q2'(或当前语料的等价集,**逐字固定**并写进台账),含变体与负对照。
- 目标页缺 `rel_path` → 先按 `~/.agents/skills/asset-ingest/references/gbrain-write.md`「rel_path」补写(`rel_path` = Pointer 减去 filehub 根前缀),补完再导出。**不要**带着缺字段的页进 P1。
- 记录 A 侧 filehub 根绝对路径(只进本机台账,不进本文件)。

## P1 · A 导出

```bash
gbrain export --dir <export>
```

- 在 **serve 停泊窗口**内执行(gbrain serve 是某 harness 会话的 stdio 子进程;禁 `kill`、禁独立重启,见 `~/.agents/skills/memory-recall/references/discipline.md` §1)。
- probe 产物形态:md 页(slug 路径 + frontmatter)。抽查任一 asset 页,确认 `rel_path` 字段在导出物里**原样保留**。
- 边 / backlink:有互链语料 → 记录导出物里是否有独立边文件,留待 P3 验回灌;无互链语料 → 台账记 `n/a-no-wikilinks`(与 M5 一致,不阻塞主结论)。
- 台账记:导出目录、页数、导出时刻。

## P2 · B 建台(控制面 + 资产根)

```bash
jspace init <wbB>                                  # 或复用 B 上既有工作台
jspace filehub init <filehubB> --register --dir <wbB>
jspace doctor --dir <wbB>
```

- `<filehubB>` 的绝对路径**必须**与 A 不同(判据 2)。
- 资产按既有同步策略落到 `<filehubB>`,且**相对布局与 `rel_path` 一致**——即 `<filehubB>/<rel_path>` 必须指到同一份文件本体。同步方式(iCloud / Obsidian Sync / 手工拷贝 / 移动硬盘)如实记进台账。
- B 侧缺文件(只同步了一部分)→ 走 `~/.agents/skills/asset-ingest/references/migration.md` 的增量收编策略,**不要**把「搬文件」做成 jspace 新命令,也不要为了让断言过而在 B 上凭空造同名文件。
- 通过信号:`jspace doctor` 无 filehub 致命项;抽样 `test -f "<filehubB>/<rel_path>"` 成立。

## P3 · B brain(独立记忆库重建)

```bash
gbrain init                          # 关键:init 即带正确 embedding 配置
gbrain import <export> --no-embed
gbrain embed --all
gbrain models doctor --json
```

- **M5 教训(必须遵守)**:`gbrain init` 时就配好 embedding,**不要**先 `--no-embedding` 再改维度——事后改维会带来重建索引的额外成本与不一致风险。
- B brain 与 A 隔离(判据 3):import 只从 `<export>` 读文本页,不连 A 的 DB。
- 断言:导入页数与 P1 导出页数一致;抽样 `gbrain get <slug>` 仍含原 `rel_path`;`embedding_reachability: ok`。不可达 → 走 R4 降级分支,**不得**跳过 P4。

## P4 · 换机解析(指针腿,不可跳过)

对每条验收 slug:

```bash
gbrain get <slug>                                  # ① 读页;页内 Pointer 仍指向 A 机绝对路径
# ② 读 B 机 hub.json 的 type: filehub resource(primary: true)-> <filehubB>
test -f "<filehubB>/<rel_path>"                    # ③ 本机 Pointer 存在
grep -c "<事实关键词>" "<filehubB>/<rel_path>"      # ④(可选)找到那个数
```

- **不得**直接信任页内旧机绝对 `Pointer`——换机解析规则见 `~/.agents/skills/memory-recall/references/discipline.md` §8。
- 台账记:抽样条数 N、通过条数、以及「旧 Pointer ≠ 新 Pointer 而 `rel_path` 相同」这一对照。
- 失败处置(按 §5 诊断,不自愈):`rel_path` 缺失 → 写侧纪律缺口(点名 slug);根读不到 → hub / binding 未配;文件缺失 → 资产未同步。三种都**报告用户**,不改 gbrain、不静默改 Pointer、不为了让断言过而手工编页。

## P5 · 召回对照(记忆腿)

```bash
gbrain query "<规范查询>"            # hybrid
gbrain search "<关键词>"             # 关键词对照(双路径留证)
```

- canonical 面 = CLI,serve 停泊窗口内(与 `~/.agents/skills/memory-recall/references/discipline.md` §1 一致);A / B 两侧必须同一面,否则证据不可比。
- 通过标准:P0 声明的最小查询集在 B 侧 top-1 与 A 一致,变体查询保持 top-1,负对照不串台。
- 不一致 → 按 `~/.agents/skills/memory-recall/references/memory-acceptance.md` 校准循环(≤3 轮)诊断,并区分「B 侧 embedding 配置不同」与「记忆内容丢失」——前者是环境差异,后者才动摇可移植结论。

## P6 · 问一句闭环(产品句)

在 B 上按 `~/.agents/skills/memory-recall/SKILL.md` 走完整读侧流程:query → 四连(① `gbrain get` ② 用**重解析后**的 Pointer `test -f` ③ grep 找数 ④ top-1 slug 一致)→ 作答。

- 通过标准:答案引用 **B 机绝对路径** + slug;不得只报「页里有」。
- 这是唯一一条同时压住指针腿与记忆腿的端到端断言,P4 / P5 都过了才有意义。

## P7 · 回写

1. 填下方**证据台账**(真实数字与路径留本机,如任务 notes 或工作台内记录)。
2. 按「GOAL 回写形态」更新 `GOAL.md` 开放问题 #1 与 M5 跟踪句。
3. 新学到的 setup 教训追加进 `eco.lessons`(如 M5 已有的「init 即配 embedding」)。

---

## 降级与替代关闭(允许写进 GOAL,须标效力)

| 情形 | 处置 | 可否关闭「真实第二机」跟踪 |
|---|---|---|
| B 侧 embedding 暂不可达 | 已有页 `embed_skip` + `gbrain search` 关键词冒烟 + 固定降级提示(不得静默);**P4 仍必须过** | 仅可标「指针真机过 / 语义召回降级待复跑」(`eco.verdict: partial`),**不可**宣称与 M5 同等召回效力 |
| 用户长期只有单机 | 跟踪项**保持开放**;台账写「挂账开放 + 缺真机窗口」 | 否——不得用本机模拟 / 容器 / CI 关闭 |
| 图谱边 / backlink | 有互链语料则 P1/P3 验正文 wikilink 是否仍在;无则 `n/a-no-wikilinks` | 不阻塞指针 / 召回主结论 |
| 资产只同步了一部分 | 抽样集缩小到已同步部分,台账写明覆盖率;缺的走 migration 增量 | 可 `partial`,须写明抽样口径 |

**用词纪律**(与平台台账同源):**真机已验证**(有真实终端证据)/ **替代关闭**(必须附一句效力边界)/ **挂账开放**(写清缺什么、怎么补)。三者不可混用,也不许把第三种写成前两种。

---

## 证据台账模板(`eco.*`)

跑完真机后逐字段填;**真实主机名 / 家目录全文 / 私密路径不进本文件与任何中性 skill 文档**,只留在本机记录。

| 字段 | 含义 | 形态示例 |
|---|---|---|
| `eco.date` | 真机演练日期 | `<date>` |
| `eco.machine_a` / `eco.machine_b` | 双机标识(OS/架构 + 匿名标签) | `macOS/arm64 · A` / `Linux/x86_64 · B` |
| `eco.path_divergence` | A/B filehub 绝对根是否不同 | `yes` + 相对差异说明 |
| `eco.asset_sync` | 资产如何到 B | `icloud` / `obsidian-sync` / `manual-copy` / … |
| `eco.export_import` | export→import→embed 是否成功 | `pass` / `fail` + 一句原因 |
| `eco.rel_path_resolve` | P4 抽样条数与结果 | `N/N pass` |
| `eco.recall_parity` | P5 top-1 与 A 是否一致 | `pass` / `degraded-keyword` / `fail` |
| `eco.ask_loop` | P6 是否引用 B 路径 | `pass` / `fail` |
| `eco.edges` | 边 / backlink | `pass` / `n/a-no-wikilinks` / `fail` |
| `eco.verdict` | 相对 M5 假设的真机结论 | `confirmed` / `partial` / `refuted`(**未跑完留空**) |
| `eco.lessons` | 新机 setup 教训 | 自由短句(追加式) |
| `eco.evidence` | 证据位置 | 本机任务记录路径(本地-only) |

### GOAL 回写形态

- **开放问题 #1**:在既有「本机模拟」结论句后,把「真实第二机:协议已发行,待真机(`eco.verdict` 待填)」替换为「**真实第二机:`<eco.verdict>`(`<eco.date>`)**」并指向 `eco.evidence`。
- **M5 子弹**:把「真实第二机待实际使用」升级为已验证 / partial,并**保留效力边界**(若 A/B 仍是同 OS、同 embedding provider,照写)。
- `eco.verdict: partial` 时必须同时写清哪条腿过、哪条腿降级(如「指针腿真机过、召回腿关键词降级」),不得笼统写「已验证」。

---

## 与既有纪律文档的关系(唯一源不重复)

| 文档 | 它管什么 | 本协议的关系 |
|---|---|---|
| `~/.agents/skills/memory-recall/references/memory-acceptance.md` | 可复跑验收协议 + 「换机解析扩展(M5)」通过标准 | 断言与通过标准的**唯一源**;本协议是它的真机执行面 |
| `~/.agents/skills/memory-recall/references/discipline.md` §8 | 换机解析规则(根 + `rel_path` → 本机 Pointer) | P4 直接引用,不复述规则 |
| `~/.agents/skills/asset-ingest/references/gbrain-write.md` | `rel_path` 定义 / 计算 / 存量补写 | P0 补字段依据 |
| `~/.agents/skills/asset-ingest/references/migration.md` | 存量资产增量收编 | P2 缺文件时的处置路径 |
| `~/.agents/skills/jspace-use/references/gbrain.md` | 后端契约分层(Tier 3 = `export` / `import` / `embed --all`) | P1/P3 命令面的能力边界(Tier 3 可选;缺则迁移走手工) |
