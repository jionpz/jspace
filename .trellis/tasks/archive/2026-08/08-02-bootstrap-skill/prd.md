# bootstrap skill 跨平台化

## Goal

把 `skills/jspace-bootstrap` 从"仅 POSIX"改为 **Windows + macOS + Linux 可执行**:Phase 0 工具安装命令分平台;references 中 POSIX 专属路径/命令补 Windows 变体;分阶段校验命令在 Windows 可跑。**父任务:08-02-cross-platform-migration**。

## Background / Decisions

- 全链三平台(owner 拍板),范围含 bootstrap skill。
- 治理红线:全局 CLAUDE.md 禁止未经审查的 `curl | bash`。现 Phase 0 的 `curl -fsSL https://bun.sh/install | bash` 需改为平台规范安装(bun 官方 PowerShell `irm bun.sh/install.ps1 | iex` 与官方 bash 脚本,并核验来源/指纹),或标注为需审查步骤。
- `__DEV_ROOT__` 占位符在 Windows 写盘时是反斜杠路径,需确认跨平台替换/读取一致。

## Requirements

- R3.1 Phase 0 工具安装按平台分列:python3(win: winget / python.org 官方安装器;mac: brew/CLT;linux: apt/dnf)、bun(win: 官方 PowerShell;posix: 官方脚本)、git(win: winget)。每项给验证命令(`python3 --version` 等在 Windows 的等价)。
- R3.2 `references/harnesses.md`、`references/gbrain.md`、`references/registry.md` 的 POSIX 专属路径(如 `~/.bun/bin/gbrain`)、命令(`which`/`find`/`sort`/`jq`)补齐 Windows 变体并标注平台。
- R3.3 Phase 4 收尾 smoke 命令跨平台:`jq . hub.json`(Windows 无 jq → 给 `python -m json.tool` 或 PowerShell ConvertFrom-Json 替代)、`find workspace -maxdepth 2 -type f | sort`(Windows → `Get-ChildItem -Recurse -Depth` 等价)。
- R3.4 校验命令调用的 `__DEV_ROOT__/bin/jspace doctor --dir .` 在 Windows 用编译二进制路径(由 `cli-bun-ts` 定),文档给出二进制解析顺序。
- R3.5 每个跨平台命令给"平台 → 命令"对照表,不再假设默认 shell 是 bash。

## Acceptance Criteria

- [ ] Phase 0 安装命令三平台齐全,验证命令可执行。
- [ ] 三个 references 无裸 POSIX 假设;Windows 变体完整。
- [ ] Phase 4 smoke 在 Windows 有等价命令且已列明。
- [ ] bun 安装步骤已按治理红线核验来源(记录官方来源/校验方式),不再有未审查的 `curl|bash`。
- [ ] 文档在三平台视角通读无歧义(每步知道"我在哪个平台该敲什么")。

## Constraints

- 不改变 bootstrap 的**阶段与校验语义**(Phase 0-4 顺序、gbrain/registry 检查项),只做平台适配。
- 外部安装命令来源须核验并记录(治理红线)。

## Ordering / Dependencies

- 依赖 `cli-bun-ts` 定下的 CLI 二进制形态与路径。
- 依赖 `gbrain-harness-wiring` 的接线路径事实(本子任务引其 references 的跨平台版)。
- 可并行推进,验收时按上述依赖顺序复核。

## Notes

- 参考:父任务 `research/harness-ci-facts.md`(待产出)。
