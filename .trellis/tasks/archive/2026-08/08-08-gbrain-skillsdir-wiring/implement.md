# Implement — gbrain skillsDir 接线

> 需求见 `prd.md`，设计见 `design.md`。单机单工作台（用户确认）。

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun test application/gbrain/                 # 本任务新增
bun run scripts/gen-assets.ts && git diff --exit-code
```

## 步骤

### S1 · 纯逻辑 `application/gbrain/wiring.ts`

- [x] S1.1 新建 `application/gbrain/wiring.ts`，按 `design.md` §3.1：
      `claudeJsonPath` / `gbrainServer` / `gbrainSkillsDirWired` / `wireSkillsDir`
- [x] S1.2 `wireSkillsDir` 五分支：no-claude-json / invalid / no-gbrain-server /
      already-wired / wired（含 backup + merge env + 写回）
- [x] S1.3 `WireResult` 带 status + 将写的 env 值（供 `--dry-run` 展示）
- [x] S1.4 单测：五个分支 + merge 保留其它 env 键 + 备份发生

### S2 · CLI `jspace gbrain wire`

- [x] S2.1 新建 `cli/commands/gbrain.ts`：`gbrainSpec`，子命令 `wire`，
      `features: { dir: true }`，选项 `--dry-run`
- [x] S2.2 handler：`expandTilde` + `os.homedir()` → `claudeJsonPath` → `wireSkillsDir`；
      `--dry-run` 注入 no-op 写/备份，只返回将写的值
- [x] S2.3 注册进 `cli/commands/registry.ts` 的 `COMMANDS`
- [x] S2.4 冒烟（**用副本，不碰真实 ~/.claude.json**）：
      ```bash
      # 复制真实配置到 /tmp 做只读验证
      cp ~/.claude.json /tmp/claude-json-fixture
      HOME=/tmp/... 不方便——用测试注入 homedir；CLI 冒烟用 --dry-run 对真实文件
      bun run cli/main.ts gbrain wire --dir <tmp wb> --dry-run   # 显示将写值，不落盘
      ```

### S3 · doctor 诊断

- [x] S3.1 `CronHealthDeps` 增 `readUserClaudeJson?: () => unknown | null`；
      cli 侧 `helpers.ts` 注入真实读取（`~/.claude.json`，损坏返回 null）
- [x] S3.2 `doctor.ts` 增 `gbrain.skillsdir_unwired`（info 级）：
      env 缺失或 ≠ 当前 `.jspace/skills` → 报；已配正确 → 不报
- [x] S3.3 测试：注入带/不带 env 的 server stub；干净台默认 stub 不报
- [x] S3.4 `bun test application/workspace/doctor.test.ts`

### S4 · 文档

- [x] S4.1 `skills/jspace-use/references/gbrain.md` 首次启用接线节补「skillsDir 接线」：
      为什么 / `jspace gbrain wire` / 改后重启 claude 会话
- [x] S4.2 `skills/jspace-use/references/example-first-use.md` Phase 4 的 MCP 接线处
      提及 env 接线（可选，若段落不膨胀则并入）
- [x] S4.3 `bun run scripts/gen-assets.ts && bun run scripts/check-skills.ts`

### S5 · 端到端验证

- [x] S5.1 副本验证写逻辑：把 `~/.claude.json` 复制到 tmp，注入 `claudeJsonPath` 指向副本，
      跑 wire → 验证副本含 env、原文件未动
- [x] S5.2 真实 gbrain 接线验证：`GBRAIN_SKILLS_DIR=<wb>/.jspace/skills gbrain check-resolvable`
      → 4 官方 skill reachable（证明 env 值正确）
- [x] S5.3 doctor 诊断端到端：真实 `~/.claude.json`（未 wire）→ `jspace doctor --dir <wb>`
      报 `gbrain.skillsdir_unwired`
- [x] S5.4 `--dry-run` 对真实文件：显示将写值、文件无变化（sha 前后一致）

> **Review gate**：S5 全程不写真实 `~/.claude.json`（除用户最终手动确认的 wire 外）。

### S6 · 收尾

- [x] S6.1 全套验证命令跑通；gen-assets 幂等
- [x] S6.2 仓库 PUBLIC：无真实路径泄漏（fixture 用 tmp）

## 不做

- 不自动创建 `mcpServers.gbrain`（提示 `claude mcp add`）
- 不处理多工作台（单机单工作台已确认）
- 不自动重启 gbrain serve / claude（接线后提示用户）
- 不做 unwire 命令（预留接口即可）

## 完成判据

`prd.md` AC1~AC8 全部勾选。AC6（gbrain 官方 skill reachable）必须有实测记录。
