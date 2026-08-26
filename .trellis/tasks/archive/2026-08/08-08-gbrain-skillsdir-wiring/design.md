# Design — gbrain skillsDir 接线

> 需求见 `prd.md`。动机与源码证据见 `prd.md` 背景节（gbrain `repo-root.ts:118` 的
> `autoDetectSkillsDir` 只认 `$GBRAIN_SKILLS_DIR` / 根 `skills/`，不认 `.jspace/skills/`）。

## 1. 问题形态

gbrain 的 skill resolver 需要 `GBRAIN_SKILLS_DIR` 环境变量指向 `.jspace/skills`。
`gbrain serve`（MCP 常驻）没有 flag，只靠启动时环境变量。当前 `~/.claude.json` 的
gbrain server 无 env 字段 → serve 以无 `GBRAIN_SKILLS_DIR` 启动 → resolver 走
cwd 向上找根 `skills/`（或回退安装路径）。

**关键 gate（实测确证）**：`repo-root.ts:126` 的 env 分支要求 `hasResolverFile(explicit)` ——
`GBRAIN_SKILLS_DIR` 指向的目录**必须有 `RESOLVER.md` 或 `AGENTS.md`**，否则 env 被静默忽略。
`.jspace/skills/` 没有 resolver 文件，所以**只注 env 不够**。

**实测结论**：`.jspace/skills/` 放一个**空 `RESOLVER.md`** 即让 env 生效
（输出从 "walking up from cwd" 变为 "from $GBRAIN_SKILLS_DIR (explicit operator override)"），
且 gbrain 从 `.jspace/skills/*/SKILL.md` 的 frontmatter 读到官方 4 skill
（`loadSkillTriggerIndex` = frontmatter + resolver 并集，frontmatter 是 source of truth；
resolver 文件只需存在让 gate 通过，内容可为空/占位）。

**因此 wire 做两件事**：① 确保 `.jspace/skills/RESOLVER.md` 存在（幂等建空占位）；
② 注入 env。RESOLVER.md **不物化**（若走 `templates/workbench/.jspace/` 前缀会归 user
ownership 永不覆盖，且属 machine-managed 区域——由 wire 命令按需创建更干净）。

修法：`jspace gbrain wire` 写 `~/.claude.json` 的 `mcpServers.gbrain.env.GBRAIN_SKILLS_DIR`，
Claude Code 启动 serve 时注入该 env。**改后需重启 claude 会话**（MCP 重连，serve 以新 env 重启）。

## 2. 机器级配置的读/写

`~/.claude.json` 是 Claude Code 用户配置，**顶层含大量其它字段**（会话历史、permissions、projects…）。
必须整文件读、merge、整文件写回，**绝不重写**。

```
读：JSON.parse(readFileSync(claudeJsonPath))
写：writeFileSync(claudeJsonPath, JSON.stringify(doc, null, 2))   // 保留全部字段
备份：写前 cp 到 <claudeJsonPath>.jspace-bak-<timestamp>（破坏性操作可恢复）
```

`mcpServers.gbrain` 结构（现状）：`{command, args, type}`。
wire 后：`{command, args, type, env: { GBRAIN_SKILLS_DIR: "<wb>/.jspace/skills" }}`。
**merge 语义**：`env` 已存在则只设 `GBRAIN_SKILLS_DIR` 键，其它 env 键保留。

路径解析：`~` 展开用既有 `expandTilde`（`cli/embed.ts:42`）；Windows 用 `%USERPROFILE%\.claude.json`
（`os.homedir()` 在 Node/bun 跨平台返回用户主目录，`join(homedir(), ".claude.json")` 即可，
不硬编码 `%USERPROFILE%`——bun 的 `os.homedir()` 在 Windows 返回 `C:\Users\<you>`）。

## 3. 模块划分

### 3.1 纯逻辑 `application/gbrain/wiring.ts`（可单测）

```ts
export interface ClaudeJsonDeps {
  readJson: (p: string) => unknown | null;       // 读 ~/.claude.json，损坏返回 null
  writeJson: (p: string, doc: unknown) => void;
  homedir: () => string;
  backup: (p: string) => string | null;           // 备份，返回备份路径
  resolveWorkbenchSkillsDir: (root: string) => string; // join(root, ".jspace", "skills")
  /** Ensure `.jspace/skills/RESOLVER.md` exists (empty placeholder suffices for
   *  gbrain's hasResolverFile gate). Returns true if created, false if present. */
  ensureResolverFile: (skillsDir: string) => boolean;
}

export function claudeJsonPath(homedir: string): string;         // join(home, ".claude.json")
export function gbrainServer(doc: unknown): object | null;        // mcpServers?.gbrain
export function gbrainSkillsDirWired(server, wbSkillsDir): boolean; // env?.GBRAIN_SKILLS_DIR === wbSkillsDir
export function wireSkillsDir(deps, root): WireResult;             // ensure resolver + merge env + 写回
export function unwireSkillsDir?(deps): WireResult;                // 预留（本轮不做）
```

`wireSkillsDir` 行为：
1. `claudeJsonPath` 不存在 → 返回 `{ok:false, reason:"no-claude-json"}`（提示先 wire MCP）
2. 读 json 损坏 → `{ok:false, reason:"invalid-claude-json"}`
3. `mcpServers.gbrain` 不存在 → `{ok:false, reason:"no-gbrain-server"}`（提示 `claude mcp add`）
4. **先 `ensureResolverFile(skillsDir)`**（让 gate 通过；幂等）
5. 已配且值 == 当前 `.jspace/skills` → `{ok:true, status:"already-wired"}`
6. 否则：备份 → merge env → 写回 → `{ok:true, status:"wired"}`

### 3.2 CLI `cli/commands/gbrain.ts`

```ts
export const gbrainSpec: CommandSpec = {
  name: "gbrain",
  summary: "wire gbrain skill routing (GBRAIN_SKILLS_DIR → .jspace/skills)",
  features: { dir: true },
  options: [{ name: "--dry-run", ... }],
  children: [{ name: "wire", ... }],
};
```

- `--dry-run`：算 `wireSkillsDir` 但 `writeJson`/`backup` 换成 no-op（deps 注入 `dryRun`），
  返回将写的 env 值供展示，不落盘。
- handler 用 `expandTilde` + `os.homedir()`，读 `claudeJsonPath`。
- 注册进 `registry.ts` 的 `COMMANDS`。

### 3.3 doctor 诊断 `gbrain.skillsdir_unwired`

`doctorWorkbench(root, deps)` 的 `CronHealthDeps` 扩展（避免引入新依赖类型，沿用 deps 注入）：

```ts
// CronHealthDeps 增：
readUserClaudeJson?: () => unknown | null;   // 注入；cli 侧传真实读取
```

诊断逻辑（info 级）：
- 读 `~/.claude.json` → gbrain server env 的 `GBRAIN_SKILLS_DIR`
- 缺失 或 ≠ `join(root, ".jspace", "skills")` → 报 `gbrain.skillsdir_unwired`：
  message `gbrain resolver 未指向工作台官方 skill（.jspace/skills）；跑 jspace gbrain wire 接线`
- 已配且正确 → 不报（info 级不产生噪音）
- 读取失败（无 ~/.claude.json / 损坏）→ 不报（机器级缺失不算工作台健康问题；wire 命令会处理）

测试 stub：`readUserClaudeJson: () => null` 默认（干净台不报）；测试里注入带/不带 env 的 server。

## 4. 幂等与安全

| 场景 | 行为 |
|---|---|
| 重复 wire | `already-wired`，exit 0，不写 |
| gbrain server 不存在 | error + 提示 `claude mcp add --scope user`，exit 1 |
| ~/.claude.json 不存在 | error + 提示先配置 Claude Code，exit 1 |
| ~/.claude.json 损坏 | error + 提示修复，exit 1，不覆盖 |
| 写前 | 备份 `.jspace-bak-<ts>` |

## 5. 验证

- 单测：`wiring.ts`（已配/未配/无 server/损坏/backup）、`doctor` 诊断（注入 stub）
- 端到端：`jspace gbrain wire --dir <tmp wb>` → 读 `~/.claude.json` 验证 env；
  重复跑 → already-wired；`--dry-run` 不落盘
- gbrain 实测：`GBRAIN_SKILLS_DIR=<tmp wb>/.jspace/skills gbrain check-resolvable` → 4 skills reachable
- 注意：**真实 `~/.claude.json` 的 wire 测试必须 `--dry-run` 或改后回滚**（不污染用户机器级配置）
  —— 用副本验证写逻辑，真实环境只做 dry-run 检查

## 6. 影响面与回滚

- 新增命令族 `jspace gbrain wire`（无破坏既有命令）
- doctor 新增 info 诊断（不破坏 exit 语义）
- 文档：`gbrain.md` 接线节 + `example-first-use.md` 的 Phase 4 同步（MCP 接线处提 env）
- 回滚：`~/.claude.json` 备份 `.jspace-bak-<ts>` 恢复；代码走 git

## 7. 跨平台

- Windows `os.homedir()` 返回 `C:\Users\<you>`，`.claude.json` 路径自然正确
- 写入的 `GBRAIN_SKILLS_DIR` 值是工作台绝对路径；Windows 路径含反斜杠，JSON.stringify 会自动转义
  （与 `jsonEscape` 的既有处理一致——`cli/embed.ts:75`）
