# P2: Grok Build 支持（T1 桥接，方案 B）

## Goal

把 Claude 接线「几乎原封 port」到 Grok Build：init 出 Grok 五件套（`.grok/hooks/jspace.json` + `.grok/skills/` 投影 + `context pre-compact/session-end` 子命令 + `harness wire --harness grok` + managed-files 清单），Grok 用户获得与 Claude 等价的 session-start 注入 / 收工纪律，同时 gbrain 保持唯一事实源（父任务 D1/B）。

父任务：`08-09-multi-harness-support`。依赖：P1（capabilities.yaml + grok adapter 骨架）。

## Confirmed Facts（已核实）

- Grok Build 认 `.claude/settings.json` 路径的 hook（兼容扫描），惯用 `.grok/hooks/*.json`；hook 事件集与 Claude 对齐且多 SessionEnd
- Grok MCP 配置在 `~/.grok/config.toml` 的 `[mcp_servers.gbrain]`，格式与 codex/claude 一致
- Grok native memory 存在但默认关（experimental），本任务按 D1/B 只做 bridge 不切权威
- 决策：D2=PreCompact **被动注入**（方案 a，不自动写 gbrain）；写回仍走显式「收工」

## Requirements

- **R1** 新增模板 `templates/workbench/.grok/hooks/jspace.json`：SessionStart（matcher `startup|clear|compact|resume`，`jspace context session-start`）、UserPromptSubmit（`jspace context turn`）、PreCompact（`jspace context pre-compact`，timeout 30）、SessionEnd（`jspace context session-end`）。**capabilities.grok.sessions 与此 4 事件一致**（sessions = jspace 实际接线事件集；Grok 平台另支持 Stop 未接线，yaml 注明）
- **R2** `cli/commands/context.ts` 新增 `pre-compact` 与 `session-end` 两个子命令（CmdResult 出口，不 console.exit）；`application/context/collect.ts` 新增对应事件 payload 生成
- **R3** `jspace context pre-compact` 语义 = **被动注入**（D2/方案 a）：注入「快 compaction 了，如有需记忆的事实请用户触发 memory-writeback」提醒，不自动写 gbrain
- **R4** 模板技能投影新增 `.grok/skills/` 目标（jspace-use / asset-ingest / memory-recall / memory-writeback 投影到 `.grok/skills/`）
- **R5** 新增 `jspace harness wire --harness grok`：把 `GBRAIN_SKILLS_DIR` env 注入 `~/.grok/config.toml` 的 `[mcp_servers.gbrain]`。**注意：`application/gbrain/wiring.ts` 是 JSON 专属**，TOML 需读-改-写 `~/.grok/config.toml` 的 gbrain 表（保留其他表 + 备份）；需新建 `jspace harness` 命令族（当前只有 `gbrain wire`）。TOML 处理方式 P2 实现时定（最小行解析或引入轻量依赖，与 P1 yaml 决策一并考虑）
- **R6** `templates/workbench/` README 把 `.grok/hooks/` 与 `.grok/skills/` 列入 managed-files 清单（seed 未修改随升级刷新）
- **R7** `adapters/harness/grok.ts`（P1 落骨架）实现 hook 文件生成 + skill 投影目标
- **R8** hook 双写显式接受：现有 `.claude/settings.json`（SessionStart/UserPromptSubmit）若被 Grok 兼容扫描读取，去重靠 `jspace context session-start` 幂等（现状已幂等）；模板只新增 `.grok/hooks/jspace.json` 一处；harness-grok.md（P5 创建）注明此权衡

## Acceptance Criteria

- [ ] AC1 `bun run cli/main.ts init /tmp/jspace-grok` 后 `.grok/hooks/jspace.json` 与 `.grok/skills/{jspace-use,asset-ingest,memory-recall,memory-writeback}/` 落地
- [ ] AC2 `jspace cron run <cron> --harness grok --dry-run` 可组装 argv（headless `grok -p`）
- [ ] AC3 `jspace context pre-compact` / `session-end` 子命令单测断言（输出含提醒文案，不写 gbrain）
- [ ] AC4 `adapters/harness/grok.test.ts`：hook JSON 结构断言（与 capabilities.yaml.grok.sessions 四事件一致）
- [ ] AC5 模板回归测试：init 后 .grok 五件套落地
- [ ] AC6 `bunx tsc --noEmit` + `bun test` 全过
- [ ] AC7 CI 加 `jspace cron run <cron> --harness grok --dry-run` argv 组装断言（无需真 grok 二进制，P1 R6b 前提）；真实 Grok 会话触发验证清单 + hook 格式实测经验写入本任务 notes（素材供 P5 写 harness-grok.md）

## Out of Scope

- 自动写 gbrain（方案 b 留 M7）
- Grok native memory 接入 gbrain slug 生命周期（D1/B 明确不参与）
- SessionEnd 的自动 writeback（收工仍显式）
