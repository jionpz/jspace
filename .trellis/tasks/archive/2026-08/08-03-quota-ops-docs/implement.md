# 账号/配额运维文档 — 实施计划(简版,纯文档)

## 前置
- 独立文档交付，不依赖 A/B；可与 A 并行。

## 有序清单

1. 核对当前环境事实（只读，不触碰凭据）：
   - cc-switch `settings.json`（enableLocalProxy / enableFailoverToggle / currentProviderClaude）。
   - `~/.claude.json` auth 现状（无 OAuth/自定义 key → auth 走 cc-switch profile）。
   - hub.json cc-switch 资源（本地代理 127.0.0.1:2006）。
2. 写 `docs/HEADLESS-OPS.md`：路由模型 / 用量配额查看 / 耗尽处置 / JSpace 兜底 / 敏感边界（无密钥）。
3. `templates/workbench/AGENTS.md` ops 节补一句「无头运行账号/配额见 docs/HEADLESS-OPS.md」。
4. gen-assets + build（改了模板）；`bun test` + `tsc` 不破。
5. 与 A/B 文档衔接（引用 `cron check` / hook，不重复维护）。

## 验证命令

```bash
bun run scripts/gen-assets.ts && bun run build
bun test && bunx tsc --noEmit
```

## 评审门 / 回滚点

- 纯文档，评审即看 PRD/文档一致；回滚 = 撤文档改动。
