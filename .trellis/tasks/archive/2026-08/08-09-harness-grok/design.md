# P2 Design: Grok Build 桥接（方案 B）

## 架构边界

```
Grok session 事件 ──► .grok/hooks/jspace.json ──► jspace CLI
   SessionStart        (模板 seed,未修改随升级刷新)    context session-start / turn
   UserPromptSubmit                                   context pre-compact（被动注入）
   PreCompact                                          context session-end
   SessionEnd                                        └─► 全部 CmdResult 出口,不写 gbrain
```

- **gbrain 权威不变**（D1/B）：Grok native memory 是 Grok 内 UX，不进 gbrain slug 生命周期；bridge 只在本任务 hook 时机注入「提醒」，写回仍走显式收工
- **D2/方案 a**：PreCompact hook → `jspace context pre-compact` → 注入「快 compaction 了，如有需记忆的事实请触发 memory-writeback」，**不自动写**

## 关键设计决策

1. **hook 文件放 `.grok/hooks/jspace.json` 而非仅 `.claude/settings.json`**：Grok 惯用 + cascade trust 清楚；与 Claude 接线并存（`.claude/settings.json` 已存在，Grok 兼容扫描也认它）。**双触发显式接受（R8）**：若 Grok 同时读现有 `.claude` 配置，去重靠 `jspace context session-start` 幂等（现状已幂等）；模板只新增 `.grok/hooks/jspace.json` 一处，不复制；harness-grok.md 注明。Grok matcher 语义（单字段 `|` 正则 vs Claude 三条独立 matcher）列入验证项，模板落地前核实
2. **`pre-compact` / `session-end` 子命令**：加到 `cli/commands/context.ts`，与现有 session-start/turn 同构；collect.ts 加 `preCompact` / `sessionEnd` 事件 payload。payload 语义：
   - preCompact：当前会话未确认 incident/pending 提醒 + 「写回走显式收工」提示
   - sessionEnd：会话结束结算提醒（同收工纪律，不自动写）
3. **`.grok/skills/` 投影**：复用现有 skill 投影机制（materialize 到目标目录）。`skillProjectionTargets`（P1 接口）返回 `[.grok/skills]`；投影源仍是 `.jspace/skills/` 的 harness-agnostic 拷贝
4. **`harness wire --harness grok`**：`application/gbrain/wiring.ts` 是 **JSON 专属**（readJson/writeJson/backup）；Grok 配置在 `~/.grok/config.toml`。P2 需新建 `jspace harness` 命令族 + TOML **读-改-写**（解析 `[mcp_servers.gbrain]` 表，保留其他表 + 备份）。TOML 处理方式：最小行解析或轻量依赖，P2 实现时定（与 P1 yaml=Bun.YAML 决策一并评估；bun 无内置 TOML 序列化）。只写不覆盖既有非 gbrain 配置
5. **managed-files**：`.grok/hooks/jspace.json` + `.grok/skills/` 列入 seed 清单（未修改随升级刷新），README 同步

## 数据流

Grok 会话启动 → SessionStart hook → `jspace context session-start` → 注入工作台状态；收工前 PreCompact hook → `jspace context pre-compact` → 提醒「有事实可显式收工」→ 用户/agent 显式跑 memory-writeback skill → gbrain state 更新。SessionEnd → 结算提醒。

## 兼容性 / 迁移

- `.grok/hooks/jspace.json` 是新目录新文件，对既有工作台是增量（init 新出 / upgrade 落地），不破坏 `.claude/settings.json`
- `context.ts` 加子命令是纯新增，不动现有 session-start/turn 行为
- 回滚：删 `.grok/` 模板条目 + revert context/collect 改动即回滚

## 风险 / 权衡

- **hook 双写**（`.grok/hooks/` + 现有 `.claude/settings.json` 若被 Grok 兼容扫描读取可能重复触发）→ **显式接受的已知权衡（R8）**：去重靠 session-start 幂等；`.claude/settings.json` 不为 Grok 复制；harness-grok.md 注明。Grok 真实会话触发无法在 CI 全验 → AC7 的 CI 部分只测 argv 组装 + hook JSON 结构（与 capabilities.grok.sessions 一致），真实会话验证清单写入 notes 供 P5
