# cron 失败可见性命令：jspace cron failures

## Goal

新增 `jspace cron failures` 命令：一处看到「cron 最近失败 + 未应用的 gbrain 暂存写（APPLY.md）+ 各 cron 状态摘要」，人类可读 + `--json` 机器可读；doctor 摘要增强。让「下次会话检查」有确定命令可跑（供 SessionStart hook / AGENTS.md 指令 / 用户手动）。

## Requirements

- **`jspace cron failures [--json]`**：
  - 读 `<workbench>/.jspace/logs/cron-failed.md` → 列出最近失败（时间 / cron id / 原因 / log 路径；缺文件 = 无失败记录）。
  - 扫 pending gbrain 暂存写：`<filehub>/.jspace-logs/*.APPLY.md`（filehub 根从 hub.json `type: filehub` resource 的 primary path 解析；未注册则跳过）→ 列出待应用暂存写（文件 + 时间）。
  - 状态摘要：从各 cron 日志目录读最后一条 status → `ok / suspect / failed / never run` 分类汇总（`suspect` 与 `failed` 计入「需关注」）。
  - 退出码契约：无失败 + 无 pending + 无 suspect → 0；有任何需关注项 → 1（供 hook/脚本判定）。
  - `--json`：结构化输出（failures[] / pending_applies[] / crons[] + summary{needs_attention}），单行 JSON。
- **doctor 增强**：cron 摘要里追加「N 个 pending APPLY.md 待应用（gbrain 暂存写）」提示。
- **测试**：bun test 单测覆盖（构造临时 workbench + 假 cron-failed / APPLY / cron 日志 → 断言输出与退出码）。
- 不改动 `cron run`/`cron status` 既有行为；`status` 保留。

## Acceptance Criteria

- [ ] 命令在真实工作台可跑：`jspace cron failures` 列出真实 pending APPLY（当前 `~/filehub/.jspace-logs/` 有 memory-consolidate 暂存写）+ 真实 cron 状态；`--json` 输出合法且字段齐全。
- [ ] 退出码契约成立（构造有/无需关注两种场景验证）。
- [ ] doctor 含 pending APPLY 提示。
- [ ] bun test 新增用例全绿；既有 21 用例不破；tsc 干净。
- [ ] 不依赖 gbrain 锁（只读文件系统），serve 持锁时也能跑。

## Notes

- 研究（2026-08-03）：`cron-failed.md` 行格式 `- <localStamp>  <id>  <reason>  log: <logPath>`（保留 30 行）；运行日志 `.jspace/logs/cron/<id>/<时间戳>.md` 含 frontmatter `status:`/`exit:`/`time:`（见 cli/cron.ts:530-545, 641-652）；`cmdCronStatus` 读最后一条（cli/cron.ts:663-685）。暂存写位置 = `<filehub>/.jspace-logs/`（连字符；`memory-consolidate-2026-08-03.APPLY.md` 等）。
- 别名考虑：可提供 `jspace cron check` 作为 failures 的语义别名（hook 用 check 更像检查）；最终以设计定。
