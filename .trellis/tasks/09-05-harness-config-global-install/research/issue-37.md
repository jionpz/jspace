# Issue #37（研究材料，抓取于 2026-09-05）

**标题**: `harness-config` 被声明为 global 技能且被官方技能引用 13 次，但没有任何命令能取得它
**状态**: OPEN / draft · **报告环境**: WSL2 Ubuntu · **版本**: CLI 1.0.17（官方 release 二进制）

## 相关代码 / 数据

- `skills-manifest.json` → `global: [{ name: harness-config, scope: global, install_source: "~/.agents/skills/harness-config" }]`
- `cli/commands/skills.ts` → `installHandler` 只遍历 `SKILLS_MANIFEST.workbench`
- `application/skills/install.ts:46`（同上，入参 `skillNames` 由 workbench 清单给）
- `cli/assets-reachability.test.ts:78-87`（断言 harness-config **不得**进 bundle、必须有 `install_source`）
- `.jspace/skills/jspace-use/references/harnesses.md:3-4` 及各 `harness-<name>.md`（引用点）
- `application/automation/definitions.ts:78`（cron 技能目标也只查 `skillsManifest.workbench`）

## 问题描述

`harness-config` 是 `scope: global` 的机器级治理技能：仓库里有完整源（`skills/harness-config/`，5 个文件），manifest 里声明了，`assets-reachability.test.ts` 还专门断言它**不能**被嵌进 bundle、必须有 `install_source`。

但**没有任何命令会把它落到盘上**：

```bash
$ jspace skills install --dry-run
(dry-run) would install jspace-use@…/jspace-use    skipped=13
…（7 个 workbench 技能，无 harness-config）
```

- `installHandler` 取的是 `SKILLS_MANIFEST.workbench` ⇒ `manifest.global` 在**运行时代码里零引用**（全部命中都是 `.workbench`；唯一读 `.global` 的是 `scripts/skill-doc-drift.ts:23`，那是文档计数校验，不是安装）；
- `install_source: "~/.agents/skills/harness-config"` 是**目标路径**，不是来源 —— 名字叫 install_source 但没有任何东西读它去装；
- `harnesses.md:4` 写的获取方式是「需要时按**其 Phase 1** 自装到 `~/.agents/skills/harness-config`」——循环依赖：要读该技能的 Phase 1 才能装它，而它不在盘上、也不在二进制里。

## 影响

官方技能正文里 **13 次 / 7 个文件**指向 `harness-config`（`harnesses.md`、`harness-{claude,grok,opencode,cursor,pi}.md`、`jspace-use/SKILL.md`）。只装 release 二进制、没有 clone 仓库的机器上：

- 智能体按文档去找 `~/.agents/skills/harness-config` → 目录不存在 → 每次命中都是死链，且没有任何命令能补救；
- 这条路径**被测试与 manifest 承认为合法**，所以没有任何检查会报警（doctor 不查 global 技能是否存在，check-skills 只验仓库源可解析）。

## 期望行为（任一即可，按上游口味）

1. **给获取路径**：`jspace skills install --global`（或 `--scope global`）把仓库/发行渠道里的 global 技能落到 `~/.agents/skills/<name>`；若仍不嵌 bundle，就让 `install_source` 真当"来源"用（如 release 资产 URL + SHA-256 校验）。
2. 或者**取消 13 处悬空引用**：把机器级治理内容并进 `jspace-use`（或显式降级措辞）。
3. 无论选哪条，补 doctor 检查：`skills.global_missing`（info）——`manifest.global` 里声明的技能若在 `install_source` 路径下不存在就报出来。

## 复现

```bash
jspace --version                      # 1.0.17（官方 release）
jspace skills install --dry-run | grep harness-config        # 无输出
ls ~/.agents/skills/ | grep harness-config                    # 无输出
grep -rc "harness-config" <workbench>/.jspace/skills --include="*.md" | grep -v ':0'   # 多处命中
```
