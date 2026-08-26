# JSpace 全链三平台迁移 — 执行计划

**父任务**:08-02-cross-platform-migration
**状态**:planning

## 顺序总览(按依赖)

```
1. cli-bun-ts  (先行:TS CLI + 本地 compile 产物 + build 脚本)
2. gbrain-harness-wiring  ┐
3. bootstrap-skill        ┘  (依赖 cli-bun-ts 的解析/形态,相互可并行)
4. github-ci-release        (依赖 1,最后)
5. 父级集成验收 + spec 更新 + commit
```

> 顺序写入各子任务 implement.md;parent/child 不充当依赖系统。

## 执行步骤

### Step A — 研究定稿 ✅
- [x] 实测 bun 编译模式路径/资产嵌入 → `research/empirical-bun-probe.md`
- [x] bun+TS 事实 → `research/cli-bun-ts.md`(实测合并;子代理交叉编译结论已并入)
- [x] harness/CI 事实 → `research/harness-ci-facts.md`(WebFetch 官方文档取证)
- [x] 用研究结论定稿父 design.md 4.2/4.4 + 风险 R1/R3/R6/R7
- [~] 第二个研究子代理仍后台运行;若返回新事实则合并,否则以现有 research/ 为准(已足够定稿)

### Step B — 子任务顺序执行
按各子任务 implement.md 推进;每个子任务独立 `task.py start → 执行 → check → archive`。

### Step C — 父级集成验收(部分完成;CI 阻塞项待解除后补)
- [x] 三平台行为一致:init/doctor/domain/resource 对拍清单(输出/退出码/文件产物)——cli-bun-ts 已逐项 PASS。
- [x] gbrain 接线三平台可用性复核 + bootstrap 三平台走查——文档已跨平台化(harnesses.md ×2、gbrain.md、SKILL.md、registry.md)。
- [x] CI 矩阵构建命令本地等效验证:6 格交叉编译产物格式正确;macOS 原生 + Linux arm64 容器 + Linux x64(Rosetta, baseline)冒烟通过;Windows 产物格式验证。
- [~] CI 实际矩阵构建:被 GitHub 账号计费锁定阻塞(GitHub Actions 拒分 runner)。**owner 决定 CI deferred + 本地分发为主**(`bun run build:all`);仓库 jionpz/jspace 为 private;计费解除后重开 CI。
- [x] 新旧 CLI `doctor` 对同一 hub.json 输出一致。
- [x] 治理红线复核:无未审查 curl|bash 残留(bun 安装已标注核验);外部安装命令来源已记录。
- [x] 3 子任务(cli-bun-ts/gbrain-harness-wiring/bootstrap-skill)已归档;github-ci-release 保持 in_progress(CI 阻塞)。

### Step B — 子任务执行(完成 3/4)
- [x] cli-bun-ts:归档
- [x] gbrain-harness-wiring:归档
- [x] bootstrap-skill:归档
- [~] github-ci-release:in_progress,CI 阻塞

## 验证命令(父级)
- 本地:`bun run scripts/gen-assets.ts && bun build --compile cli/main.ts --outfile bin/jspace && bin/jspace doctor --dir <测试workbench>`
- 新旧对拍:同 hub.json 下旧 Python CLI 与新 TS CLI `doctor` 输出 diff
- CI:`.github/workflows/build.yml` 三平台矩阵绿 + artifact 齐全

## 评审门 / 回滚点
- **评审门1(实施前)**:子任务 cli-bun-ts 的 `task.py start` 前,向 owner 呈现 prd/design/implement 复核。
- **评审门2(D4 决策)**:`__DEV_ROOT__` 占位符语义改为 `jspace`(PATH)前,owner 确认。
- **评审门3(外部动作)**:推 GitHub / 建仓 / 打 release 前,owner 明确确认。
- **回滚**:TS CLI 交付前 git 保留 Python `bin/jspace`;发布=单文件二进制,回滚=切回 Python 版 + 重新 init。

## 交付物核对表
- [ ] `cli/`(TS 源码)+ `scripts/gen-assets.ts` + `assets.generated.ts`(生成)
- [ ] `bun build --compile` 产物 + build 脚本(平台/架构参数化)
- [ ] harnesses.md ×2 + `~/.agents/agents.md` 三平台化
- [ ] jspace-bootstrap SKILL + references 三平台化
- [ ] `.github/workflows/build.yml` + release 链路 + GitHub repo/remote
- [ ] 父/子任务全部 archive;spec(AGENTS.md/GOAL.md 若涉及)同步
