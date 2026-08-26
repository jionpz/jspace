# CLI allowedTools 通配符 任务记录(真实证据,不入 git)

## 背景
- cron-rehearsal-install 发现:`jspace cron run` 生成 `--allowedTools ...gbrain:*`;claude 报「Wildcard tool name "gbrain:*" is not supported in allow rules」。无头 cron 的 gbrain MCP 工具未放行(Bash 兜底可用)。

## 修复
- `cli/cron.ts:498`:`gbrain:*` → `mcp__gbrain__*`(claude allow-rule 语法:字面 `mcp__<server>__` 前缀 + glob 工具名;MCP server 名 = gbrain)。注释补语法说明。commit `65e4a47`。
- 校验:tsc ✓ / bun test 21 pass ✓ / bun run build ✓ / dry-run 显示 `--allowedTools Bash,Read,Write,Edit,mcp__gbrain__*`,无 `gbrain:*` 残留。

## 附带发现:编译产物资产陈旧
- `bun run build` 重新生成 `cli/assets.generated.ts`:嵌入式 cron.json 是旧的(weekly-report/memory-consolidate `enabled:false` + 短 prompt)——**M4 模板解锁未同步进编译产物**。本次再生成后与模板一致(enabled:true + 自包含契约);`version.generated.ts` → 1.0.2(对齐 release tag)。commit `c1c61cd`。
- 教训:改 `templates/workbench/` 后需 `bun run scripts/gen-assets.ts`(或 build)同步嵌入式资产,否则编译二进制 init 出来的工作台带旧模板。

## 收尾
- [x] 修复 + 校验 + 提交(2 commit)。
- [ ] 真实工作台下次 `bun run build` 后即生效(本机 bin/jspace 已重建)。
