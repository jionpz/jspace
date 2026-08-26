# P2 素材：Grok 真实会话验证清单 + hook 格式实测记录

> 素材用途：P5 创建 `harness-grok.md` 时的内容来源。**本任务不建 harness-grok.md**（归 P5 的 harnesses.md 拆分）。

## 已实现的 Grok 接线（可断言，P2 交付）

| 项 | 状态 | 证据 |
|---|---|---|
| `.grok/hooks/jspace.json` 四事件 | ✅ init 落地 | `cli/init.test.ts`「init materializes the Grok hook file…」 |
| `.grok/skills/` 投影 | ✅ init 落地 | SKILL_PROJECTIONS 从 capabilities.workbench_projection 推导（P1） |
| `jspace context pre-compact` / `session-end` | ✅ 子命令 | payload.test.ts 断言「被动不自动写」 |
| `jspace harness wire --harness grok` | ✅ TOML 合并 | grok-wiring.test.ts 9 case + 实机 temp config 验证 |
| `cron run --harness grok` argv | ✅ 组装 | execute.test.ts harnessOverride seam + verify.yml 断言 |

## 待真实 Grok 环境验证（P5 harness-grok.md 必须标注「best_effort / 待实测」）

1. **hook matcher 语义**：`.grok/hooks/jspace.json` 用单字段 `|` 正则 matcher（`startup|clear|compact|resume`）。Claude 模板是三条独立 matcher；Grok 对单字段正则的语义**未在真实 Grok 验证**。若 Grok 不认 `|` 正则 → 改成多 matcher 条目（与 `.claude/settings.json` 同构）。
2. **SessionEnd hook 触发**：Grok 独有的 SessionEnd 事件是否在会话结束时真实 fire、`jspace context session-end` 是否被调用——未实测。
3. **PreCompact hook**：`jspace context pre-compact`（timeout 30）是否在 compaction 前触发；Grok 是否同时触发 `.claude/settings.json`（兼容扫描）→ 双写重复触发与否。
4. **`harness wire --harness grok` 的 `~/.grok/config.toml` 实际格式**：本机无 Grok，TOML 按 `[mcp_servers.gbrain]` + `env = { GBRAIN_SKILLS_DIR = ... }` 推断；真实 Grok config.toml 若用多行 env 表或不同键名 → 合并需适配（当前 mergeGrokEnv 对多行 env 块保守返回 already-wired，不破坏）。
5. **MCP env 生效**：wire 后需重启 Grok 会话让 gbrain serve 带新 env 启动——`harness wire` 输出已提示。

## 最小真机验证命令（有 grok 时执行）

```bash
jspace init /tmp/jspace-grok-verify
jspace harness wire --harness grok --dir /tmp/jspace-grok-verify
grok -p "print the session-start context" --cwd /tmp/jspace-grok-verify   # 看 SessionStart hook 是否注入
# 结束后检查: .jspace-logs / gbrain 是否有预期写回(应无自动写 —— D2/方案 a)
```

## 已知权衡（harness-grok.md 注明）

- **hook 双写**：若 Grok 兼容扫描同时读 `.claude/settings.json`（现存 SessionStart/UserPromptSubmit），可能与 `.grok/hooks/jspace.json` 重复触发。去重靠 `jspace context session-start` 幂等（现状已幂等：非工作台/钩子关 → exit 0 零输出）。模板只写 `.grok/hooks/jspace.json` 一处，不复制。
- **gbrain 权威（D1/B）**：Grok native memory 默认关（experimental），不参与 gbrain slug 生命周期；bridge 只在 hook 时机注入提醒，写回走显式收工。
