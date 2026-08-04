# 无头执行运维（HEADLESS-OPS）

> JSpace cron 用无头 harness（`claude -p` / `codex exec` / `pi -p`）定时执行任务。本文档沉淀**账号 / 配额 / 失败可见性**运维模型：无头跑在哪个账号上、用量配额怎么查、耗尽怎么处置、JSpace 侧怎么兜底。
> 本文档**不含任何密钥/令牌**；凭据只走 cc-switch / 环境变量 / provider 侧。

## 1. 路由模型：无头请求走哪

- cron 定义在 `.jspace/cron.json`，`harness` 字段选定执行器；默认任务都用 `claude`。
- `claude -p`（headless）与交互会话走**同一套网络出口**：cc-switch 本地代理（`127.0.0.1:2006`，见 `hub.json` 的 cc-switch 资源）+ **failover 开关**。
- 实际 provider 由 cc-switch 的 `currentProviderClaude`（Claude Code 侧）/ `currentProviderCodex`（Codex 侧）指向的 profile 决定。
- auth 注入走 provider profile（`~/.claude.json` 无 OAuth 账号 / 自定义 key / `ANTHROPIC_API_KEY` env → 全部由 cc-switch 提供）。

**改 provider / 代理前的确认**：改网络出口 = 改动会话数据流向，先确认再改（全局治理红线：网络出口默认拒绝、改动前先确认）。

## 2. 用量 / 配额怎么看

- **当前 provider**：打开 cc-switch 看 Claude Code / Codex 当前 profile 与代理状态；`enableFailoverToggle` 指示是否启用备用 provider 自动切换。
- **Claude 订阅 / API 限额**（若直连 Anthropic）：
  - 5 小时 / 5 天滑动窗口限流（订阅档位 Pro / Max 对应不同窗口额度；Max 5h/5d 宽、Pro 5h/5d 窄）。
  - 用量页面：claude.ai 设置里的 Usage；API 侧看 console 用量与余额。
- **provider 侧**：SiliconFlow / OpenRouter / 其他 profile 的余额、并发、限流 —— 在各自控制台看。
- **本机出口健康**：`jspace doctor`（provider/资源注册表检查）+ 本地代理日志（cc-switch logs）。

## 3. 耗尽 / 限流怎么处置

1. **failover**：cc-switch 已开 `enableFailoverToggle` —— 主 provider 失败/超限自动切备用。
2. **重试**：`jspace cron run <id>` 手动重跑一次（`--timeout` 可调）；等待窗口（如 5 小时限流）后由 cron 自然再触发。
3. **降档**：改 cron prompt 用更小模型 / 精简任务（无头侧不改 gbrain 契约）。
4. **记录**：无头失败会自动进 `cron-failed.md`（见下），下次会话可见 —— 不要静默放弃。

## 4. JSpace 侧兜底（失败可见性）

- 无头执行失败 → 打开结构化 incident（`.jspace/state/incidents/`，keyed cron+failure class）+ 每次运行日志（`.jspace/logs/cron/<id>/` 为人类 payload）；成功 retry 自动 resolve，`cron ack` 保留证据。
- **会话开始检查**：`jspace cron check`（alias `failures`）一次聚合「未 ack incident + pending 暂存写 + 各 cron 状态」，需关注则退出码 1。
  - Claude Code：SessionStart hook best-effort（需 hook 真实触发；工作台 `.claude/settings.json`）。
  - 其他 harness：会话开始时手动 `jspace cron check`。
- **gbrain 锁冲突 / 写暂存**：交互会话持 serve 锁时，gbrain 写契约**暂存**（`jspace pending stage <slug> --content <file> --producer <name>` → `<filehub>/.jspace-logs/<id>.APPLY.json`），锁空闲窗口 `jspace pending apply` 落 live（幂等，重复 apply 不产生重复事实）；terminal_failed 用 `jspace pending ack <id>` 确认。`jspace cron check` / `jspace doctor` 列出 actionable pending（staged/terminal_failed；applied/acked 不再告警）。
- **asset-ingest 恢复**：资料入库走 `jspace ingest` journal（`begin` 暂存副本 → gbrain → index → `complete` 移除 source）；任一步失败 `jspace ingest <id> --fail <原因>`（gbrain 前失败移除暂存副本、source 留 inbox，无孤儿）；中断用 `jspace ingest list` 续跑（已完成步骤不重做）。
- **doctor**：`jspace doctor` 摘要 cron 失败数与 actionable pending（`jspace pending apply/ack`）。

## 5. 敏感边界

- 本文档不放任何密钥/令牌/API key；provider 凭据只存 cc-switch / 环境变量 / 系统钥匙串。
- 排查配额问题时，只读 cc-switch 的 profile 名/状态，不 dump 其凭据内容。
- 会话代码/数据只发往已批准端点（provider/代理配置决定），改动前确认。
