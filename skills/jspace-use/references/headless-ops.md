# 无头执行运维（HEADLESS-OPS）

> JSpace cron 用无头 harness（`claude -p` / `codex exec` / `pi -p`）定时执行任务。本文档沉淀**账号 / 配额 / 失败可见性**运维模型：无头跑在哪个账号上、用量配额怎么查、耗尽怎么处置、JSpace 侧怎么兜底。
> 本文档**不含任何密钥/令牌**；凭据只走本机 provider 配置工具 / 环境变量 / provider 侧。

## 1. 路由模型：无头请求走哪

- cron 定义在 `.jspace/cron.json`，`harness` 字段选定执行器；默认任务都用 `claude`。
- `claude -p`（headless）与交互会话走**同一套网络出口**：本机 provider 配置工具的本地代理（见 `hub.json` 中登记的 provider 资源）。
- 实际 provider 由本机 provider 配置工具中当前激活的 profile 决定（按 harness 分别配置）。
- auth 注入走 provider profile（`~/.claude.json` 无 OAuth 账号 / 自定义 key / `ANTHROPIC_API_KEY` env → 全部由本机 provider 配置工具提供）。
- **cron 的模型是 cron 自己的属性**：`cron add --model <provider/model>` 给单个 cron 钉死无头模型。无头运行**不应**继承交互会话的默认模型——交互侧的模型选择随时可能被换成一个已限流的 provider，而限流的模型不会让 `claude -p` 快速失败，而是**挂起直到被杀**（2026-10-13 实证：5 个 cron 连续多日失败；实测 `claude -p "say OK"` 在限流下要么挂死到被 kill（exit 142，零输出），要么 exit 1 只打印 429 文本，两条路都不产出可用结果）。不给 `--model` 则用 harness 自己的解析（等价于继承）。

**改 provider / 代理前的确认**：改网络出口 = 改动会话数据流向，先确认再改（全局治理红线：网络出口默认拒绝、改动前先确认）。

## 2. 用量 / 配额怎么看

- **当前 provider**：打开本机 provider 配置工具看各 harness 当前 profile 与代理状态。
- **Claude 订阅 / API 限额**（若直连 Anthropic）：
  - 5 小时 / 5 天滑动窗口限流（订阅档位 Pro / Max 对应不同窗口额度；Max 5h/5d 宽、Pro 5h/5d 窄）。
  - 用量页面：claude.ai 设置里的 Usage；API 侧看 console 用量与余额。
- **provider 侧**：SiliconFlow / OpenRouter / 其他 profile 的余额、并发、限流 —— 在各自控制台看。
- **本机出口健康**：`jspace doctor`（provider/资源注册表检查）+ 本地代理日志。

## 3. 耗尽 / 限流怎么处置

1. **备用 provider（fallback 链）**：本机 provider 配置工具按 provider 配置备用模型链（常见形态：`<provider-config> provider fallback <id> <provider/model>…`，语义 = "该 provider 超出配额或不可用时改用这些"）。**它是按 provider 配的链，不是全局开关，默认不配就没有**——`provider fallback <id>` 不带参数即查询，输出 `has no fallback` 就说明这条链是空的，此时限流没有任何自动兜底。排查"为什么没自动切"先查这里。
2. **重试**：`jspace cron run <id>` 手动重跑一次（`--timeout` 可调）；等待窗口（如 5 小时限流）后由 cron 自然再触发。
3. **降档**：改 cron prompt 用更小模型 / 精简任务（无头侧不改 gbrain 契约）；**更直接的做法是 `cron add --model` 给这个 cron 钉一个免费/宽配额模型**，把无头与交互的模型彻底解耦。
4. **记录**：无头失败会自动进 `cron-failed.md`（见下），下次会话可见 —— 不要静默放弃。

## 4. JSpace 侧兜底（失败可见性）

- 无头执行失败 → 打开结构化 incident（`.jspace/state/incidents/`，keyed cron+failure class）+ 每次运行日志（`.jspace/logs/cron/<id>/` 为人类 payload）；成功 retry 自动 resolve，`cron ack` 保留证据。
- **会话开始检查**：`jspace cron check`（alias `failures`）一次聚合「未 ack incident + pending 暂存写 + 各 cron 状态」，需关注则退出码 1。
  - Claude Code：SessionStart hook best-effort（需 hook 真实触发；工作台 `.claude/settings.json`）。
  - 其他 harness：会话开始时手动 `jspace cron check`。
- **gbrain 锁冲突 / 写暂存**：交互会话持 serve 锁时，gbrain 写契约**暂存**（`jspace pending stage <slug> --content <file> --producer <name>` → `<filehub>/.jspace-logs/<id>.APPLY.json`），锁空闲窗口 `jspace pending apply` 落 live（幂等，重复 apply 不产生重复事实）；terminal_failed 用 `jspace pending ack <id>` 确认。`jspace cron check` / `jspace doctor` 列出 actionable pending（staged/terminal_failed；applied/acked 不再告警）。
- **asset-ingest 恢复**：资料入库走 `jspace ingest` journal（`begin` 暂存副本 → `advance --gbrain` → `advance --index` → `advance --complete` 移除 source）；任一步失败 `jspace ingest fail <id> --reason <原因>`（gbrain 前失败移除暂存副本、source 留 inbox，无孤儿）；中断用 `jspace ingest list` 续跑（已完成步骤不重做）。**cleanup-pending**：commit 的 source 移除未证明完成时 journal 为 `failed/failedStep=committed`（`list` 标注 `failed/cleanup-pending`），用同一 `advance <id> --complete` 幂等收尾（source 在 → 重试删除；已删除 → 直接收敛 committed），不虚报 source 已删。
- **doctor**：`jspace doctor` 摘要 cron 失败数与 actionable pending（`jspace pending apply/ack`）。

## 5. 敏感边界

- 本文档不放任何密钥/令牌/API key；provider 凭据只存本机 provider 配置工具 / 环境变量 / 系统钥匙串。
- 排查配额问题时，只读 provider 配置工具的 profile 名/状态，不 dump 其凭据内容。
- 会话代码/数据只发往已批准端点（provider/代理配置决定），改动前确认。
