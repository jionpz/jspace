# 无头执行账号/配额运维文档

## Goal

沉淀无头 harness（cron 的 `claude -p` 等）的**账号/配额运维模型**到仓库文档 + 工作台规则：当前用什么账号/provider、用量/配额怎么查、耗尽怎么处置、JSpace 侧失败可见性如何兜底。独立文档交付（不依赖 A/B）。

## Requirements

- **文档** `docs/HEADLESS-OPS.md`（新增）：
  1. **路由模型**：无头 `claude -p` → cc-switch 本地代理（127.0.0.1:2006）+ failover → 当前 provider profile（`cc-switch` 的 `currentProviderClaude`）；auth 走 provider profile 注入（`~/.claude.json` 无 OAuth/自定义 key）。
  2. **用量/配额查看**：怎么查当前 provider（`cc-switch` 界面/配置）；Claude 订阅/API 限额（5 小时/5 天滑动窗口，Pro/Max 档位）与 provider 侧余额/限流；本地代理 failover 行为。
  3. **耗尽处置**：failover 切备用 provider → 重试策略 → 改 model/降档 → 记录到 cron 失败（下次会话检查可见）。
  4. **JSpace 侧兜底**：cron 失败 → `cron-failed.md` + `jspace cron failures` + SessionStart hook（若已装）→ 会话开始可见。写契约暂存（APPLY.md）也是「耗尽/锁冲突」的处置路径。
  5. **敏感边界**：本文档不放任何密钥/令牌；凭据只走 cc-switch / 环境变量。
- **工作台规则**：`templates/workbench/AGENTS.md` ops 节补一句「无头运行账号/配额见 docs/HEADLESS-OPS.md；用量异常时先查 provider 状态再排查 cron」。
- 事实核对：以当前机器 cc-switch 配置为准（只读，不触碰凭据内容）。

## Acceptance Criteria

- [ ] `docs/HEADLESS-OPS.md` 就位，路由/配额/耗尽处置/兜底四节齐全，步骤可照做。
- [ ] 文档事实与当前环境一致（provider=cc-switch 代理+failover，auth 走 profile），无密钥。
- [ ] `templates/workbench/AGENTS.md` 补 ops 指引；gen-assets + build 同步。
- [ ] 与 A/B 的失败可见性内容衔接一致（引用 `cron failures` / hook，不重复维护）。

## Notes

- 研究（2026-08-03）：`~/.cc-switch/settings.json` → `enableLocalProxy: true`、`enableFailoverToggle: true`、`currentProviderClaude`（provider profile id）；`~/.claude.json` → 无 oauthAccount / customApiKeyResponses / ANTHROPIC_API_KEY env → auth 全走 cc-switch profile。hub.json 的 cc-switch 资源 entrypoint = 本地代理 127.0.0.1:2006。
- 不做：不封装 gbrain、不引入常驻进程、不读取/存储凭据。配额查看依赖 provider 侧 UI/API，本文档只给操作路径。
