# GitHub Actions 三平台构建发布矩阵

## Goal

把 JSpace dev 仓库推送到 **GitHub**,搭建 Actions 三平台(Windows/macOS/Linux)× 双架构矩阵,用 `bun build --compile` 产出命名规范的平台二进制并上传 release 产物。**父任务:08-02-cross-platform-migration**。

## Background / Decisions

- 发布方式:上 GitHub CI(owner 拍板)。仓库当前无 git remote,需先建仓并推送。
- **推送/建仓是外部可见动作**,执行前须再次经 owner 明确确认(治理红线:未经确认不推送)。
- 构建产物由 `cli-bun-ts` 的 build 脚本提供;矩阵即参数化调用该脚本。

## Requirements

- R4.1 建 GitHub 仓库(仓库名/可见性经 owner 确认)并设为 remote、推送 main。
- R4.2 Actions workflow(`.github/workflows/build.yml`)三平台矩阵:ubuntu / macos / windows 的 runner 标签按可用架构选(含 arm64 覆盖,具体标签以研究结论为准,如 macos arm64 runner、windows arm64 可用性);每格跑 `bun install` + `bun build --compile` 产出本平台二进制。
- R4.3 产物命名规范,含平台 + 架构标识(如 `jspace-linux-x64`、`jspace-macos-arm64`、`jspace-windows-x64.exe`),跨平台统一。
- R4.4 release 触发与上传:推荐实践(softprops/action-gh-release 或 `gh release upload`);触发方式(打 tag / 手动 workflow_dispatch)文档化。
- R4.5 矩阵内包含基础冒烟:`jspace --version`、对模板 `jspace doctor`(或等价),防止"编译过但跑不了"。
- R4.6 仓库卫生:`.gitignore` 排除构建产物/缓存;无密钥进仓库。

## Acceptance Criteria

- [ ] GitHub 仓库建立、remote 配置、main 推送完成(经确认后)。
- [ ] Actions 三平台矩阵构建通过,artifact 命名含平台+架构。
- [ ] 至少 release(或 artifact 上传)有一条可用链路,触发方式文档化。
- [ ] 矩阵冒烟通过(`--version`/`doctor`)。
- [ ] 无密钥/构建产物提交。

## Constraints

- 推送/建仓前经 owner 确认。
- 矩阵 runner 标签以官方可用性为准(研究结论持久化到父任务 `research/harness-ci-facts.md`),不支持 arm64 的平台如实降级为 x64 并注明。
- 本子任务最后执行(依赖 cli-bun-ts 产物)。

## Ordering / Dependencies

- 依赖 `cli-bun-ts`(build 脚本与产物命名)与 `bootstrap-skill`/`gbrain-harness-wiring` 的跨平台事实。
- 在本地 CLI 迁移验收通过后执行。

## Notes

- 参考:父任务 `research/harness-ci-facts.md`(待产出)。
