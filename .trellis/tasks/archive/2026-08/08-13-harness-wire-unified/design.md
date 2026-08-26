# Design: 统一 harness init/wire 命令(issue #12)

## 1. 现状与目标

**现状**(2026-08-13 探查):
- `adapters/harness/capabilities.yaml` 声明六端能力,`mcp_config` 字段只有 claude/grok 有值(cursor/opencode/pi 为 null);`types.ts:24` 注释明确此字段是 `harness wire`/`gbrain wire` 与 doctor wiring 检查的单一来源——架构已预留扩展位。
- `cli/commands/harness.ts` 只有 `wire --harness grok`(validate 硬编码 `v === "grok"`),handler 直接调 `grokWireHandler`。
- `cli/commands/gbrain.ts` = claude 的 `gbrain wire`,调 `wireHandler`。
- `application/gbrain/wiring.ts`(claude,JSON merge,注入 `GBRAIN_SKILLS_DIR` env)、`application/gbrain/grok-wiring.ts`(grok,TOML 行编辑)是两块已验证的 wire backend。
- `application/diagnostics/doctor.ts` `checkGBrain`(doctor.ts:593)已按 capabilities.mcp_config 泛化:遍历所有 native-MCP + 声明 mcp_config 的 harness,读机器配置判 GBRAIN_SKILLS_DIR 是否指向工作台,缺口报 info。补齐三端 mcp_config 后自动覆盖。

**目标**:五端(claude/grok/opencode/cursor/pi)经同一对命令 `harness init`/`harness wire` 接线;capabilities.yaml 是 wire 目标单一事实源;`gbrain wire` 保留为 claude 别名。

## 2. 边界与契约

### 2.1 命令面(用户面对称,issue 建议形态)

```bash
jspace harness init  --harness <claude|grok|opencode|cursor|pi> --dir . [--dry-run]
# 工作台内:确保该端 seed/skill 投影存在(init/upgrade 已物化则 no-op)
jspace harness wire  --harness <claude|grok|opencode|cursor|pi> --dir . [--dry-run]
# 机器级:幂等写该端 gbrain MCP 配置 + skills 接线,打印能力边界
jspace gbrain wire   # 保留,等价 harness wire --harness claude(别名,向后兼容)
```

- `--harness` 校验:五端枚举(claude/grok/opencode/cursor/pi)。未知值 loud fail;`codex` 明确报「cron 兼容条目,非会话 harness,不支持 wire」。
- `--dir`:workbench root(现有 `features: { dir: true }` 语义)。

### 2.2 分派层契约

新建 `application/harness/wire.ts`(统一 wire 分派 + 新三端 backend),保留 `application/gbrain/{wiring,grok-wiring}.ts` 原样(claude/grok 已有测试,不重写):

```ts
export interface HarnessWireDeps {
  readFile: (p: string) => string | null;
  writeFile: (p: string, content: string) => void;
  backup: (p: string) => string | null;      // null when skipped
  homedir: () => string;
  resolveWorkbenchSkillsDir: (root: string) => string;  // <root>/.jspace/skills
  ensureResolverFile: (dir: string) => boolean;         // RESOLVER.md gate
  resolveGbrainBin: () => string | null;                // <gbrain> 解析(见 §2.4)
  dryRun?: boolean;
}

export type WireOutcome =
  | { ok: true; status: "wired" | "already-wired"; skillsDir?: string }
  | { ok: false; status: "missing-config" | "invalid-config" | "no-gbrain-bin"; reason: string };

export interface WireBackend {
  name: string;
  /** 幂等写该端 gbrain MCP 配置;返回变更状态。 */
  wire(deps: HarnessWireDeps, root: string): WireOutcome;
  /** 能力边界行(headless / hooks / session-end / cron 是否可用)。 */
  describe(cap: HarnessCapability): string[];
}
```

每端一个 backend 函数,`capabilities.mcp_config` 提供路径/格式/server_key 单一来源(不再硬编码路径)。

### 2.3 各端 wire 语义(差异表)

| 端 | 配置文件 | 结构 | gbrain server 不存在时 | 写入内容 |
|---|---|---|---|---|
| claude | `~/.claude.json` | `mcpServers.gbrain` | **不创建**(报 no-gbrain-server,引导 `claude mcp add`)— 向后兼容 | env `GBRAIN_SKILLS_DIR` |
| grok | `~/.grok/config.toml` | `[mcp_servers.gbrain]` | **不创建**(同上)— 向后兼容 | env `GBRAIN_SKILLS_DIR` |
| cursor | `~/.cursor/mcp.json` | `mcpServers.gbrain` | **创建/合并**(mcp.json 本就是 MCP 清单) | `command`=gbrain 路径,`args`=`["serve"]`,env `GBRAIN_SKILLS_DIR`;文件缺失时创建 `~/.cursor/mcp.json` |
| opencode | `~/.config/opencode/opencode.jsonc`(macOS/Linux;实现时本地实证确认,备选项目级 `opencode.jsonc`) | `mcp.gbrain`(context7 已确认:`{ type: "local", command: ["<gbrain>", "serve"], enabled: true, environment: {...} }`) | **创建/合并** | gbrain server + `environment.GBRAIN_SKILLS_DIR` |
| pi | `~/.pi/agent/mcp.json`(harness-pi.md 最高存在优先级,取第一个存在的) | `mcpServers.gbrain` | **创建/合并** | `command`=gbrain 路径,`args`=`["serve"]`,env `GBRAIN_SKILLS_DIR` |

语义统一为「**确保该端有可用 gbrain MCP server,且其 env 的 GBRAIN_SKILLS_DIR 指向工作台 `.jspace/skills`**」。claude/grok 沿用「不创建 server」保守规则(避免动用户已配置的 claude.json/grok 配置);新三端因目标文件本就是 MCP 清单,创建/合并是合理默认。

`mcp_config.path` 中 `~` 需展开(homedir)。Windows 路径差异在实现时用 `expandTilde` + `process.platform` 处理。

### 2.4 gbrain 二进制解析(新)

新增 `resolveGbrainBin()`(放在 `application/harness/wire.ts` 或 `application/gbrain/`):按 harnesses.md 文档规则:
- `$GBRAIN_BIN` 优先;
- 其次 `command -v gbrain`(Windows `where gbrain`)——同步调用,失败返回 null;
- 兜底 `~/.bun/bin/gbrain`(Windows `%USERPROFILE%\.bun\bin\gbrain.exe`)。
返回 null 时 cursor/pi wire 报 `no-gbrain-bin`(提示按文档设置 GBRAIN_BIN),不猜路径。

### 2.5 Cursor skills 薄链

- 目标:`~/.cursor/skills/<name>` symlink → `~/.agents/skills/<name>`(`jspace skills install` 的产物,多 harness 统一位置;与 issue「与 skills install 对齐」一致)。
- 薄链集合:SKILLS_MANIFEST.workbench 的官方 skill 名。
- 前置:若 `~/.agents/skills/<name>` 缺失,wire cursor 提示先跑 `jspace skills install`(不自动装——供应链纪律),或自动调用 installSkills(复用现有实现)。**设计决策:dry-run 打印;真实 wire 时若目标缺失则提示并跳过该链,不隐式装第三方包**(skills install 是官方包,可自动调用——待 implement 阶段定,倾向自动调用以达「一条命令闭环」)。
- 已存在且指向正确 → already-wired;已存在但指向别处 → 不覆盖,报 info 提示手动处理。
- Windows:symlink 需开发者模式,失败则降级为物化 copy + 提示。
- 薄链动作**只在 cursor wire**执行(其他端 skills 走各自已物化投影或 ~/.agents/skills)。

### 2.6 `harness init` 语义

- 读 capabilities.yaml 该端的 `workbench_projection`(+ 共享 `shared_workbench_projection`),对缺失的投影文件做物化(复用现有 manifest 投影逻辑);已物化则 no-op。
- 实际工作台内 seed 已由 `jspace init`/`upgrade` 全量落下,init 的价值 = **单端按需 + 命令形态对称 + 文档引导**(issue 要求)。dry-run 打印将确保的投影。
- 实现位置:`cli/commands/harness.ts` 新增 `init` 子命令,handler 调现有 manifest 投影能力(按端过滤)。

### 2.7 doctor 缺口检查

- `checkGBrain`:补三端 mcp_config 后自动覆盖(无需新代码);保持 info 级、不 crash、不可读配置跳过。
- 新增:Cursor skills 薄链缺口检查(对 `~/.cursor/skills/` 无官方 skill 薄链报 info)。放在 doctor harness 相关检查区。
- 不引入「当前会话端」区分(保持对所有声明端检查,避免复杂度);issue 的「Cursor 作为当前会话端时报缺口」由现有 info 输出覆盖。

## 3. 数据流

```
harness wire --harness cursor --dir . --dry-run
  → cli/commands/harness.ts validate(五端枚举)
  → application/harness/wire.ts dispatch(cursor backend)
  → capabilities.mcp_config → ~/.cursor/mcp.json
  → readFile → 解析 → gbrain server 定位/创建 → GBRAIN_SKILLS_DIR merge
  → resolveGbrainBin → command 字段
  → dry-run:返回将写的路径+内容;真实:backup → writeFile → ensureResolverFile
  → describe(cap) 能力边界行 + 输出
```

## 4. 兼容性

- `gbrain wire` 保留:实现保持调用 `wireHandler`(claude),文档标注「等价 `harness wire --harness claude`」;不删除不改名。
- `harness wire --harness grok` 行为不变(TOML 行编辑、idempotent、已-wired 报告)。
- claude/grok 的「不创建 server」语义不变(向后兼容,避免改坏用户已配置环境)。
- capabilities.yaml 增字段不改现有字段语义;`check-harness-consistency`(P5)同步。
- codex 条目不动(`documented: false`,cron 兼容);wire 显式拒绝。

## 5. 权衡(Tradeoffs)

- **新三端「创建 server」vs claude/grok「不创建」不对称**:为向后兼容 + cursor/opencode/pi 目标文件本就是 MCP 清单。不对称写入命令输出中说明。
- **统一抽象 vs 每端独立 backend**:选「每端 backend + capabilities 驱动路径」,不强制统一 merge 引擎——json/toml/command 三格式差异大,统一引擎反而引入抽象泄漏。claude/grok 现有实现复用,不重写。
- **cursor skills 薄链(symlink)vs 物化**:issue 明确要薄链(与 skills install 对齐)。Windows 降级物化。
- **doctor 全端检查 vs 仅当前会话端**:选全端 info(现状语义,零新复杂度);若噪音大可后续加 --harness 过滤,本期不做。
- **本期不做**:opencode 真实会话验证(best_effort 边界维持现状)、Cursor mcpc 检测、pi-mcp-adapter 安装自动化。

## 6. Rollout / Rollback

**Rollout**(分阶段,每阶段独立可验证):
1. capabilities.yaml 补 cursor/opencode/pi `mcp_config` + types 注释 → gen-assets 重生成 → P5 检查绿。
2. `application/harness/wire.ts` 分派层 + 新三端 backend(纯函数,注入 deps)+ 单测。
3. `cli/commands/harness.ts` 加 `init` 子命令、`wire` 五端分派、`--harness` 校验枚举化。
4. `cli/commands/gbrain.ts` 文档标注别名(实现不动)。
5. doctor cursor skills 薄链检查 + 测试。
6. 文档(harnesses.md / harness-{cursor,opencode,pi}.md / jspace-use §2 第 4 步)。
7. 全量:tsc + bun test + check-harness-consistency + manifest 完整性。
8. 真机验证(本机 macOS):cursor wire → `~/.cursor/mcp.json` 内容断言 → `jspace doctor`。

**Rollback**:每端 backend 独立、命令独立;新增代码不影响现有 `gbrain wire`/`harness wire --harness grok`;出问题只回滚对应阶段 commit。机器配置写入前都有 `.jspace-bak-*` backup,可手动还原。

## 7. 未决(implement 阶段确认)

- **已定**:opencode 全局配置 = `~/.config/opencode/opencode.json`(本机 1.18.13 实证,JSON 无注释,含 `mcp` 段)。注意该文件含真实 provider apiKey——wire 必须 merge 保字段,绝不整文件重写,测试用注入 deps 不落盘。
- **已定**:opencode MCP server 形状与 claude 不同:`{ type: "local", command: ["<gbrain>", "serve"], enabled: true, environment: {...} }`——`command` 是数组(非 command+args)、env 字段名是 `environment`(非 `env`)。capabilities.yaml 的 `mcp_config` 需加可选 `env_key`(缺省 "env")。doctor 的 json 分支需按 `server_key` 做点号路径定位(现写死顶层 `mcpServers.gbrain`)并支持 `env_key`,否则 opencode 已 wire 也误报 unwired。
- cursor wire 是否自动调用 `skills install` 确保 `~/.agents/skills/<name>` 存在,还是仅提示——倾向自动(官方包,一条命令闭环)。
- Windows 降级策略的测试覆盖(本机无 Windows,单测覆盖路径计算,不覆盖 symlink 实做)。
