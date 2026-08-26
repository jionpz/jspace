# cron 契约升格 — 执行计划

## 顺序清单

### S1 两个薄 skill
- [ ] `skills/weekly-report/SKILL.md` —— triggers(周报 / 生成周报 / weekly report / 本周汇总);契约三条逐字迁移;活跃项目发现来源(域 README + gbrain state 页);与 consolidate 分工(事实以 consolidate 页为准,周报只做 Pointer + 极薄 Summary)
- [ ] `skills/memory-consolidate/SKILL.md` —— triggers(记忆巩固 / 巩固记忆 / 周快照 / consolidate);契约两条逐字迁移;dated memory record 纪律指针;**同周重跑幂等修补**(先查本周已有页)
- 约束:引用一律 `~/.agents/skills/<skill>/...`(check-skills C1);保持薄,纪律引用不复制

### S2 注册与模板迁移
- [ ] `skills-manifest.json` +2 条(`scope: workbench`,`entrypoints: ["weekly"]`,dependencies 按实际引用)
- [ ] `templates/workbench/.jspace/cron.json`:两任务改 `target`,input 收薄为一句引导
- [ ] `skills/jspace-use/SKILL.md` §7 路由表 +2 行;§8.4 补「存量工作台迁移」指引

### S3 doctor 迁移信号
- [ ] `CronLike` +`target?: { skill: string }`
- [ ] `checkCrons` +`cron.inline_prompt_legacy`(info)
- [ ] 单测:阳性(内联 prompt + id 撞官方 skill 名)/ 阴性(已用 target;自定义 id 的内联 prompt 不报)

### S4 文档计数
- [ ] `AGENTS.md` / `README.md`:5 → 7,补两个新名

### S5 生成与门禁
- [ ] `bun run scripts/gen-assets.ts`(新文件先 `git add`,否则 manifest-integrity 红)
- [ ] `bunx tsc --noEmit` / `bun test` / `check-skills` / `check-harness-consistency` / `check-manifest-integrity`

### S6 验证
- [ ] `/tmp` smoke:init → cron.json 三个 `kind: skill` + 一个 inline(仅剩自定义逃生舱示例?实际应为 4 个全 skill target)→ doctor 0 error
- [ ] 本机:build + install → `workspace upgrade` → 手动迁移 `~/jspace-work/.jspace/cron.json` 两任务(备份先行)
- [ ] 迁移前 doctor 应报 `cron.inline_prompt_legacy` ×2;迁移后消失(**这是 S3 检查的实证**)
- [ ] rehearsal:`jspace cron run weekly-report --dry-run` / `memory-consolidate --dry-run`,确认 compile 通过且 prompt 指向新 SKILL.md
- [ ] 契约不变性:比对迁移前后产物契约(路径/slug 文本)逐字一致

### S7 收口
- [ ] PRD 验收勾选 + Key Decisions;commit;归档

## 验证命令

```bash
bun run scripts/gen-assets.ts && bunx tsc --noEmit && bun test \
  && bun run scripts/check-skills.ts && bun run scripts/check-harness-consistency.ts \
  && bun run scripts/check-manifest-integrity.ts
```

## 回滚点

- S1-S4:`git checkout -- .`
- S5 后:`git revert <sha>`
- 本机 cron.json:改前备份 `.bak-20260810`,原样恢复即可
