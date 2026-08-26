# M2 资产层最小协议 — 集成执行计划

> 本文件是**父任务**的集成执行计划:子任务各自的实施清单在子任务 implement.md(子任务 start 前补齐)。父任务负责顺序、跨子任务验收与最终集成。

## 顺序与依赖

```
1. filehub-scaffold   (解锁正式根路径,批量前置)
2. inbox-batch【核心】(两遍式+人工调整+cron 可驱动;依赖 1)
3. bootstrap-filehub  (依赖 1 注册机制;可与 4 并行)
4. domain-project-link(无依赖,可任意并行)
└─ 父任务:集成验收(1→2 端到端,含两遍式+人工调整)
```

> 批量管线(R4/R9/R10)是项目最高价值,验收重点;Obsidian 细节与引导形态为次要。

## 集成清单(父任务视角)

- [ ] 子任务 1-4 各自 `prd.md`(+必要 `design.md`/`implement.md`)齐备并通过 review gate 后 `task.py start`。
- [ ] CLI 改动每子任务验证:TS 编译、`init`+`doctor` 冒烟、registry 命令演练(见下)。
- [ ] 跨子任务:一条**端到端链路**真实跑通(见「验收路径」)。
- [ ] 本仓库根目录无残留 hub.json/workspace;模板渲染后 doctor 通过。
- [ ] 命名统一 jspace/filehub;文档与 skill 引用一致(asset-ingest 读 filehub resource 逻辑不改)。

## 验收路径(跨子任务集成验收,父任务执行)

```bash
# 1. 生成工作台
bun run cli/main.ts init /tmp/m2-smoke
cd /tmp/m2-smoke

# 2. bootstrap 选 Obsidian,建文件中心 + 注册(或等价 CLI 演练)
#    ... 按 bootstrap-filehub 的引导(Obsidian 第一选择)
bun run cli/main.ts doctor --dir /tmp/m2-smoke      # 应含 filehub 状态、无严重告警

# 3. 放真实资料进 _inbox/(至少一份 pdf + 一份 excel,不用假文件)
cp ~/real/a.pdf ~/real/b.xlsx /tmp/m2-smoke/<filehub>/_inbox/

# 4. 批量整理(核心验收):会话内触发 asset-ingest batch
#    → 第一遍确定性文件零提问归位;模糊项进第二遍清单人工一次过目
#    → 全部归位 projects|areas、index.md 登记、gbrain reference 页、召回自检命中
#    → 验证人工调整:处理前排除某文件(「这个别动」)、处理后对错归/错命名执行撤销/重跑

# 5. 验证 Obsidian 兼容:filehub 根含 README.md(landing)+ index.md(frontmatter+wikilink),
#    无插件依赖;重复 filehub init 幂等

# 6. 批量管线 cron 可驱动:无头模式只跑第一遍,输出执行日志(路径/计数/成功/跳过/失败)
```

## 验证门禁(父任务,实施中执行)

- **双机重建冒烟(采纳专家 P1)**:M2 内做一次低成本验证——文本页↔PGLite 导出回灌(含图谱边/backlink)、embedding 离线重建(本地 bge-m3)、指针换机可解析;结论写回 GOAL 开放问题 #1。不晚于 M3。
- **真实资料端到端(采纳专家 P14)**:至少 pdf + excel 各一份,走「丢 _inbox → 一句话触发 batch → 归位 + index 登记 + gbrain 召回命中」,不只用 `/tmp/smoke` 假文件。
- **本地门禁(采纳专家 P5)**:`bun run check`(tsc + init/doctor + domain/resource/filehub 演练)固化为可重复本地回归;CI 明确标注外部阻塞(GitHub 计费锁)、本地兜底,不进 M2 关键路径。

## 回归命令(每子任务验证)

- `bunx tsc --noEmit`
- `bun run cli/main.ts init /tmp/jspace-smoke && bun run cli/main.ts doctor --dir /tmp/jspace-smoke`
- 在 smoke 内演练 `domain`/`resource` 的 list/add/remove(新增 filehub 用例)
- 模板/技能改动用 `__DEV_ROOT__` 占位符与 init 替换机制回归

## 关键风险文件 / 回滚点

- `cli/src/cmds.ts` + `cli/src/registry.ts`(新增 filehub 命令 / doctor 校验)——改动集中、回滚点明确。
- `templates/workbench/`(骨架 README/index 模板、domain README 段落)——生成物来源,勿直接改已生成工作台反推。
- `skills/asset-ingest/`(batch 模式、filing.md 更新)——保持单文件路径兼容。
- `skills/jspace-bootstrap/`(文件中心步骤)——与既有 gbrain/harness 接线步骤并行不冲突。
- 回滚:任一子任务问题 → 回退该子任务改动;registry 层面 `resource remove --id filehub` 即回降级路径。

## 实施前检查(task.py start 前置)

- [ ] 每个子任务有清晰 prd.md(验收可测)。
- [ ] 复杂子任务有 design.md/implement.md。
- [ ] 子任务 implement.jsonl/check.jsonl 有真实 spec/research 条目(子代理派发时)。
- [ ] 父任务 prd.md 无阻塞开放问题;用户已批准本规划总结。
