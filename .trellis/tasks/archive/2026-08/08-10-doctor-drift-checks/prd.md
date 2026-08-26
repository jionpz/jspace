# doctor 漂移增检

## Goal

把审查发现的四类「静默漂移」变成 doctor 可见信号——本机四处漂移(块外遗产、副本过时、项目未挂接、type 契约外)全部是真实发生且无任何机制提示的。复杂任务:`task.py start` 前需补 `design.md` + `implement.md`;P2,建议在 P1 子任务落地后实施以便一并校验。

## Requirements(四个候选检查,允许 design 阶段裁剪)

- R1 `agentsmd.stale_outside_block`(warn):工作台 AGENTS.md 受管块外出现陈旧标记——`TRELLIS-*-BEGIN/END` 生成块标记、或已废弃 skill 名(如 `jspace-bootstrap`)。检测面窄而准(只认确定性标记,不做语义判断),避免误伤用户自有内容。
- R2 `skills.copy_outdated`(info):工作台 `.jspace/skills/`、投影目录、用户级 `~/.agents/skills/` 与二进制内嵌资产不一致(hash 对比);提示对应修复命令(`workspace upgrade` / `skills install`)。
- R3 `registry.project_unlinked`(info):filehub `projects/<x>/` 存在但域 README 项目表与 hub `projects` 均未挂接(反向检查;现有 doctor 只查「注册了的存在」)。
- R4 gbrain 页 type 契约外值(`lesson|note|decision|reference|smoke` 白名单外,实测已出现 `concept`/`project`):**可行性存疑**——doctor 当前不依赖 gbrain 运行时;落点候选:doctor 可选检查(gbrain 可达才跑)/ memory-acceptance 协议扩展 / 写侧 skill 自检强化。由 design 决定,允许裁剪出本任务。

## 约束

- 全部为 info/warn 级,不产生 error(与 `domain.dormant` 同哲学:提示「看一眼」,不阻断)。
- 误报优先于漏报的场景才可保守(如 mtime 类);标记类检查(R1)要求零误报。
- 单测走真实生产路径(spec 教训:防假绿);输出格式对齐 `doctor --verbose` 现有约定。

## Acceptance Criteria

- [x] 采纳的检查各有单测(含阳性/阴性样本),`bun test` 绿;`bunx tsc --noEmit` 绿。
  → 新增 9 个单测(doctor.test.ts 48 pass;全仓 **546 pass / 0 fail**),tsc 0。R1 四例(生成标记阳性 / 废弃名阳性 / 标记仅在块内阴性 / 无块文件不扫阴性)、R2 三例(注入非空阳性 / 空阴性 / 未注入阴性)、R3 两例(未注册阳性 / ascii-id 绑中文目录阴性)。
- [x] 在 2026-08-10 审查基线的漂移场景下复刻:R1-R3 全部命中;修复后全部消失。
  → **R1**:把 `AGENTS.md.bak-20260810`(205 行块外旧全文)放回 → `agentsmd.stale_outside_block` warning,一次列全三个信号(两个生成块标记 + `jspace-bootstrap`);还原后消失。
  → **R2 是真实自发命中**:重建二进制后未升级工作台,doctor 立刻报 `official skill(s) differ from the running bundle: jspace-use, workbench-retro`;`workspace upgrade` 后归零。这正是此前完全无声的失败模式。
  → **R3**:建 `projects/_doctor-probe/` → `registry.project_unlinked` info(文案含可直接粘贴的 `jspace project add` 命令);删除后消失。
- [x] `docs`/skill 中 doctor 检查清单同步(check-skills 绿);R4 的裁剪或落点决策记入 Key Decisions。
  → check-skills PASS / harness-consistency all pass / manifest-integrity 44。R4 落点转移记录见下。

## Key Decisions

- **R1/R2/R3 实现,R4 裁剪出 doctor**。
- **R4 移入 `workbench-retro` 检查 3**:doctor 是离线结构化诊断,引入 gbrain 运行时会带来可用性依赖与挂起风险;而 retro 本就在读 gbrain,**且首跑时自己就发现了这个问题**(`concept`×2 / `project`×1),证明这是它的天然职责。checks.md 检查 3 已加 `gbrain stats` 的 `pages_by_type` 白名单判读,基线数据加「契约外 type 页数」。
- **R2 用注入函数而非 doctor 直接 import**:doctor 的既有设计约束是不碰 `cli/*.generated.ts`(见 `officialSkillNames` 注释),故新增 `bundleStaleSkills?: (root) => string[]`,在 `cli/commands/helpers.ts` 用 `diffBundle` + `BUNDLE_MANIFEST` + 材料化 journal 实现。未注入时静默跳过。
- **R2 定 info 不定 warning**:所有权模型允许本地编辑 skill,那会显示为 conflict——报 warning 等于惩罚正常用法。
- **R3 只比对 hub.json,不解析域 README 表格**:markdown 表格是散文,正则解析必然脆弱且会误报;README 挂接由 jspace-use §8.7 checklist 保障,doctor 只守机器可判定的那一半。
- **R1 零误报三重保险**:无 JSPACE 块的 AGENTS.md 完全不扫(用户自建文件);只认机器生成标记与已退役 skill 名;绝不做语义判断。

## 实现记录

- 既有 `skills.projection_drift` 只比对「工作台内部副本 vs `.jspace/skills/`」,**不覆盖** bundle 方向——R2 因此不是重复造轮子。cron 路径经 `compileSkillTarget` 早有此校验,doctor 路径此前缺失,导致过时只在某个 cron 恰好运行时才暴露。
- 编辑中误删了 `checkDomains` 的文档注释,已补回;`RETIRED_SKILL_NAMES` 常量顺带复用进既有的 legacy-root-copy 检查(消除 `"jspace-bootstrap"` 字面量重复)。
