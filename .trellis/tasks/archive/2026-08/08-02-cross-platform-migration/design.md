# JSpace 全链三平台迁移 — 技术设计

**父任务**:08-02-cross-platform-migration
**状态**:planning(研究进行中,平台事实段待 research/ 返回后定稿)

## 1. 目标与边界

把 JSpace 从"POSIX 友好"升级为 Windows/macOS/Linux 三平台一等公民。四个交付物(子任务):TS CLI、gbrain+harness 接线、bootstrap skill、GitHub CI。

**不在范围**:`.trellis/` Python 工具链、gbrain 本体、hub.json v3 schema。

## 2. 总体架构

```
┌─ 编译产物层: jspace 单文件二进制(bun build --compile,免运行时依赖)
│     ├─ 命令: init / doctor / domain / resource / --version
│     ├─ 内嵌资产: templates/workbench + skills/(构建期生成模块)
│     └─ 路径: source 模式=仓库根;compiled 模式=dirname(execPath)
├─ 接线事实层: gbrain 二进制解析 + harness MCP 配置路径(三平台分列)
├─ 引导层:     jspace-bootstrap skill(Phase 0-4,三平台命令对照)
└─ 发布层:     GitHub Actions 三平台×双架构矩阵 → release 产物
```

**单一事实源原则**:CLI 是路径/解析逻辑的唯一实现者;接线与 bootstrap 文档引用 CLI 的解析约定,不各自发明。registry 校验规则是行为契约,迁移不改语义。

## 3. 核心决策(已用实测/研究支撑)

### D1 CLI 语言与运行时 → bun + TS,零运行时第三方依赖
- 依据:父任务 PRD Background + 实测 `bun build --compile` 可用。
- 参数解析:**手写最小解析器**(命令面小:init/doctor/domain/resource,子命令固定),不引入 commander。若研究结论倾向 commander,记录决策后采用。

### D2 自包含二进制 → 构建期生成资产模块
- 实测:`import.meta.glob` 在 bun 下不可用;`import.meta.dir` 编译模式指向 `/$bunfs/` 虚拟 FS。
- 方案:`scripts/gen-assets.ts` 遍历 `templates/workbench` + `skills/{jspace-bootstrap,asset-ingest}`,生成 `cli/assets.generated.ts`(`Record<string,string>`,约 76K 文本),CLI 静态 import → 打进单文件。见 `research/empirical-bun-probe.md`。
- 代价:改模板/技能需重新生成再编译。收益:单代码路径、二进制自包含、拷贝不丢文件。

### D3 编译模式检测与安装目录
- 检测:`process.argv[1]?.startsWith('/$bunfs/')`(bun 虚拟 FS 标记;Windows 一致性列为 CI 验证项)。
- 安装目录:compiled → `dirname(process.execPath)`;source → 仓库根(由 import.meta.dir 推导)。
- 模板物化:从 ASSETS 写盘,等价 `shutil.copytree(dirs_exist_ok)` → `fs.cpSync`/自写遍历。

### D4 `__DEV_ROOT__` 占位符语义(✅ 已确认:改为 `jspace` 命令)
- 现状:模板/skill 共 14 处引用 `__DEV_ROOT__/bin/jspace doctor`。
- **决策(owner 确认 2026-08-02)**:workbench 统一改为 PATH 上的 `jspace` 命令;`__DEV_ROOT__` 仍物化(source=dev 仓库根;compiled=二进制所在目录)。模板 AGENTS.md/README 与 bootstrap skill 的引用改 `jspace`;保留"旧源码检出仍用 `__DEV_ROOT__/bin/jspace`"兼容说明。
- 影响:改变新生成 workbench 的文档引用(非机器契约);现有 workbench 的 `doctor` 校验不受影响。
- 落地:cli-bun-ts(占位符物化值)+ bootstrap-skill(引用改写)同步。

### D5 跨平台文件/路径 API 映射(零依赖)
| Python | TS/bun |
|---|---|
| `Path(__file__).resolve().parent.parent` | `process.argv[1]` + `/$bunfs/` 检测 + `dirname(execPath)`/`import.meta.dir` |
| `shutil.copytree(dirs_exist_ok=True)` | ASSETS 遍历 + `fs.mkdirSync/writeFileSync`(或 `fs.cpSync`) |
| `shutil.rmtree` | `fs.rmSync(dir,{recursive:true,force:true})` |
| `pathlib.Path.is_absolute/resolve/relative_to` | `node:path` `isAbsolute/resolve/relative` |
| `json.dumps(indent=2, ensure_ascii=False)` | `JSON.stringify(x,null,2)`(unicode 默认保留) |
| `sys.exit(1)` + stderr | `process.exitCode=1` + `console.error` |
| 文件遍历 + 替换占位符 | `fs.readdirSync` 递归 + `replaceAll` |

### D6 registry 校验规则为行为契约
`validate_hub` 全部检查项(version=3、id 命名 `[a-z0-9][a-z0-9-]*`、path 越界守卫 `_is_within`、README/domain.json 存在、entrypoint kind/value/primary、全局唯一)逐一搬到 TS,错误文案一致。验收用同一份 hub.json 对拍新旧 CLI。

## 4. 子任务设计要点

### 4.1 cli-bun-ts(TS CLI)
- 目录:`cli/main.ts` + `cli/registry.ts` + `cli/init.ts` + `cli/assets.generated.ts`(生成)+ `scripts/gen-assets.ts` + `tsconfig.json` + dev-only `package.json`。
- build:`bun run scripts/gen-assets.ts && bun build --compile cli/main.ts --minify --outfile <jspace-<os>-<arch>>`;build 脚本参数化平台/架构(供 CI 复用)。
- 源码形态仍保留 `bin/jspace` 兼容?建议:删除 Python 版,`bin/` 由 build 产出二进制(POSIX 放 `bin/jspace`,Windows `bin/jspace.exe`)。实施时确认是否保留过渡入口。

### 4.2 gbrain-harness-wiring
- 平台事实表(已定稿,`research/harness-ci-facts.md`):Claude Code `~/.claude.json`(win `%USERPROFILE%\.claude.json`,原生支持)、Codex `~/.codex/config.toml`(win 支持,⏳ 路径)、Cursor `~/.cursor/mcp.json`(win `%USERPROFILE%\.cursor\mcp.json`)。
- Windows stdio MCP `command` 用**可执行文件全路径**(如 `%USERPROFILE%\.bun\bin\gbrain.exe`);默认 shell 是 PowerShell。
- 解析顺序:`$GBRAIN_BIN` → `where`(win)/`which`(posix) → `~/.bun/bin/gbrain[.exe]`。
- 产出:harness-config + jspace-bootstrap 两处 `references/harnesses.md` 补三平台列;`~/.agents/agents.md` 同步。

### 4.3 bootstrap-skill
- Phase 0 三平台安装命令表;Phase 4 smoke 的 `jq`/`find`/`sort` Windows 替代(PowerShell/python 方案,研究给出)。
- bun 安装改平台规范方式,核验来源(治理红线)。
- `__DEV_ROOT__/bin/jspace` 引用改为 D4 结论。

### 4.4 github-ci-release
- `.github/workflows/build.yml`:三平台矩阵(研究给出 runner 标签与 arm64 可用性)。**推荐每格原生 runner 构建+冒烟**(`bun install && gen-assets && bun build --compile --target=bun-<os>-<arch>` + 冒烟 `--version`/`doctor` + 上传 release 产物);交叉编译作备用/单 runner 集中构建选项(实测可行,但交叉产物无法在构建机冒烟)。
- 命名:`jspace-<os>-<arch>[.exe]`。触发:tag push + workflow_dispatch。
- **推送/建仓前经 owner 确认**(红线)。

## 5. 风险与决策点

| # | 风险/决策 | 缓解 | 状态 |
|---|---|---|---|
| R1 | ~~交叉编译不支持~~ → **交叉编译可用**(实测),但冒烟必须原生 | 交叉编译用于集中构建/本地出全平台产物;CI 每平台原生 runner 构建+冒烟 | 已实测定稿(见 research) |
| R2 | `__DEV_ROOT__` 语义变化影响文档引用 | D4 决策,实施评审确认 | 待确认 |
| R3 | Windows 下 bun global shim / MCP command 形态 | 接线文档补三平台列;`command` 用全路径;shim 形态在 CI windows runner 验证 | 已定稿(harn-ci-facts) |
| R4 | 行为一致性回归 | 新旧 CLI 对拍用例清单(init/doctor/domain/resource) | 规划 |
| R5 | 治理红线:未审查 curl|bash | bun 安装改官方规范方式并核验来源 | 规划 |
| R6 | Windows 上 `/$bunfs/` 检测假设 | CI 加断言验证 | 待验证 |
| R7 | 编译二进制 ~95MB(bun 运行时自包含) | 如实记录;CI 上传/release 按 ~100MB/产物规划;若嫌重,后续可研究 `--minify`/strip 或放弃自包含改源码分发 | 已实测 |

## 6. 兼容性与回滚

- 兼容:新 CLI 对现有 workbench 的 hub.json(v3)校验一致;模板产物向后兼容旧语义(除 D4 文档引用调整)。
- 回滚:TS CLI 迁移期间保留旧 Python `bin/jspace`(git 历史可取回);设计保证单文件交付,回滚=切回 Python 版。
- 发布前在本地对拍:同 hub.json 新旧 `doctor` 输出 diff。

## 7. 待研究输入(父任务 research/)

- `research/empirical-bun-probe.md`(已定稿,本设计 D2/D3 依据)
- `research/cli-bun-ts.md`(bun 官方文档;进行中)
- `research/harness-ci-facts.md`(harness 路径/Windows 支持/CI runner 标签;jq/find/sort 替代;进行中)
