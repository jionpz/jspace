# cron 契约升格 — 技术设计

## 1. 问题精确定义

`.jspace/cron.json` 的 ownership 是 **user**(`application/workspace/ownership.ts:20`),`workspace upgrade` 永不覆盖。weekly-report / memory-consolidate 的输出契约(产物路径、slug、幂等语义)以**长内联 prompt**存在于该文件 → 自拷入用户工作台那刻起冻结,未来纪律进化永远到不了存量工作台。

对照组:inbox-tidy 已用 `target: {kind: skill, ...}`,契约在 SKILL.md(seed ownership,随 upgrade 刷新),`input` 只留一句薄引导。**机制现成,本任务是把另外两个迁过去。**

运行时链路已验证:`compileSkillTarget`(`application/automation/definitions.ts:77`)校验 skill 存在/entrypoint 合法/**材料化是否过时**,再组装 `阅读并执行 <SKILL.md> 的 <entrypoint> 流程:<input>`。

## 2. 关键设计决策

### D1 两个薄 skill,不做 entrypoint 复用(采纳)

候选:(a) 两个独立薄 skill;(b) consolidate 并入 memory-writeback 作 entrypoint;(c) 合成一个 `periodic-digest` 双 entrypoint。

选 (a),理由:
- **cron id == skill name == 它做的事**,零指向层。(b) 会让 cron.json 里出现「id: memory-consolidate / skill: memory-writeback」的错位;(c) 同理。
- **gbrain resolver 路由**:用户在会话里可能说「生成本周周报」「巩固一下记忆」;作为独立 skill 才有自己的 triggers,作为 entrypoint 对 resolver 不可见。
- memory-writeback 的 SKILL.md 现有纪律明写「周快照 → 转 memory-consolidate,本 skill 不写」——(b) 会推翻这条既有边界,收益不抵。

代价:skill 数 5→7。缓解:两个都保持**薄**(契约 + 步骤 + 指针,纪律引用既有文档不复制),description 的 `Do NOT use for` 写死边界防路由抢占。

### D2 存量迁移信号 = doctor info 检查(采纳)

只写文档等于**继续沉默**——本任务要消除的正是「无声漂移」。加检查:

```
cron.inline_prompt_legacy (info):
  某 cron 用内联 prompt(无 target)且其 id 恰好等于一个官方 skill 名
  → 提示改用 target: {kind: skill, skill: <id>, entrypoint: weekly}
```

零误报设计:自定义 prompt 的 cron(逃生舱)id 不会撞上官方 skill 名,不触发。实现落 `checkCrons`(`application/diagnostics/doctor.ts:522`),`CronLike` 加 `target?: {skill: string}` 结构视图。**不自动改 cron.json**(user 数据红线),只提示。

### D3 契约不变性 + 一处欠定义的修补

契约文本**逐字迁移**,产物路径/slug/幂等语义不变:

| | 产物 | 日期取法 |
|---|---|---|
| weekly-report | `<filehub>/areas/周报/<date>-周报.md` + gbrain `assets/周报/<date>` | **周起始日(周一)**(现存 `2026-08-03-周报.md` 由 08-09 周日运行产出,即周一日期) |
| memory-consolidate | gbrain `memory/consolidate/<date>` + 各 `project/<id>/state` 回写 | **运行日**(现存 `2026-08-03` / `2026-08-09` 两页均为运行当日) |

**发现的欠定义**:consolidate 用运行日命名 + 声明「同周重跑覆盖同页」二者不自洽——周日跑完周二再跑会生成不同 slug,幂等失效。修补方式**不改既有页**:在 SKILL.md 写死「先 `gbrain list` 查本周是否已有 consolidate 页,有则覆盖那一页;无则用运行日建页」。正常周日单次运行产出的 slug 与今天完全一致(契约不变),只把重跑路径补成真幂等。

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `skills/weekly-report/SKILL.md` | 新建(薄:契约 + 发现活跃项目 + 步骤 + 自检) |
| `skills/memory-consolidate/SKILL.md` | 新建(薄:契约 + 归纳纪律指针 + 幂等修补 + 自检) |
| `skills-manifest.json` | +2 条(各 `entrypoints: [weekly]`) |
| `templates/workbench/.jspace/cron.json` | 两任务 `prompt` → `target`,input 收薄 |
| `application/diagnostics/doctor.ts` | `CronLike.target` + `cron.inline_prompt_legacy` 检查 |
| `application/diagnostics/*.test.ts` | 新检查单测(阳性 + 阴性) |
| `skills/jspace-use/SKILL.md` | §7 路由表 + §8.4 cron 治理补迁移指引 |
| 文档计数 5→7 | `AGENTS.md` / `README.md` |

## 4. 兼容与回滚

- 新 skill 对既有工作台是纯增量(upgrade create)。
- 模板 cron.json 不下发 → 存量工作台保持内联 prompt 继续可用(**不破坏**),由 doctor info 提示迁移,用户手动改。本机 `~/jspace-work` 在本任务内手动迁移作为验证。
- 回滚:`git revert`;工作台 `jspace workspace upgrade --rollback <id>`;cron.json 手动改回(有备份)。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 迁移后产物路径/slug 变化 → 破坏既有页与周报文件 | D3 逐字迁移 + rehearsal 真跑比对产物 |
| 新 skill 抢占既有路由 | triggers 收窄到「周报 / 记忆巩固」等专有词,description 写死 Do NOT use |
| doctor 新检查误报 | 只在「id == 官方 skill 名」时触发,自定义 cron 不受影响;info 级不阻断 |
