# 账号/配额运维文档 — 任务记录

## 交付物
- `docs/HEADLESS-OPS.md`（新增）：无头执行运维模型——①路由（claude -p → cc-switch 本地代理 127.0.0.1:2006 + failover → currentProviderClaude profile，auth 走 profile）；②用量/配额查看（provider 控制台、Claude 5h/5d 滑动窗口、doctor/代理日志）；③耗尽处置（failover → 重试 → 降档 → 记录）；④JSpace 兜底（cron check / hook / doctor / pending APPLY）；⑤敏感边界（无密钥）。
- `templates/workbench/AGENTS.md` cron 节：补内联要点（headless 走 cc-switch 代理 + failover，配额/耗尽处置指向发行包 docs/HEADLESS-OPS.md）。
- `cli/assets.generated.ts`：再生成。

## 验证（2026-08-03）
- `bun test` 30/30、`tsc` 干净、build 成功。
- `jspace init` 物化 AGENTS.md 含 HEADLESS-OPS 引用（1 处）。

## 关键决策
- **工作台无 docs/ 目录** → AGENTS.md 用「内联要点 + 指向发行包文档」而非悬空路径引用；文档权威源在 jspace 仓库 `docs/HEADLESS-OPS.md`。
- 敏感边界：文档零密钥；排查只读 profile 名/状态，不 dump 凭据。
- 不改 provider/代理配置（网络出口默认拒绝，改动需确认）；本文档只给「怎么看、怎么处置」路径。

## 备注
- 与 A（cron check / hook）衔接一致：引用 `jspace cron check`，不重复维护。
- 配额查看依赖 provider 侧 UI/API，本文档只给操作路径，不封装。
