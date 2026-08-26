# #9-01 [P1-6] 模板 workbench-retro slug 对齐

## Goal

新 init 的 workbench 不再生成已迁移路径 `memory/retro`，全部改 canonical `records/retro`。

## Requirements

- 改 `templates/workbench/.jspace/cron.json`（workbench-retro 条目的 input）`memory/retro/<YYYY-MM-DD>` → `records/retro/<YYYY-MM-DD>`。
- grep 其它模板/seed 的 canonical slug，与 `scripts/migrate-memory-model.ts:101`、`skills/workbench-retro/SKILL.md`、`skills/jspace-use/references/gbrain.md:64,130` 对齐一致。

## Acceptance Criteria

- [ ] `bun run scripts/gen-assets.ts` 重新物化，`cli/*.generated.ts` 无旧 slug。
- [ ] check-skills / check-manifest-integrity 绿。
- [ ] /tmp/jspace-smoke 新 init 后 `jq '..|.records? // empty'` 一瞥 cron.json 无 `memory/retro` 旧 slug。
