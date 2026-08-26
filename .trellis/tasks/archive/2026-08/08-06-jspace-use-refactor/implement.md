# jspace-use 指南化架构重构 — implement

> 执行计划。上下文:design.md(架构决策)+ prd.md(需求/验收)+ research/(审计证据)。
> 顺序原则:先加单一事实源校验(守护改名全程)→ 改 skill 源 → 同步单源/跨引用 → 重跑生成 → 更新测试 → 端到端验证。

---

## 验证命令(全程使用,集中定义)

```bash
bunx tsc --noEmit                          # 类型门禁
bun test                                   # 单测 + 契约测试
bun test cli/assets-reachability.test.ts   # 跨 skill 引用可达性(E1.1 扩展后含 ../ 解析)
bun run scripts/check-skills.ts            # C1 引用完整性 / C2-C3 渲染一致性 / C4 生成新鲜度
bun run scripts/gen-assets.ts              # 重生成三件套 + AGENTS.md 生成块
git grep -n "jspace-bootstrap" -- . ':!node_modules' ':!.git'  # 残留自查(排 .trellis/archive;豁免见 G7)
```

---

## Phase A — 基线确认(改名前置)

- [ ] A1 `git status` 干净(允许 `.gitignore` 与 `.trellis/.template-hashes.json` 两个既有改动)。
- [ ] A2 `bunx tsc --noEmit` 绿。
- [ ] A3 `bun test` 绿。
- [ ] A4 `bun run scripts/check-skills.ts` 绿(C1-C4)。
- [ ] A5 确认 gen-assets 新鲜(C4 已隐含)。
- **Gate A**:基线绿才进入改名;任一红 → 先修基线。

## Phase B — 单一事实源加固(gen-assets.ts D3)

- [ ] B1 在 `scripts/skill-frontmatter.ts` 的 `renderAgentsBlocks` 内(已持有 manifest name 参数与解析出的 `fm`),对每个 workbench skill 校验 `fm.name === manifest 条目 name`,不一致 `throw`;导出该校验函数供 `check-skills` C3 复用。
- [ ] B2 重跑 `bun run scripts/gen-assets.ts` → 应无输出差异(现有 jspace-bootstrap 两源一致),`check-skills` C4 仍绿。
- [ ] B3 **负向用例**:临时把 SKILL.md frontmatter name 改错 → `gen-assets` 应 throw;改回后复绿。
- **Gate B**:校验生效且不破坏现有绿。

## Phase C — skill 源重构(bootstrap → use)

- [ ] C1 `git mv skills/jspace-bootstrap skills/jspace-use`(保历史)。
- [ ] C2 重写 `skills/jspace-use/SKILL.md`:
  - frontmatter:`name: jspace-use`;`description` 改为「**使用与维护**工作台指南」定位(含首次启用 + 日常使用触发语,保留 `Do NOT use for →harness-config / →asset-ingest` 边界);`triggers` 保留原 bootstrap 集合并扩展日常维护/诊断关键词(design §2.2b:how to use / 维护工作台 / upgrade / doctor / cron check / 故障排查)。
  - 正文:按 design §2.2 **七章**(1 工作台模型 / 2 首次启用 / 3 日常会话路由 / 4 gbrain 记忆 / 5 资源与资产 / 6 CLI 维护与诊断 / 7 边界与故障排查)重构(SKILL.md 主体 = 指南;references = 深入细则;首次启用流程压缩为章节,不再以「端到端执行脚本」面目出现)。
  - 保留 pipe-install 安全守卫措辞(`curl | bash` 不默认执行 / 下载临时文件 / 用户确认)——**该示例必须留在 SKILL.md 正文而非 references**,且前后 8 行内保留守卫措辞(`cli/lifecycle-and-safety.test.ts:37-49` 会断言)。
  - 保留自检(doctor / gbrain doctor / hub.json 合法性)。
- [ ] C2.1 Phase C 中段禁跑标注:SKILL.md 改名后至 Phase E 重跑 gen-assets 前,`check-skills` C2/C3/C4 会红 —— 属预期中间态,**不在此阶段修**,集中在 Phase E 收敛。
- [ ] C3 更新 `skills/jspace-use/references/*.md`:内部旧名引用与「bootstrap 阶段」措辞 → jspace-use / 首次启用;gbrain.md / registry.md / harnesses.md / headless-ops.md 内容主体保留。
- [ ] C4 `example-bootstrap.md` → 重命名为首次启用 golden run(建议 `example-guide.md` 或 `example-first-use.md`),标题与正文按 jspace-use 视角重写;同步 SKILL.md:68 与 :84 的引用(两处都引它)。
- [ ] C5 `agents/openai.yaml`:`display_name` / `default_prompt` 中 `jspace-bootstrap` → `jspace-use`。
- [ ] C6 skill 树内自查:`grep -rn "jspace-bootstrap" skills/jspace-use/` 无残留。
- **Gate C**:SKILL.md 指南化完成且内部无旧名;结构符合 design §2.2 七章。

## Phase D — 单源与跨引用同步

- [ ] D1 `skills-manifest.json:5` `"name": "jspace-bootstrap"` → `"jspace-use"`。
- [ ] D2 `skills-manifest.json:27` memory-writeback `dependencies` → `["asset-ingest", "jspace-use"]`。
- [ ] D3 memory-writeback 正文 5 处 `../jspace-bootstrap/references/gbrain.md` → `../jspace-use/references/gbrain.md`(SKILL.md:62,78 / references/writeback.md:3,48 / references/example-writeback.md:3)。
- [ ] D4 harness-config 反向路由:`SKILL.md:3,22` + `references/harnesses.md:277` 的 `jspace-bootstrap` → `jspace-use`。**发布动作**:harness-config 是 global skill(用户可能已自装 `~/.agents/skills/`),发布时 release note 标注「既有机器级副本需重新安装刷新」;harness-config 源内加自我诊断(检测到引用已删除的 jspace-bootstrap 即提示重装)。
- [ ] D5 `application/workspace/init.ts:117` 提示串 → `.jspace/skills/jspace-use/SKILL.md`。
- [ ] D5.1 存量 cron target 说明:若用户既有 `.jspace/cron.json` 的 skill target 指向 jspace-bootstrap → 改后编译 `unknown skill`。属数据层(user 所有权),upgrade 永不覆盖;文档/输出文案引导手动改 `target.skill` 为 jspace-use(或移除该 cron)。
- [ ] D5.2 **孤儿诊断(评审 M3 修复)**:`application/workspace/doctor.ts` 新增通用 orphan 检查 —— 扫描工作台 `.jspace/skills/` 下每个子目录,目录名不在 `SKILLS_MANIFEST.workbench` name 集合**且** materialized journal 无该 rel 记录 → 记 warning「orphan skill dir: .jspace/skills/<name>(不在当前 bundle 且无 journal 记录;若非用户自建可手动删除)」。**只检测 `.jspace/skills/`(官方管理区),不检测根 `skills/`(用户自建区)**。硬编码名零(jspace-bootstrap 只作为案例出现)。`workspace diff --json` 若实现成本低则同样报告 orphan。加 `doctor.test.ts` 用例(预置无 journal 记录的旧 skill 目录 → 断言 warning)。
- [ ] D6 模板手写散文:
  - `templates/workbench/AGENTS.md:129` — 路径 + 措辞(「bootstrap 后接线」→「首次启用接线后」)。
  - `templates/workbench/AGENTS.md:158` — skill 名单 `jspace-bootstrap` → `jspace-use`。
  - `templates/workbench/AGENTS.md:185` — 两处 references 路径。
  - `templates/workbench/README.md:36` — 路径 + 措辞指向「使用指南」。
- [ ] D7 文档指针:
  - `AGENTS.md:11,44,50`(仓库结构 / 开发工作流 / hub.json schema 指针)。
  - `README.md:79`(目录结构)。
  - `GOAL.md:57,96`(harnesses.md / headless-ops.md 指针)。
  - `docs/PLATFORMS.md:35`(权威矩阵指针)。
- [ ] D8 概念词软策略:
  - **硬(活体产品指代)**:`GOAL.md:56`「工作台规则与 bootstrap skill 保障」→「工作台规则与 jspace-use 指南保障」(保留指南实体指代,不是「首次启用」事件词)。
  - **软(概念阶段)**:`GOAL.md:83`(M2 历史里程碑)、asset-ingest gbrain-write.md / 测试名 / 注释中的「bootstrap 阶段」→ 改「首次启用(first-use)」;**不出现 `jspace-bootstrap` 产品名**。
- **Gate D**:`git grep "jspace-bootstrap"`(排除 node_modules/.git/.trellis)**除 legacy 迁移测试(workspace.test.ts:349-429,有意保留旧名断言)外**结果为空;且人工复查「bootstrap skill / bootstrap 指南」等非精确串无活体指代残留(见 Phase G7)。

## Phase E — 生成物重跑 + 校验

- [ ] E1 `bun run scripts/gen-assets.ts`(三件套 + AGENTS.md 生成块同步刷新为 jspace-use)。
- [ ] E1.1 扩展 `cli/assets-reachability.test.ts` `resolve()`(:31-45)支持 `../<skill>/references/x.md` 与 `../<skill>/SKILL.md`(跨 skill 引用可达性),使 memory-writeback 5 处跨引用纳入 CI 断言;并在 PR 门禁(`.github/workflows/verify.yml`)补跑 `bun test cli/assets-reachability.test.ts`(P1,防跨 skill 引用漏改静默通过)。
- [ ] E2 `bun run scripts/check-skills.ts`:
  - C1(引用完整性):memory-writeback 的 `../jspace-use/references/gbrain.md` 解析到磁盘;SKILL.md references 全部可达。
  - C2/C3(渲染一致性):frontmatter name/triggers 与 AGENTS.md 生成块 + manifest 集合一致。
  - C4(新鲜度):重跑 gen-assets 后 git diff 干净。
- **Gate E**:check-skills C1-C4 全绿;三件套无 `jspace-bootstrap` 残留。

## Phase F — 测试更新

- [ ] F1 `application/workspace/workspace.test.ts`:真实 bundle 耦合 rel 更新为 `jspace-use`;改造 legacy 迁移测试(:349-429)为「旧名 `jspace-bootstrap` rel → remove / 新名 `jspace-use` rel → create」双断言(真实存量工作台路径保护)。**该测试有意保留旧名 `jspace-bootstrap` 字面量**(存量迁移回归),属 Phase G7 豁免项。
- [ ] F2 `cli/lifecycle-and-safety.test.ts:19,38,52`:`ASSETS` 寻址键 → `skills/jspace-use/*`;断言内容(pipeline 守卫 / gbrain 版本范围 / lifecycle 矩阵)不变。
- [ ] F3 `scripts/skill-frontmatter.test.ts:11,15,25`:路径 + `fm.name === "jspace-use"`。
- [ ] F4 `application/workspace/manifest.test.ts` + `core/contracts/skills.test.ts`:fixture 旧名 rel → `jspace-use`(防命名漂移)。
- [ ] F5 `bun test` 全绿。
- **Gate F**:测试全绿;新增断言覆盖「旧名 → 新名」存量迁移。

## Phase G — 端到端验证

- [ ] G1 `bunx tsc --noEmit` 绿。
- [ ] G2 `bun test` 绿(含 check-skills 类脚本测试)。
- [ ] G3 `bun run scripts/check-skills.ts` C1-C4 绿。
- [ ] G4 `jspace init` 新工作台演练(源码检出 `bun run cli/main.ts init <tmp>`):
  - 产物只含 `.jspace/skills/jspace-use/`,无 bootstrap;init 提示串指向 jspace-use。
  - `jspace doctor --dir <tmp>` 通过;`jq .jspace/hub.json` 合法。
- [ ] G5 存量工作台升级演练(模拟旧版工作台:预置 `.jspace/skills/jspace-bootstrap/*` + journal 记录):
  - `jspace workspace upgrade --dry-run` → 旧 rel `remove` / 新 rel `create` / AGENTS.md 块更新。
  - 实际 upgrade 后:旧目录移除(备份)、新目录存在、`jspace doctor` 通过;改过旧文件的用例 → `stale` 保留。
  - `--rollback` 恢复演练 + 断言:① 旧 `.jspace/skills/jspace-bootstrap/` 已还原、② 材料化 journal 不含旧 rel(孤儿态)、③ 再次 upgrade 幂等(旧 rel 不再进入 diff)。
  - **pre-journal 孤儿用例**:预置 `.jspace/skills/jspace-bootstrap/` 但**不写 journal** → 验证 upgrade/diff 不误删(孤儿不产出 DiffEntry),且新增的 doctor/diff 诊断能提示该孤儿(design §4.2)。
- [ ] G6 registry smoke:`jspace domain add` / `jspace resource add` / `jspace domain list` / `jspace resource list` 通过。
- [ ] G7 残留终检:
  - `git grep -n "jspace-bootstrap"`(全仓,排 node_modules/.git/.trellis/archive)→ 仅剩明确豁免。
  - **豁免清单**:`.trellis/`(任务/归档/研究,gitignore)、git 历史、`.trellis/.template-hashes.json` 里与产品无关的 `trellis-spec-bootstrap`、**`application/workspace/workspace.test.ts` 的 legacy 迁移回归测试(有意保留旧名断言,带注释标注豁免)**。
  - **非精确串复查**:`grep -rn "bootstrap skill\|bootstrap 指南\|→bootstrap"`(排 .trellis/node_modules/.git)→ 确认无活体产品指代残留(仅历史里程碑概念词可存)。
- **Gate G**:全部通过;`jspace-bootstrap` 仅存于豁免区。

## Phase H — 收尾

- [ ] H1 审 diff:`git diff --stat` + 关键文件(SKILL.md / skills-manifest.json / gen-assets.ts / init.ts / 模板散文 / 测试)逐文件 review。
- [ ] H2 spec 更新(Phase 3.3):把 jspace-use 指南化写入 spec 索引(若 spec 中有 bootstrap 引用)。
- [ ] H3 commit:单次或按 Phase 分次提交(建议 C/D/E 一提交,测试 F 一提交,验证 G 通过后合并)。
- [ ] H4 **发布硬门禁**(非软提醒):本次改名必须伴随新 git tag(≥1.0.9)+ `bun run scripts/gen-version.ts`,且 `jspace update` → `workspace upgrade` 收敛演练通过后才算交付(bundle_version 由 tag 决定,改名不自动升版本)。发布时 release note 标注:① 机器级 harness-config 旧副本需重装刷新;② 存量 cron 若指向 jspace-bootstrap 需改 target.skill。未发布前「无旧名残留」仅对源码成立。

---

## 回退点

| 阶段 | 回退动作 |
|---|---|
| Phase B | `git checkout scripts/gen-assets.ts`(校验可独立回退,不影响其余) |
| Phase C | `git mv skills/jspace-use skills/jspace-bootstrap` 反向 + 整目录 `git checkout skills/jspace-bootstrap`(恢复 SKILL.md/references/example-bootstrap.md/agents);example-*.md 重命名残留同理 `git checkout` |
| Phase D | 逐文件 `git checkout`(manifest / memory-writeback / harness-config / init / 模板 / 文档) |
| Phase E | 重跑 `gen-assets` 覆盖生成物;漏改源 → `git checkout` 源文件后重跑 |
| Phase F | `git checkout` 测试文件 + 修正实现 |
| Phase G | 未 commit 前 `git checkout` 全量;已 commit 后 `git revert`;upgrade 演练用 `--rollback` 恢复工作台 |

## 交付物核对(prd.md AC)

- [ ] AC1 架构审计(带证据):`research/audit-*.md` 5 份 + design §1。
- [ ] AC2 源目录/生成目标均为 jspace-use,无兼容层:Phase C/D/E。
- [ ] AC3 SKILL.md 是使用/维护指南:Phase C2。
- [ ] AC4 职责边界不重复:design §2.1 归属矩阵 + SKILL.md「边界」章。
- [ ] AC5 生成清单/嵌入/upgrade/README/AGENTS/GOAL/测试全同步:Phase D/E/F。
- [ ] AC6 tsc / 单测 / skill-frontmatter / 生成资产 / smoke(init/doctor/registry)通过:Phase G。
- [ ] AC7 无兼容别名/迁移/弃用代码:Phase C1 无 alias,升级走通用机制。
- [ ] AC9 活动内容无 jspace-bootstrap 残留:Phase G7。
