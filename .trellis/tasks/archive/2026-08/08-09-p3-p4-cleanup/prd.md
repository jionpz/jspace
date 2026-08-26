# P3/P4 收尾:PLATFORMS.md 措辞 + SKILL description + .trellis 状态说明

## Goal

批量小清理:① 修正 `docs/PLATFORMS.md` 不准确措辞;② 精简两个官方 SKILL 的超长 description;③ 说明 `.trellis/` 目录的真实状态(issue 视为 dead weight,但当前已被激活使用)。

## Requirements

### P3-1 PLATFORMS.md:77 措辞

`docs/PLATFORMS.md` 说「3 默认任务,inbox-tidy disabled」;实际 `templates/workbench/.jspace/cron.json` 三个 cron(inbox-tidy / weekly-report / memory-consolidate)**全部 `enabled: false`**。改为:「3 默认任务,全部默认 disabled,需手动 `jspace cron enable <id>` 后 `cron install`」。

### P4-2 两个 SKILL.md description 精简

- `skills/jspace-use/SKILL.md:3`:超长单行(能力清单 + Use when + Do NOT)精简为 1–2 行「何时触发 + 输出是什么」;能力清单移到正文。
- `skills/memory-recall/SKILL.md:3`:同上。
- 注意:SKILL frontmatter 的 triggers 是 gbrain resolver 关键词来源(见仓库记忆),**精简 description 不得动 triggers / name / 其它 frontmatter 字段**。

### P4-1 .trellis/ 状态说明

- `.trellis/`(框架本体 git-tracked 44 个 py/md;`.trellis/tasks|workspace` gitignored)被 review 误判为「从未使用、疑似 jspace 自研」。实际它是本项目 Claude Code 的 Trellis 工作流框架,本会话已用其创建 7 个任务。
- 默认走 C:在 README 或仓库根文档加一句「`.trellis/` 是本仓库使用的 Trellis 开发工作流框架(vendored),非 jspace 运行时组件」,消除「自研」误解。
- 不删除(A 已不成立)、不拆 submodule(B 仅在需要独立维护框架时考虑)。

## Acceptance Criteria

- [ ] `docs/PLATFORMS.md:77` 措辞与模板实际一致(3 任务全部 disabled)
- [ ] 两个 SKILL.md 的 description 精简到 1–2 行;triggers/name/其它 frontmatter 未动
- [ ] 仓库根 README(或等效文档)已说明 `.trellis/` 是 vendored 工作流框架
- [ ] `bun test` 全绿、`tsc --noEmit` 通过(本任务改动小,至少确认无破坏)

## Notes

- 三个小项彼此独立,可一次性实现+提交。
- 不涉及契约/架构变更。
