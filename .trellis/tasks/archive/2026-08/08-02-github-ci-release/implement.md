# GitHub Actions 三平台构建发布矩阵 — 执行计划

**子任务**:08-02-github-ci-release | **父**:08-02-cross-platform-migration

## 顺序依赖
- 依赖 `cli-bun-ts`(build 脚本 + 产物命名)与父 research 的 runner/arch 事实。
- **最后执行**;启动前需 owner 确认"推 GitHub / 建仓"(红线:外部可见动作)。

## ⚠️ 阻塞 + 决定(2026-08-02)

- 仓库 `jionpz/jspace` 已建并推送 main(现为 **private**,owner 决定保持);`.github/workflows/build.yml`(6 格矩阵,x64 用 `-baseline`)已提交推送;测试 tag `v0.1.0-test` 已推送。
- **根因**:GitHub Actions job 注解报 **"The job was not started because your account is locked due to a billing issue."**——账号 `jionpz` 计费锁定,GitHub 拒绝分配托管 runner(改 public 亦无效;最小 `echo hello` workflow 的 `startup_failure` 同源)。
- **owner 决定**:CI 标记 **deferred**;本地分发为主(`bun run build:all` 一台 mac 出 6 平台产物,已实测);计费解除后可随时重开 CI(workflow 已就位,重 dispatch 即可)。
- **本地等效验证已通过**:6 格交叉编译产物格式正确(ELF/Mach-O/PE32+),macOS 原生 + Linux arm64 容器 + Linux x64(Rosetta, baseline)冒烟通过。
- **AVX 发现**:bun 默认 x64 产物需 AVX,无 AVX CPU `Illegal instruction` → x64 用 `-baseline` 目标(CI + build 脚本已更新)。

## 执行清单
- [x] 建 GitHub 仓库(jspace,现 private)、remote、推送 main。
- [x] `.github/workflows/build.yml`:3 OS × 2 arch 矩阵,每格 bun build --compile + 冒烟 + upload-artifact;release job(tag v* → softprops/action-gh-release);x64 `-baseline`。
- [x] 命名规范、触发(tag + workflow_dispatch)。
- [x] `build:all` 本地 6 平台交叉编译脚本(scripts/build-all.ts + package.json)。
- [x] 本地矩阵等效验证(见上)。
- [~] CI 矩阵跑绿 + release → **deferred**:账号计费锁定,本地分发为主;计费解除后重 dispatch。
- [ ] 打 tag 验证 release 链路(计费解除、CI 恢复后)。

## 验证命令
- 本地预演:`bun run scripts/gen-assets.ts && bun build --compile cli/main.ts --minify --outfile bin/jspace && bin/jspace doctor --dir <workbench>`
- CI:Actions 矩阵绿;release 页面有 3 平台产物。

## 评审门 / 回滚
- **门1**:建仓/推送/打 release 前,owner 明确确认(每次外部动作)。
- **回滚**:workflow 可删除;仓库若误建可 `gh repo delete`(需 owner 确认)。

## 参考
- 父 design 4.4、`research/harness-ci-facts.md`(runner 标签/arm64/release 上传实践)。
