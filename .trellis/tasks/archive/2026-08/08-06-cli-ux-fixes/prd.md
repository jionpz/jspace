# CLI 三处体验修复：版本串精度 / doctor 噪音 / init 接口

## Goal

修复 JSpace CLI 三处开发体验问题（2026-08-06 排查确认仍存在）：

1. **版本串精度**：`--version` 无法区分 tag 点与领先提交，同一版本号可能是不同行为。
2. **doctor 警告噪音**：新工作台 init 完第一次 doctor 就有 4 条 warning（3 cron 未安装 + filehub 未注册），其中 cron 未安装是默认状态而非异常。
3. **init 接口不一致**：init 用位置参数（`jspace init /path`），其余命令全用 `--dir`，新用户第一课就会敲错。

## Requirements

### R1 版本串精度（子任务 version-string-precision）

- `jspace --version` 必须能区分「恰好等于 tag」与「领先 tag 若干提交」的构建。
- dev / 本地 / CI 非 tag 构建显示带 commit 信息的版本串（如 `1.0.9-2-g7cef2bc`）。
- 发布构建（tag）保持干净版本串 `1.0.9`，不受改动影响。
- 现有二进制与源码漂移问题（bin/ 未跟踪、未重建导致 --version 落后）不在本任务修复范围——那是重建流程问题，不是版本串编码问题。
- `jspace update` 的版本比较逻辑必须继续兼容带后缀版本串（`compareVersions` 按 `.+-` 分割取前 3 段，已验证兼容）；dev 领先提交的本地构建不被 update 降级/覆盖。

### R2 doctor 噪音（子任务 doctor-cron-noise）

- 模板 `templates/workbench/.jspace/cron.json` 三个预设 cron（inbox-tidy / weekly-report / memory-consolidate）默认 `enabled: false`，由用户显式启用。
- doctor 对「enabled 但未安装」的 cron 保持 warning（用户显式启用却未安装 = 意图未兑现，仍属问题）。
- `filehub.unregistered`（未注册 filehub 资源）从 warning 降为 info：未注册是可选资源未配置、asset-ingest 走设计好的降级 staging 路径，不是健康问题。
- Severity 类型从 `"error" | "warning"` 扩展为含 `"info"`。
- 新工作台 init 完成后 doctor 的 warning 数归零（无 cron 报错、无 filehub warning、无其他结构性 warning）。
- info 诊断不触发 exit 1、不计入 warning 汇总，但出现在 `--json` 输出的 diagnostics 里。

### R3 init 接口（子任务 init-dir-flag）

- `jspace init --dir <path>` 可用，与其余命令的 `--dir` 约定一致。
- 位置参数 `jspace init <path>` 保留兼容（旧脚本不破坏）。
- 同时给出 `--dir` 与位置参数时报 ambiguous 错误（对齐框架现有冲突 pattern，exit 2）。
- 帮助文本正确展示 `--dir` 选项。

## Task Map

| 子任务 | 交付物 | 独立验证 |
|---|---|---|
| 08-06-version-string-precision | gen-version.ts 版本串含 commit 信息；CI 发布保持干净 | `bun run scripts/gen-version.ts` 产物含 `-N-gHASH`；tag 构建仍为干净 tag |
| 08-06-doctor-cron-noise | 模板 cron enabled:false；filehub 降 info；Severity 扩展 | init 新工作台 doctor 0 warning；filehub 诊断 severity=info |
| 08-06-init-dir-flag | init 支持 --dir + 位置参数 + 冲突报错 | `init --dir X` 成功；`init --dir X target` exit 2 |

## Acceptance Criteria（跨子验收，父任务集成审查）

- [ ] `bun run scripts/gen-version.ts` 后 `cli/version.generated.ts` 含 `-N-gHASH` 后缀（非 tag HEAD）；tag HEAD 时为干净 tag。
- [ ] tag 发布路径（CI `JSPACE_BUILD_VERSION` 覆盖）产物版本串保持干净。
- [ ] `jspace init <fresh-dir>` 完成后 `jspace doctor --dir <dir>` 输出 0 warning。
- [ ] `jspace doctor --dir <dir> --json` 的 diagnostics 含 `filehub.unregistered` 且 severity=info。
- [ ] 用户显式启用 cron 但未安装时，doctor 仍报 `cron.not_installed` warning。
- [ ] `jspace init --dir <dir>` 成功初始化；`jspace init --dir <dir> <other>` 报 ambiguous、exit 2。
- [ ] `jspace init <path>`（位置参数）仍然可用。
- [ ] `bun test` 全绿（含更新的 doctor.test.ts / init 相关测试）。
- [ ] `tsc` 类型检查通过。

## Notes

- 版本串改动与二进制漂移解耦：漂移的根治（build 入口已跑 gen-version.ts，package.json:14-17）在 1.0.9 前已完成，本任务只做版本串编码精度。
- doctor cron 方案为「模板 enabled:false + 保持 warning」双管齐下（用户 2026-08-06 决策），语义最严谨：未安装且未启用 = 正常；未安装但显式启用 = 问题。
- filehub 一并降 info（用户决策），与 cron 同类处理，让新工作台 doctor 归零。
- init 保留位置参数 + 冲突报错（用户决策），向后兼容优先。
- 仓库 PUBLIC（memory: jspace-no-real-data-examples）：示例/文档一律中性占位，不引入真实路径。
