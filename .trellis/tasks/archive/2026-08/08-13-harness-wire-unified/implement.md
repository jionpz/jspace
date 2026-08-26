# Implement: 统一 harness init/wire 命令(issue #12)

> 前置:阅读 `prd.md`(需求/验收)与 `design.md`(技术设计)。本文件是执行清单。
> 验证入口:仓库 `jspace` 开发流程——`bun run scripts/gen-assets.ts`、`bun test`、`bun run scripts/check-harness-consistency.ts`、`bun run scripts/check-manifest-integrity.ts`、`bun run scripts/check-skills.ts`、tsc。

## 阶段 0:基线确认(一次性)

- [ ] 0.1 确认基线绿:`bun test`、`bun run scripts/check-harness-consistency.ts`、`bun run scripts/check-manifest-integrity.ts`、tsc 全部通过。
- [ ] 0.2 本机 opencode 实证:确认 `~/.config/opencode/opencode.jsonc` 是否存在及其 mcp 段格式;把结论写回 design §7 未决(已确认部分)。本机无 opencode 则按 context7 格式实现 + 单测覆盖,不阻塞。

## 阶段 1:capabilities.yaml 补 mcp_config + 重生成(改数据)

- [ ] 1.1 `adapters/harness/capabilities.yaml` 补三端 `mcp_config`(加可选 `env_key`,缺省 "env";opencode 用 "environment"):
  - cursor: `{ path: "~/.cursor/mcp.json", format: json, server_key: "mcpServers.gbrain" }`
  - opencode: `{ path: "~/.config/opencode/opencode.json", format: json, server_key: "mcp.gbrain", env_key: "environment" }`(路径已本机实证)
  - pi: `{ path: "~/.pi/agent/mcp.json", format: json, server_key: "mcpServers.gbrain" }`
- [ ] 1.1b `types.ts` McpConfig 加可选 `env_key`;`gen-assets.ts` 渲染不丢该字段(逐字段渲染则补)。
- [ ] 1.2 `types.ts` 注释更新:三端 wire 已有,不再是「null until a wire exists」。
- [ ] 1.3 `bun run scripts/gen-assets.ts` 重生成 `capabilities.generated.ts`。
- [ ] 1.4 跑 P5 check-harness-consistency(预期绿,mcp_config 不在其断言面)。

## 阶段 2:wire 分派层 + 新三端 backend(纯函数,注入 deps)

> 新文件 `application/harness/wire.ts`,沿用 `application/gbrain/wiring.ts` / `grok-wiring.ts` 的纯函数 + 注入 deps 模式。claude/grok backend 直接复用现有函数(不重写)。

- [ ] 2.1 `application/harness/wire.ts`:
  - `HarnessWireDeps`(readFile/writeFile/backup/homedir/resolveWorkbenchSkillsDir/ensureResolverFile/resolveGbrainBin/dryRun)——见 design §2.2。
  - `resolveGbrainBin()`:`$GBRAIN_BIN` → `command -v gbrain`(Windows `where`;同步,失败 null)→ `~/.bun/bin/gbrain`(Windows `%USERPROFILE%\.bun\bin\gbrain.exe`);null 时 cursor/pi 报 `no-gbrain-bin`。
  - `WireOutcome` 类型 + 每端 backend 函数签名。
- [ ] 2.2 claude backend:调 `wireSkillsDir`(现 `application/gbrain/wiring.ts`),status 映射到统一 `WireOutcome`。
- [ ] 2.3 grok backend:调 `wireGrokSkillsDir`(现 `grok-wiring.ts`),status 映射。
- [ ] 2.4 cursor backend:
  - 读 `~/.cursor/mcp.json`(缺失 → `{}`);merge `mcpServers.gbrain = { command: resolveGbrainBin(), args: ["serve"], env: { GBRAIN_SKILLS_DIR } }`;backup + write。
  - skills 薄链:`~/.cursor/skills/<name>` symlink → `~/.agents/skills/<name>`(SKILLS_MANIFEST.workbench 官方 skill 名);已存在指向正确 → already;指向别处 → 不覆盖报 info;目标缺失 → 调 `installSkills`(官方包,自动)或提示(实现时定,倾向自动)。
  - 可选:项目级 `.cursor/rules/jspace.mdc` 指针(design §2.5;实现时若时间紧标 optional 并在输出说明)。
  - `describe`:打印「无 headless、不进 cron、session-start best_effort、session-end manual」。
- [ ] 2.5 opencode backend:读 `~/.config/opencode/opencode.jsonc`(JSONC,容错解析);merge `mcp.gbrain = { type: "local", command: ["<gbrain>", "serve"], enabled: true, environment: { GBRAIN_SKILLS_DIR } }`;backup + write。JSONC 注释容忍(保留注释的写回或降级为 JSON 重写,实现时定)。
- [ ] 2.6 pi backend:读 `~/.pi/agent/mcp.json`;merge `mcpServers.gbrain`;backup + write。
- [ ] 2.7 `application/harness/wire.test.ts`:五端 dry-run、幂等重跑(already-wired)、merge 保字段、JSONC 解析、gbrain bin 解析(注入 fake)、backup 语义、未知 harness 拒绝。
- [ ] 2.8 claude/grok 现有测试(`wiring.test.ts` / `grok-wiring.test.ts`)保持绿(复用不改)。

## 阶段 3:CLI 接入(`cli/commands/harness.ts` + `gbrain.ts`)

- [ ] 3.1 `harness.ts`:
  - `--harness` validate 从 `v === "grok"` 改为五端枚举(claude/grok/opencode/cursor/pi);`codex` 明确拒绝「cron 兼容条目」。
  - 新增子命令 `init`:`--harness <五端>`,`features: { dir: true, dryRun: true }`;handler 调现有 manifest 投影能力按端过滤;已物化 no-op。
  - `wire` handler 改为按 `--harness` 分派到 `application/harness/wire.ts` 对应 backend;claude/grok 行为不变;输出加能力边界行。
  - `gbrain wire`(claude)保持:命令 spec 文档字符串标注「等价 `jspace harness wire --harness claude`」。
- [ ] 3.2 `cli/handler-wiring.test.ts` 或新 harness 命令测试:五端 dry-run 输出断言、init no-op、别名 `gbrain wire` 兼容、未知 harness exit 2。
- [ ] 3.3 全量测试:`bun test`。

## 阶段 4:doctor 缺口检查

- [ ] 4.1 `checkGBrain` 已按 mcp_config 泛化——补三端后自动覆盖;跑现有 doctor 测试确认不回归(cursor/opencode/pi 配置缺失时对应 `gbrain.skillsdir_unwired` info 出现)。
- [ ] 4.2 新增 Cursor skills 薄链缺口检查(`~/.cursor/skills/` 无官方薄链 → info),放 doctor harness 相关检查区,注入 deps 可测。
- [ ] 4.3 doctor 测试补用例 + `bun test`。

## 阶段 5:文档收口

- [ ] 5.1 `skills/jspace-use/SKILL.md` §2 第 4 步「Harness wiring」→「选一个 harness → `jspace harness wire --harness <端> --dir .`」。
- [ ] 5.2 `references/harnesses.md`:逐 harness 接线节命令形态更新(claude → `harness wire --harness claude`(gbrain wire 为别名)、grok 不变、cursor/opencode/pi 新增);支持全景表注释更新。
- [ ] 5.3 `harness-cursor.md`:MCP「手写 mcp.json」改为「`jspace harness wire --harness cursor`」;skills 薄链 + 能力边界输出说明。
- [ ] 5.4 `harness-opencode.md`:MCP 接线改为命令。
- [ ] 5.5 `harness-pi.md`:MCP 接线改为命令(保留优先级列表作为 wire 目标说明)。
- [ ] 5.6 文档内命令示例全部带 `--dir`(命令面统一)。
- [ ] 5.7 P5 检查:`bun run scripts/check-harness-consistency.ts`(断言 5/6 覆盖文档面,改文档后须绿)。

## 阶段 6:全量验证 + 真机

- [ ] 6.1 `bun run scripts/gen-assets.ts`(若阶段 1 后无改动则 skip)→ `bun test` → tsc → `check-harness-consistency` → `check-manifest-integrity` → `check-skills` 全绿。
- [ ] 6.2 真机验证(本机 macOS,工作台 `~/jspace-work`):
  - `jspace harness wire --harness claude --dir <wb> --dry-run` vs `jspace gbrain wire --dir <wb> --dry-run` 输出等效。
  - `jspace harness wire --harness cursor --dir <wb> --dry-run` 打印 `~/.cursor/mcp.json` 计划;真实 wire 后 `cat ~/.cursor/mcp.json` 断言 `mcpServers.gbrain.command` 与 env 正确;`jspace doctor --dir <wb>` 缺口消失或如实报告。
  - `jspace harness init --harness cursor --dir <wb> --dry-run` no-op 输出。
  - grok 端(本机若有 `~/.grok/config.toml`):真实 wire 幂等重跑已-wired。
- [ ] 6.3 验证后决定是否把本机 wire 结果保留(若 `~/.cursor/mcp.json` 是用户真实配置,确认不污染)。

## 阶段 7:验收对照 + commit

- [ ] 7.1 对照 prd AC1-AC11 逐条核对,缺口补上。
- [ ] 7.2 提交前 `git diff` review;不提交 .env/密钥。
- [ ] 7.3 commit + (CI 若触发)确认绿。

## Rollback 点

- 每阶段独立 commit;阶段 1/3 之间可回滚(改 yaml 不动代码,反之亦然)。
- 机器配置写入均有 `.jspace-bak-*` backup;`gbrain wire`/`harness wire --harness grok` 现有行为保持,出问题只回滚新增 backend。
