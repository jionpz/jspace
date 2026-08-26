# Design — 内容对齐长期使用

> 子任务 C of `08-06-workbench-context-wiring`。需求见 `prd.md`。
> **本任务必须在 A、B 验收后启动**（依赖理由见 `prd.md` 顶部）。

## 1. 瘦身后的常驻块目标形态

判据：**一条规则该不该留在常驻块，看它是不是"每个会话、任何工作类型都要用到"**。
不满足的下沉到 jspace-use 或 references，常驻块只留一行指针。

| 现有段落 | 行数 | 处置 | 理由 |
|---|---|---|---|
| 头部说明 + Modes | ~8 | **留** | 每会话生效 |
| Daily Work Intake 表 | ~10 | **留但精简** | 核心路由；但注意子任务 B 的 `<next-action>` 已做求值，此表退为兜底 |
| Domain Governance | ~2 | 留 | 已经是指针形态 |
| Resource Governance | ~2 | 留 | 同上 |
| Registry Access | ~3 | **精简**，jq 用法下沉 `references/registry.md` | 低频操作细节 |
| Skill Governance + 渲染块 | ~7 | **移除渲染块**，留一句治理约定 | 子任务 A 后官方 selector 接管（D1） |
| Durable Knowledge Routing 表 | ~10 | **精简** | 保留路由语义，去掉可推导解释 |
| Development Mode | ~5 | **下沉** jspace-use 第 8 章 | 低频，且只对开发者有意义 |
| Agents | ~3 | 留 | 跨层归属规则，每会话生效 |
| Confirmation Rules | ~2 | **留** | 安全边界，不可下沉 |
| End-of-Work Capture | ~3 | 留 | 每会话生效 |
| Scheduled Tasks (cron) | ~3 | **精简** | 子任务 B 后 cron 状态已进 hook payload，此处退为一句 |
| Brain operations + 渲染块 | ~7 | **保留原样**（待 §2 验证） | gbrain resolver 外部依赖（D1） |
| Quality Checks | ~7 | **精简** | 部分项已由 doctor 覆盖，去重 |

预期从 111 行降到 **70 行以内**。这不是硬指标——判据是每一行都要能回答
"为什么它必须在每个会话里"。

## 2. `Brain operations` 的前置验证（**已用源码 + 实测完成，2026-08-08**）

`prd.md` C1.2 要求先验证再动。三个问题已逐条从 gbrain 源码（`~/.bun/install/global/node_modules/gbrain` v0.42.71.0）确认：

1. **gbrain 读哪个文件？** 通过 `autoDetectSkillsDir`（`src/core/repo-root.ts:118`）探测 `skills/` 目录，
   然后 `loadSkillTriggerIndex(skillsDir)`（`src/core/skill-trigger-index.ts:200`）同时读
   `skillsDir` **和 `skillsDir/..`** 下的 `RESOLVER.md` / `AGENTS.md`（`findAllResolverFiles`）。
   **探测优先级**：`$GBRAIN_SKILLS_DIR` → `$OPENCLAW_WORKSPACE` → cwd 向上找第一个 `skills/` →
   `~/.openclaw/workspace` → repo root `skills/` → gbrain 安装路径。
2. **它解析哪段？** `parseResolverEntries`（`src/core/check-resolvable.ts`）是**逐行正则**匹配
   `- **name**: trigger1 | trigger2`（Format 2），**完全不看** `<!-- TRELLIS-BRAIN-OPS -->` 标记，
   也不依赖 `## Brain operations` 标题——标记只是 JSpace 的渲染锚点，gbrain 逐行扫全文，
   任何匹配该格式的行都会被收录。
3. **能否从 frontmatter 读？** **已经能**。`loadSkillTriggerIndex` = frontmatter triggers
   （`skillsDir/*/SKILL.md`）+ resolver 行的**并集**（`mergeEntries`）。frontmatter 是 source of truth，
   resolver 行是补充。

**实测结论（~/jspace-work）**：

| 场景 | gbrain 探测到 | resolver 结果 |
|---|---|---|
| 现状（根 `skills/` 有 4 个旧副本） | 根 `skills/` | 4 skills all reachable（读的是**旧副本** frontmatter） |
| 根 `skills/` 移走 + 保留 Brain ops 段 | **回退到 gbrain 安装路径**（52 内置 skill） | 不读工作台任何东西 |
| 根 `skills/` 移走 + 移除 Brain ops 段 | 同上（52 内置） | 同上 |

**这暴露一个真实缺陷，比删段重要得多**：gbrain 的 auto-detect 只找根 `skills/`，
**从不读 `.jspace/skills/` 的 frontmatter**。当前 `~/jspace-work` 恰好因根 `skills/` 的历史遗留副本
（A 诊断的 `legacy_root_copy`）而工作；**用户一旦按 A 的诊断清理根 `skills/`，gbrain 对工作台官方 skill 的路由就断了**，
回退到 gbrain 自己的 52 个内置 skill。这不是假设——上面实测移走根 `skills/` 后立即发生。

**对 C 的决策影响**：

- **`Brain operations` 段删不删，不是这段本身的问题，而是 gbrain 能不能找到 `.jspace/skills/` 的问题。**
  段删了，只要 gbrain 仍读根 `skills/`（或配置指向 `.jspace/skills/`），frontmatter 已覆盖 triggers，不受影响。
- **必须补的接线**：给 gbrain 配置 `GBRAIN_SKILLS_DIR=.jspace/skills`（或 `OPENCLAW_WORKSPACE=工作台根`），
  让 gbrain 直读官方 skill 的 frontmatter。这应在 `harness-config` skill 或 gbrain 首次启用接线里落地，
  否则「官方 skill 路由到 gbrain」的能力是建立在用户尚未清理的历史遗留副本上的。
- **`Brain operations` 段的去留**：gbrain 并集读 resolver 行 + frontmatter，段是**冗余补充**。
  但既然 gbrain 目前靠根 `skills/` 旧副本才 reachable，段暂时**保留**（作为根 `skills/` 清理后的兜底来源之一），
  等 skillsDir 接线补齐后，段可随 Skill Governance 一起移除。
- **`check-skills.ts` C2/C3 契约**：C2 断言 `Brain operations rows == frontmatter triggers`，
  C3 断言 `Brain operations / Skill Governance 的 skill 集合 == skills-manifest`。
  移除任一渲染块 → C3 必须同步改，否则 CI 红；`scripts/skill-frontmatter.ts` 同时渲染两个块，需一并调整。

**S1 结论**：`Brain operations` 段保留（本任务不删），但**新增 gbrain skillsDir 接线文档 + doctor 诊断**
（见 §5：若 gbrain 未指向 `.jspace/skills/` 且根 `skills/` 无官方副本 → 提示配置，防路由静默断）。

## 3. jspace-use 第 3 章重写

现状 6 行、整章外包。目标形态是**四个高频场景各一小段**，每段"什么时候 → 做什么 → 去哪深入"：

```
### 进入工作台（每天第一件事）
会话启动时 hook 已注入 <current-state> 与 <next-action>（见 .claude/settings.json）。
直接按 <next-action> 走；要看全貌读 .jspace/hub.json。
状态没出现 → 跑 jspace doctor --dir . 查 hooks.not_wired。

### 进入某个域
读 workspace/<domain>/README.md + domain.json。域有 AGENTS.md / runbook.md 则一并读。

### 收工
有持久事实 → memory-writeback；有产出文件 → asset-ingest。都没有则静默结束。

### 每周体检
jspace doctor --dir .  看 info 级体检项（僵尸域 / 待归档项目 / 失效指针）。
处置规则见第 8 章「退役与回收」。
```

纪律不变：**不复制 AGENTS.md 的规则**，只给动线与指针（第 7 章「本指南 vs 其它事实源」的既有约定）。

**措辞依赖**：块名 `<current-state>` / `<next-action>` 必须与子任务 B 实际实现一致——
B 定稿前不要写死。

## 4. 退役与回收（jspace-use 第 8.6 节）

与既有 8.1 建域规则**结构对称**（信号 / 禁区 / 确定度 / 动作）：

| 对象 | 退役信号 | 处置 | 确认 |
|---|---|---|---|
| 域 | 目录长期未更新且 hub 中无活跃资源 | 归档或合并进邻近域 | **必须问** |
| 资源 | primary 路径不存在且非"任务本就关于缺失路径" | 修正指针或从 hub 移除 | **必须问** |
| 项目（filehub） | `projects/<x>/` 长期未动、index.md 标记结项 | 移入 `archive/<年>/` 并更新域 README | **必须问** |
| gbrain state 页 | 长期未更新 | 本轮不做（C4.3） | — |

`GOAL.md` 骨架里 `archive/<年>/` 早有位置，只是无人负责往里挪——本节补上这条动线。

**所有动作标注"必须问"**：删域、移文件都是破坏性操作，
全局治理红线要求未经确认不执行（`prd.md` D3）。

## 5. doctor 体检诊断

插入 `application/workspace/doctor.ts`，`info` 级，阈值取保守默认：

| code | 判定 | 默认阈值 |
|---|---|---|
| `domain.dormant` | `workspace/<d>/` 下所有文件 mtime 均早于阈值 | 90 天 |
| `filehub.project_stale` | `filehub/projects/<x>/` 全部 mtime 早于阈值 | 120 天 |
| `resource.primary_missing` | hub 中资源 primary 路径不存在 | 立即 |

**实现前先确认 `resource.primary_missing` 是否已被现有诊断覆盖**——
AGENTS.md 的 Quality Checks 提到"Registered resource primary paths should exist"，
但需核对 doctor 里是否真有对应实现，避免重复造。

mtime 判定的坑：`git clone` / 网盘同步会重写 mtime，导致误报或漏报。
因此**阈值取保守值 + 用 `info` 级**——它只是提示"看一眼"，不是断言"这个死了"。

## 6. 影响面与回滚

| 面 | 影响 |
|---|---|
| AGENTS.md JSPACE 块 | 既有工作台走 `block-update`（`manifest.ts:120-126`），块外用户内容不动 |
| 用户改过 AGENTS.md 块内 | `diffBundle` 判 `skip`，保留用户版本，不覆盖 |
| jspace-use SKILL.md | seed；未改随升级刷新，改过 `skip` |
| check-skills CI | C3 契约需同步改，否则红 |
| doctor 输出 | 新增 info 行；干净工作台应无新增 |

回滚：内容改动走 git；doctor 诊断可单独摘除。

## 7. 开放问题

- **O1** gbrain 能否改从 `.claude/skills/` frontmatter 读路由？若能，
  `Brain operations` 段也可移除，常驻块再降 7 行。需 gbrain 侧配合，**本轮不做**，记录即可。
- **O2** `project/<id>/state` 陈旧检测需要 gbrain，与"doctor 不依赖 gbrain"冲突。
  可能的出路是让 `memory-consolidate` cron 顺带产出体检行，而不是让 doctor 去查。
