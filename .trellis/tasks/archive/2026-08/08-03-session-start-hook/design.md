# 工作台 SessionStart hook — 技术设计

## 边界

**范围内**
- `templates/workbench/.claude/settings.json` 新增 SessionStart hook（Claude Code）。
- `templates/workbench/AGENTS.md` cron 节补强（Claude 自动 + 其他 harness 手动兜底）。
- 依赖 A 的 `jspace cron check` 命令（hook 调用它）。

**范围外**
- 不改 harness 侧逻辑；不为非 Claude harness 做 hook（用 AGENTS.md 指令兜底）。
- 不做常驻进程 / 主动推送（hook 是会话启动时的一次性注入）。
- 不改 A 的命令契约。

## 契约

### `.claude/settings.json`（模板，物化进工作台）
```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "jspace cron check 2>/dev/null || echo '[jspace] cron check 不可用(jspace 未安装或不在 PATH)'" } ] }
    ]
  }
}
```
- SessionStart hook 在 claude 于工作台根启动时运行，stdout **注入会话上下文**。
- cwd = 工作台根 → `jspace cron check` 用 `workbenchRoot()` = 工作台，正确。
- `2>/dev/null` 压 stderr；`||` 降级：jspace 缺失时不 crash 会话，输出一行提示。
- 无失败时 `cron check` 输出简短（failures (0) / pending (0) / needs_attention 0）——不打扰。
- **schema 校验**：实施时用 `update-config` skill 核对当前 Claude Code 的 hooks schema（SessionStart 数组结构、command 字段），以实际 schema 为准，避免凭记忆写错。

### AGENTS.md 补强（templates/workbench/AGENTS.md cron 节）
- 加：Claude Code 会话由 SessionStart hook 自动检查 `jspace cron check`；其他 harness（pi/codex/cursor）会话开始时**手动**跑一次 `jspace cron check`；有 needs_attention 先处置（失败原因 / pending APPLY 应用窗口）。

### 物化验证
- `jspace init` 生成的临时工作台含 `.claude/settings.json`；内容与模板一致。
- 手跑 hook 命令本体（`jspace cron check`）在真实工作台输出正确。

## 数据流

```
claude 在 <workbench> 启动
  → SessionStart hook 运行 `jspace cron check`（cwd=workbench）
  → stdout 注入会话上下文（失败/pending/状态摘要）
  → AI 会话开始即见需关注项，主动处置
```

## 取舍

- **Claude-only hook + 其他 harness 手动**：JSpace 支持多 harness，但 hook 是 Claude Code 能力。这是有意的 harness 差异，AGENTS.md 兜底文档化。
- **人类可读输出而非 --json**：注入给模型的是文本上下文，人类可读更利于直接读；`--json` 留给脚本。
- **降级不 crash**：hook 失败（jspace 缺失）只提示，不阻塞会话——SessionStart hook 的失败不应挡住工作。
- **commit `.claude/settings.json` 进工作台 git**：控制平面 git 同步，每机一致；需确认模板 `.gitignore` 不排除 `.claude`（实施时核对）。

## 兼容性 / 回滚

- 模板改动 → gen-assets + build 同步；回滚 = 撤模板 + 重跑。
- 若用户已有自己的 `.claude/settings.json`（工作台生成后手改），物化只写初始，不覆盖已存在文件？——实施时按 materializeTree 行为确认（模板覆盖 vs 跳过）。倾向：生成时写入；用户后续自改以用户为准（git 里模板是源头）。
