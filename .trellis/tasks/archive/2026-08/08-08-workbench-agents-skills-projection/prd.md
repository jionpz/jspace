# 工作台 .agents/skills 投影——workspace upgrade 同步官方 skill 到项目级目录

## Goal

`workspace upgrade` 将官方 skill 额外投影到工作台 `.agents/skills/`(与 `.claude/skills/` 并列,同一 source 的字节一致副本);用户级 `~/.agents/skills/` 仍由 `jspace skills install` 物化,两层互补——项目级随工作台走,用户级供 skill 内部 `~/.agents/skills/<skill>/...` 引用解析。

## Requirements

- 工作台 skill 投影目录新增 `.agents/skills`(workbench-relative),与现有 `.claude/skills` 同机制:upgrade diff/apply 独立校验、用户编辑保留(skip)、与 source 保持 lockstep。
- 用户级 `~/.agents/skills/` 物化(`skills install`)行为不变——本任务不改 skill 内部引用路径。
- 模板/AGENTS.md 若提及 skill 位置,同步补充 `.agents/skills/`(多 harness 项目级位置)。

## Acceptance Criteria

- [ ] `materializedRels` 对每个 `skills/<name>/...` 返回 `.jspace/skills/<name>/...`、`.claude/skills/<name>/...`、`.agents/skills/<name>/...` 三处。
- [ ] manifest.test / doctor.test 断言随投影集合更新,`bun test` 全绿。
- [ ] 本机重建二进制,`jspace workspace upgrade --dir ~/jspace-work` 后 `~/jspace-work/.agents/skills/{jspace-use,asset-ingest,memory-recall,memory-writeback}/` 存在且内容与官方一致。
- [ ] `jspace doctor --dir ~/jspace-work` 仍 0 error / 0 warning。
- [ ] verify CI 通过;发布 v1.0.11(含本功能)。

## Notes

- 技术方案明确(一处配置 + 测试断言),轻量任务 PRD-only。
- 交付链路:改代码 → 单测 → 重建本机二进制 → 本机 upgrade 生效 → verify → bump 1.0.11 发布。
