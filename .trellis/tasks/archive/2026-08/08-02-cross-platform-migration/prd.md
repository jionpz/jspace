# JSpace 全链三平台迁移: CLI 迁 bun+TS + GitHub CI 发布

## Goal

把 JSpace 工作台从"仅 POSIX 友好"改为 **Windows + macOS + Linux 三平台一等公民**:

1. `bin/jspace` CLI 从 Python 迁移到 **bun + TypeScript**,用 `bun build --compile` 产出**免运行时依赖**的三平台二进制。
2. **gbrain 二进制解析 + harness MCP 接线路径**按各平台 home/可执行机制解析。
3. **bootstrap skill**(工具安装命令、references 路径/命令、占位符)补齐 Windows 变体。
4. 仓库推送到 **GitHub**,用 Actions 三平台 × 双架构矩阵构建发布产物。

## Background / Decisions (已与 owner 确认)

- 语言方案:**迁到 bun+TS**(owner 拍板)。理由:Windows 无预装 python3 + shebang/exec-bit 模型是 POSIX 专属;`bun build --compile` 产免运行时单文件二进制,顺带化解"CLI 是修复控制平面不应依赖 bun"的反对(编译产物不依赖 bun,仅构建期需要)。
- 范围:**全链三平台**(CLI + gbrain 接线 + bootstrap skill),不只是 CLI。
- 发布:**上 GitHub CI**(仓库当前无 remote,需先建 GitHub 仓库并推送)。
- 行为一致性:迁移后 CLI 命令面与行为必须与现 Python 版一致(`init`/`doctor`/`domain`/`resource`),不引入破坏性变更。
- 治理红线:全局 CLAUDE.md 禁止未经审查的 `curl | bash`;bootstrap 现有 `curl -fsSL https://bun.sh/install | bash`(bun 安装)需一并改为平台规范方式(win 用官方 PowerShell、POSIX 用官方脚本,且需标注审查)。

## Requirements

### R1 — CLI 迁移(bun+TS),对应子任务 cli-bun-ts
- R1.1 `bin/jspace` 全部命令重写为 TS:命令面、参数、输出格式(含 `jspace: error:`/`jspace: warning:` 前缀)、退出码与现 Python 版逐项一致。
- R1.2 不引入运行时第三方依赖;依赖面与现 CLI 对齐(现为零依赖 stdlib)。参数解析可用 stdlib/内置(bun 原生 `process.argv` 或自带解析),**不强制 commander**。
- R1.3 跨平台文件操作正确:路径统一 `node:path`/`path.posix` 语义;`shutil.copytree` → `fs.cpSync`;`__DEV_ROOT__` 占位符替换逻辑不变。
- R1.4 `bun build --compile` 可产出当前平台单文件二进制(dev 验证),命名带平台标识(如 `jspace-darwin-arm64`)。
- R1.5 迁移不改变 registry schema 校验规则(`validate_hub` 全部检查项逐一保留)。

### R2 — gbrain + harness 接线跨平台,对应子任务 gbrain-harness-wiring
- R2.1 gbrain 二进制解析顺序 `$GBRAIN_BIN` → `which`/`where` → `~/.bun/bin/gbrain` 在 Windows 用 `where` 与 `.exe` 后缀。
- R2.2 Claude Code/Codex/Cursor 的 MCP 配置路径按各 OS 用户 home 解析(Windows: `%USERPROFILE%`;macOS/Linux: `$HOME`),stdio MCP 命令在 Windows 必须是可执行形态(bun global shim 或显式 exe 路径)。
- R2.3 保留 SessionStart 注入 + 工作结束写回两条链路,三平台一致。

### R3 — bootstrap skill 跨平台,对应子任务 bootstrap-skill
- R3.1 Phase 0 工具安装命令分平台:python3(win: winget/官方安装器)、bun(win: PowerShell 官方脚本)、git(win: winget)。
- R3.2 `references/harnesses.md`、`references/gbrain.md`、`references/registry.md` 中 POSIX 专属路径/命令补 Windows 变体并标注平台。
- R3.3 `jspace-bootstrap/SKILL.md` 的分阶段校验命令在 Windows 上可执行(含 `jspace doctor`、`jq`(win 无预装,需给替代或说明)、`find`/`sort` 的跨平台替代)。

### R4 — GitHub CI 发布,对应子任务 github-ci-release
- R4.1 仓库建 GitHub remote 并推送(推送前经 owner 确认,符合红线)。
- R4.2 Actions workflow:三平台(ubuntu / macos / windows)× 双架构(尽量覆盖 arm64,含 macos arm64 runner)构建矩阵,`bun build --compile` 出产物并上传 release。
- R4.3 构建产物命名规范、release 触发方式(打 tag / 手动)在 CI 内文档化。

## Cross-child Acceptance Criteria(父任务级验收)

- [ ] 三平台(win/mac/linux)上 `jspace init`、`doctor`、`domain`、`resource` 全部命令行为与现 Python 版一致(输出/退出码/文件产物),有跨平台 smoke 证据。
- [ ] 三平台下 gbrain MCP 接线可拉起、SessionStart 检索注入生效(至少 CLI 层验证 `gbrain serve` 可达)。
- [ ] 三平台按 `jspace-bootstrap/SKILL.md` 可从零走到 Phase 4 收尾(工具安装、gbrain、registry、harness wiring、smoke)。
- [ ] GitHub Actions 三平台矩阵构建通过并产出带平台标识的二进制 artifact。
- [ ] 无破坏性变更:现 workbench 的 `hub.json`(version 3)由新 CLI `doctor` 校验结果与旧 CLI 一致。
- [ ] 治理红线:无未经审查的 `curl|bash` 残留在新 bootstrap 路径;所有外部安装命令来源被核验并记录。

## Task Map

| 子任务 | 交付物 | 依赖顺序 |
|---|---|---|
| `cli-bun-ts` | TS CLI + 本地 compile 产物 | 先行 |
| `gbrain-harness-wiring` | 跨平台二进制解析 + harness 接线 | 依赖 cli-bun-ts 的路径解析约定,可并行 |
| `bootstrap-skill` | skill 文档 + 命令跨平台化 | 依赖 cli-bun-ts 的 CLI 形态,可并行 |
| `github-ci-release` | GitHub repo + Actions 矩阵 | 依赖 cli-bun-ts(产物存在),最后 |

## Constraints

- 不破坏现 workbench 的 `hub.json` v3 schema;registry 校验规则是行为契约。
- CLI 保持零运行时第三方依赖哲学(编译产物层面无依赖;开发/构建期用 bun)。
- 现 `.trellis/` Python 工具链**不在本次迁移范围**(保留 Python,只迁移 `bin/jspace`)。
- 上 GitHub 属外部可见动作,推送/建仓前须经 owner 明确确认。

## Notes

- 需要研究确认的跨平台事实(Windows bun global shim 形态、各 harness config 的 Windows 路径、bun compile 是否支持交叉编译、GH Actions macos arm64 runner 可用性等)由 research 子代理产出并持久化到 `research/`。
- 子任务排序是执行顺序不是依赖系统:顺序写入各子任务文档。
