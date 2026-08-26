# doctor 漂移增检 — 执行计划

## 顺序清单

### S1 R1 块外陈旧内容
- [ ] `doctor.ts`:读根 `AGENTS.md`;定位 `<!-- JSPACE:END -->`;无块则跳过;块外扫 `TRELLIS-BRAIN-OPS:BEGIN` / `TRELLIS-SKILL-GOV:BEGIN` / `jspace-bootstrap`
- [ ] 单测:阳性(块外含旧标记)/ 阴性 A(只有受管块)/ 阴性 B(无 JSPACE 块的用户自写文件)/ 阴性 C(标记只出现在块内)

### S2 R2 bundle 过时
- [ ] `CronHealthDeps` +`bundleStaleSkills?: () => string[]`
- [ ] `doctor.ts` 消费,报 `skills.bundle_stale`(info)
- [ ] `cli/commands/helpers.ts` 实现注入(diffBundle + BUNDLE_MANIFEST + journal,过滤 `.jspace/skills/<name>/` 且 action ≠ no-op)
- [ ] 单测:阳性(注入返回非空)/ 阴性(返回空)/ 未注入(静默)

### S3 R3 项目未挂接
- [ ] `checkInbox` 的 projects 循环内比对 `hub.projects[].asset_rel_path`
- [ ] 单测:阳性(filehub 有目录、hub 无记录)/ 阴性(已注册)

### S4 R4 落点转移
- [ ] `skills/workbench-retro/references/checks.md` 检查 3 扩展 gbrain 页 type 白名单校验(`lesson|note|decision|reference|smoke`)
- [ ] gen-assets

### S5 门禁
- [ ] `bunx tsc --noEmit` / `bun test` / `check-skills` / `check-harness-consistency` / `check-manifest-integrity`

### S6 验证(fixture 复刻 2026-08-10 基线)
- [ ] R1:用 `AGENTS.md.bak-20260810`(205 行旧全文)复刻 → 应命中 → 换成现版 → 应消失
- [ ] R2:本机当前应为 no-op(刚 upgrade 过);人为构造过时(临时改一个 skill 文件)→ 应命中 → 还原
- [ ] R3:临时建一个未注册的 `projects/<test>/` → 应命中 → 删除后消失
- [ ] 本机 doctor 最终仍 0 error

### S7 收口
- [ ] PRD 勾选 + Key Decisions;commit;归档
- [ ] 父任务收口(GOAL #3 关闭 + 集成 review + 记忆写回)

## 验证命令

```bash
bunx tsc --noEmit && bun test && bun run scripts/check-skills.ts \
  && bun run scripts/check-harness-consistency.ts && bun run scripts/check-manifest-integrity.ts
```
