# gbrain skillsDir 接线：GBRAIN_SKILLS_DIR 指向 .jspace/skills

## Goal

让 gbrain 的 skill resolver 直读工作台的**官方 skill**（`.jspace/skills/` 的 frontmatter），而不是碰巧读根 `skills/` 的历史副本、或在清理后回退到 gbrain 安装路径的内置 skill。

## 背景（已用源码 + 实测确认，2026-08-08）

- gbrain resolver 的 skillsDir 来源（`repo-root.ts:118` `autoDetectSkillsDir`）优先级：
  `$GBRAIN_SKILLS_DIR` → `$OPENCLAW_WORKSPACE` → cwd 向上找根 `skills/` → `~/.openclaw/workspace` → gbrain 安装路径。
  **不认 `.jspace/skills/`**。
- 当前 `~/jspace-work` 靠根 `skills/` 的 4 个历史遗留副本（A 任务诊断的 `legacy_root_copy`）才让 gbrain 报 "4 skills reachable"；实测移走根 `skills/` 后 gbrain 回退到安装路径的 52 个内置 skill——**官方 skill 路由静默断**。
- `--skills-dir .jspace/skills` 实测可行（4 skills all reachable，读官方 frontmatter）。
- `gbrain serve`（MCP 常驻）**没有 `--skills-dir` flag**，resolver 只靠启动时环境变量。
- gbrain config.json **不支持 skills_dir 持久化**——只能环境变量。
- 当前 `~/.claude.json` 的 gbrain server 是 `{command: gbrain, args: [serve], type: stdio}`，**无 env 字段**。
- 单机单工作台（用户确认），`GBRAIN_SKILLS_DIR` 作为机器级 env 是确定的。

## Requirements

### R1 — 接线命令
- **R1.1** 新增 `jspace gbrain wire`：把 `GBRAIN_SKILLS_DIR=<工作台>/.jspace/skills`（绝对路径）合并进
  `~/.claude.json`（Windows `%USERPROFILE%\.claude.json`）的 `mcpServers.gbrain` 的 `env` 字段
- **R1.2** **合并不覆盖**：已有 gbrain server 的其它字段（command/args/type/env 其它键）原样保留；
  只设/覆盖 `env.GBRAIN_SKILLS_DIR`
- **R1.3** `--dir` 指定工作台（默认 cwd）；幂等——已配且值正确则报 `already wired`，exit 0
- **R1.4** gbrain server 不存在 → 报错提示先 wire MCP（不自动创建 MCP 配置，避免越权）
- **R1.5** 干跑 `--dry-run`：显示将写的字段，不落盘

### R2 — doctor 诊断
- **R2.1** 新增 `gbrain.skillsdir_unwired`（info 级）：`~/.claude.json` 的 gbrain server env 里
  `GBRAIN_SKILLS_DIR` 缺失、或指向 ≠ 当前工作台 `.jspace/skills` → 提示跑 `jspace gbrain wire`
- **R2.2** 已有且正确 → 不报（info 级，不产生噪音）

### R3 — 文档
- **R3.1** `skills/jspace-use/references/gbrain.md` 首次启用接线节补「skillsDir 接线」：
  为什么（官方 skill 路由依赖它）、怎么配（`jspace gbrain wire`）、改后需重启 claude 会话
- **R3.2** `harness-config` 的多 harness MCP 接线表如涉及 gbrain server env，同步提及

## Acceptance Criteria

- [ ] AC1 `jspace gbrain wire --dir <工作台>` 后，`~/.claude.json` gbrain server 含
      `env.GBRAIN_SKILLS_DIR=<工作台>/.jspace/skills`，且 command/args/type 原样保留
- [ ] AC2 重复执行 → 幂等，报 `already wired` 不重复写
- [ ] AC3 `--dry-run` 不落盘，显示将写的字段
- [ ] AC4 gbrain server 不存在 → 报错提示，exit 非 0，不创建 MCP 配置
- [ ] AC5 `jspace doctor --dir <工作台>` 在未 wire 时报 `gbrain.skillsdir_unwired`；wire 后消除
- [ ] AC6 wire 后 `GBRAIN_SKILLS_DIR` 指向 `.jspace/skills` 时，gbrain resolver 报官方 4 skill reachable
      （实测验证：`gbrain check-resolvable --skills-dir <工作台>/.jspace/skills`）
- [ ] AC7 干净工作台 doctor 无新增噪音（skillsdir 已配时 info 不报）
- [ ] AC8 `bunx tsc --noEmit`、`bun test` 全绿；gen-assets 幂等

## 约束

- 仓库 PUBLIC：新增内容中性，无真实路径（`~/jspace-work` 只出现在测试 fixture，用 tmp 目录）
- 不自动创建 `mcpServers.gbrain`（越权改写机器级配置）；只接线已存在的
- 改 `~/.claude.json` 前备份 `~/.claude.json.bak-<ts>`（破坏性操作可恢复）
- 跨平台：Windows `%USERPROFILE%\.claude.json`；路径归一化（`expandTilde` 既有工具）

## 非目标

- 不改 gbrain 本身（`GBRAIN_SKILLS_DIR` 是现有机制，只是 JSpace 侧接线）
- 不处理多工作台（用户确认单机单工作台）
- 不自动重启 gbrain serve / claude 会话（接线后提示用户重启）
