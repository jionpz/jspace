# M5 模板去个人化 — 执行计划

## 实施清单（按序）

- [x] 1. 删两域：`git rm` 或直接删 `templates/workbench/workspace/jspace-dev/`、`templates/workbench/workspace/agent-infra/`（4 文件）。
- [x] 2. `templates/workbench/.jspace/hub.json` 清空：`{"version": 3, "domains": [], "resources": []}`。
- [x] 3. `templates/workbench/AGENTS.md` 中性化：
  - 删「Initial domains are jspace-dev and agent-infra;…」句 → 「初始无域，域从真实使用涌现」。
  - 删 `Agent-infra Workflow` 整段。
  - Modes 表删 `Agent-infra domain` 行。
  - 「First core - gbrain」去域绑定（删「注册于 agent-infra」）。
  - `Development Mode` / `Brain operations` / 其他段：删 `__DEV_ROOT__`、cc-switch 引用。
- [x] 4. `templates/workbench/README.md` 中性化：结构清单删两域行；删 `__DEV_ROOT__` 引用；加「初始无域」说明。
- [x] 5. `skills/jspace-bootstrap/references/harnesses.md` + `gbrain.md`：清 cc-switch/代理/agent-infra/owner 路径，改中性/可选描述。
- [x] 6. 全模板 grep 验收：`jionpz|cc-switch|agent-infra|jspace-dev|/Users/jionpz|__DEV_ROOT__` = **0 命中**（templates/ + skills/ 全中性）`jionpz|cc-switch|agent-infra|jspace-dev|/Users/jionpz|__DEV_ROOT__` = 0 命中。
- [x] 7. `bun run scripts/gen-assets.ts` 重新生成；`bunx tsc --noEmit`；`bun run build`。
- [x] 8. 验证：源码 init + 二进制 init 各一次，grep 零命中 + `doctor` 0 error + `cron list` 三任务。

## 验证命令

```bash
# 模板本身零 owner 字符串
grep -rEn 'jionpz|cc-switch|agent-infra|jspace-dev|/Users/jionpz|__DEV_ROOT__' templates/ skills/ || echo "模板中性 ✓"

# 重新生成嵌入式资产 + 编译
bun run scripts/gen-assets.ts && bunx tsc --noEmit && bun run build

# 源码 init 验证
bun run cli/main.ts init --force /tmp/wb-dep && \
  grep -rEn 'jionpz|cc-switch|agent-infra|jspace-dev|/Users/jionpz|__DEV_ROOT__' /tmp/wb-dep/ && echo "有残留 ✗" || echo "源码工作台中性 ✓"
bun run cli/main.ts doctor --dir /tmp/wb-dep
bun run cli/main.ts cron list --dir /tmp/wb-dep

# 二进制 init 验证
bin/jspace init --force /tmp/wb-dep2 && \
  grep -rEn 'jionpz|cc-switch|agent-infra|jspace-dev|/Users/jionpz|__DEV_ROOT__' /tmp/wb-dep2/ && echo "有残留 ✗" || echo "二进制工作台中性 ✓"
bin/jspace doctor --dir /tmp/wb-dep2
```

## 风险文件 / 回滚点

- 全部改动在 `templates/` + `skills/jspace-bootstrap/references/` + 生成文件 `cli/assets.generated.ts`。
- `assets.generated.ts` 由脚本生成，可重新生成；模板改动可 revert。
- 无外部动作；不做 tag/发布（本任务只改模板，发布等 owner 拍板时机）。

## task.py start 前复查

- [ ] prd 收敛（无 TBD/重复事实）
- [ ] design.md / implement.md 齐备
- [ ] 中性默认方案（空 workspace + __DEV_ROOT__ 移除）经 owner 批准

## 发布记录（wrap-up 追加）

- [x] 9. 推送 main `c0a5a7e`（经 owner 确认）。
- [x] 10. 发布 **v1.0.1**（经 owner 确认，正式公开分发）：tag 指向含中性模板提交（hub 0 域 0 资源）；CI 6 平台全绿 → release Latest → verify-install 三平台全绿；`latest/download` 现指向 v1.0.1 中性二进制。
- 公开分发开启：任何人在任意平台 `jspace init` 得到中性工作台；已安装用户一键脚本自动升级。
