# workbench-retro — 执行计划

## 顺序清单

### S1 skill 源码(核心交付)
- [ ] `skills/workbench-retro/SKILL.md` —— frontmatter(name/description/triggers:周自省·retro·复盘·工作流体检·本周回顾)+ 何时用/不用 + 与 consolidate 分工表 + 决策表 + 六步主流程 + 按需深入指针 + 自检
- [ ] `skills/workbench-retro/references/checks.md` —— design §3 六条检查的取证命令与判读细则(每条:证据命令 / 判读阈值 / 归入哪一级建议 / 拿不到证据怎么办)
- [ ] `skills/workbench-retro/references/example-retro.md` —— golden run(用本机真实基线:cron 在转、写回腿停摆、2 个项目已挂接、inbox 空)

约束:引用一律 `~/.agents/skills/workbench-retro/references/x.md` 形式(check-skills C1 禁止 CWD 相对引用)。

### S2 注册与接线
- [ ] `skills-manifest.json` +条目:`{name: workbench-retro, version: "1", scope: workbench, dependencies: [jspace-use, memory-writeback, asset-ingest], entrypoints: [weekly]}`
- [ ] `templates/workbench/.jspace/cron.json` +任务:id `workbench-retro`,schedule `0 23 * * 0`,harness claude,target `{kind: skill, skill: workbench-retro, entrypoint: weekly, input: ...}`,`enabled: false`(与模板其余任务一致)
- [ ] `skills/jspace-use/SKILL.md` §7 路由表 +1 行

### S3 文档去硬编码(4 处「4 个」→ 5)
- [ ] `AGENTS.md:11` / `README.md:16` / `core/contracts/skills.ts:35` 注释 / `skills/jspace-use/references/gbrain.md:16`

### S4 生成与门禁
- [ ] `bun run scripts/gen-assets.ts`(Brain-ops 块自动渲染;提交 `cli/*.generated.ts` + `templates/workbench/AGENTS.md`)
- [ ] `bunx tsc --noEmit`
- [ ] `bun test`
- [ ] `bun run scripts/check-skills.ts`(C1 引用 / C2 render / C3 routing / C4 freshness)
- [ ] `bun run scripts/check-harness-consistency.ts`
- [ ] `bun run scripts/check-manifest-integrity.ts`

### S5 验证
- [ ] `/tmp` smoke:`bun run cli/main.ts init /tmp/jspace-retro-smoke` → `doctor` → 确认 `.jspace/skills/workbench-retro/` 与 5 处投影齐备、AGENTS.md Brain-ops 含 retro 触发词、cron.json 含新任务
- [ ] 本机:重建二进制并安装 → `jspace workspace upgrade --dry-run` 预览 → 应用 → `jspace doctor`
- [ ] 本机手动加 cron(模板 cron.json 是 user ownership 不会下发)→ `jspace cron run workbench-retro --dry-run` rehearsal
- [ ] **真跑一次 retro**(会话触发),产出建议清单 + gbrain `memory/retro/<date>` 页,确认零未经确认的修改

### S6 收口
- [ ] 更新 PRD 验收勾选 + Key Decisions
- [ ] commit(Phase 3.4)
- [ ] 归档任务

## 验证命令速查

```bash
bun run scripts/gen-assets.ts && bunx tsc --noEmit && bun test \
  && bun run scripts/check-skills.ts \
  && bun run scripts/check-harness-consistency.ts \
  && bun run scripts/check-manifest-integrity.ts
```

## 回滚点

- S1-S3 之后未跑 gen-assets:直接 `git checkout -- .`
- S4 之后:`git revert` 单个提交(无 TS 逻辑改动,回滚无副作用)
- 本机工作台:`jspace workspace upgrade --rollback <journal-id>`

## 复核门

S4 全绿 + S5 smoke 通过后,再做本机真跑;真跑发现 skill 表述问题回 S1 迭代(不改门禁)。
