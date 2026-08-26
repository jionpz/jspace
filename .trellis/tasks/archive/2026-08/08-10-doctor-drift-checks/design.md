# doctor 漂移增检 — 技术设计

## 1. 候选检查的可行性裁决(勘察后)

| # | 候选 | 裁决 | 依据 |
|---|---|---|---|
| R1 | 块外陈旧内容 | **实现** `agentsmd.stale_outside_block`(warning) | 本机真实发生:205 行旧模板全文躺在受管块外 6 个月无人知;doctor 全绿却每会话注入双份矛盾规则 |
| R2 | skill 副本过时 | **实现** `skills.bundle_stale`(info) | **确认是真缺口**:既有 `skills.projection_drift` 只比对「工作台内部副本 vs `.jspace/skills/`」,没有任何检查比对「`.jspace/skills/` vs 二进制内嵌 bundle」。cron 路径经 `compileSkillTarget` 有此校验(日志实证 `skill asset-ingest is out of date`),doctor 路径没有 |
| R3 | 项目未挂接反向检查 | **实现** `registry.project_unlinked`(info) | doctor 现有 `filehub.project_stale` 已在遍历 `projects/`,只差与 hub 对照;本机曾是「filehub 有 2 个项目、hub 为空」 |
| R4 | gbrain type 契约外值 | **裁剪出 doctor,移入 workbench-retro** | doctor 是离线结构化诊断,不碰 gbrain 运行时;引入会带来可用性依赖与挂起风险。而 retro 本就在读 gbrain,且**首跑时自己就发现了这个问题**(`concept`×2 / `project`×1)——证明这是 retro 的天然职责 |

## 2. 逐检查设计

### R1 `agentsmd.stale_outside_block`(warning)

- **范围**:工作台根 `AGENTS.md`,**仅扫描 `<!-- JSPACE:END -->` 之后**的区域(块外 = 用户所有,upgrade 永不触碰 → 只有 doctor 能发现)。
- **信号**(命中任一):
  - 机器生成块标记 `TRELLIS-BRAIN-OPS:BEGIN` / `TRELLIS-SKILL-GOV:BEGIN` —— 用户不会手写这些,出现即旧模板残留;
  - 已废弃的官方 skill 名(`jspace-bootstrap`,v1.0.9 更名为 jspace-use)。
- **零误报保证**:无 JSPACE 块的 AGENTS.md **完全不扫**(用户自建文件),只认上述确定性标记,不做语义判断。
- **文案**:说清「块外归你所有,jspace 不会自动清理」+ 建议删除 + 提醒先备份。

### R2 `skills.bundle_stale`(info)

- **实现约束**:doctor 不得 import `cli/*.generated.ts`(现有设计约束,见 `CronHealthDeps.officialSkillNames` 注释)。因此新增**注入函数** `bundleStaleSkills?: () => string[]`,在 `cli/commands/helpers.ts` 用 `diffBundle` + `BUNDLE_MANIFEST` + 材料化 journal 实现,过滤 `.jspace/skills/<name>/` 前缀且 `action !== "no-op"` 的条目。
- **info 而非 warning**:本地编辑过的 skill 会显示为 conflict,那是**合法状态**(所有权模型允许);报 warning 会惩罚正常用法。
- **文案**:给出修复命令 `jspace workspace upgrade`(它同时刷新用户级 `~/.agents/skills/`,一条命令覆盖两处副本)。
- 未注入时静默跳过(测试/精简调用方不受影响)。

### R3 `registry.project_unlinked`(info)

- **对照面**:`<filehub>/projects/<x>/` 目录 vs `hub.json` 的 `projects[].asset_rel_path`。
- **只对结构化数据比对,不解析域 README 表格** —— markdown 表格是散文,正则解析必然脆弱且会误报。README 挂接由 §8.7 checklist 保障,doctor 只守机器可判定的那一半。
- 挂进现有 `checkInbox` 的 projects 遍历(已在同一循环里算 stale),零额外 IO。

## 3. 改动面

| 文件 | 改动 |
|---|---|
| `application/diagnostics/doctor.ts` | +3 检查;`CronHealthDeps` 加 `bundleStaleSkills?` |
| `cli/commands/helpers.ts` | 实现并注入 `bundleStaleSkills` |
| `application/diagnostics/doctor.test.ts` | 各检查阳性 + 阴性单测 |
| `skills/workbench-retro/references/checks.md` | 检查 3 扩展 gbrain type 契约(R4 的落点) |
| `skills/jspace-use/SKILL.md` | §6/§7 提及新诊断码(按需) |

## 4. 风险

| 风险 | 缓解 |
|---|---|
| R1 误伤用户自写内容 | 只认机器标记 + 废弃 skill 名;无 JSPACE 块则完全不扫 |
| R2 把合法本地编辑报成问题 | info 级 + 文案说明「本地改动会保留为 skip/conflict,属正常」 |
| R2 性能(diffBundle 全量 hash) | 只在 doctor 调用一次,与既有 `diffDirs` 投影比对同量级 |
| R3 误报(项目目录是临时草稿) | info 级;且只在已注册 filehub 的工作台生效 |
