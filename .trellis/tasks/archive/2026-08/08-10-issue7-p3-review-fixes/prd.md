# Issue #7 P3: manifest 解析 + 代号清理 + Windows hook + CI 配置

## Goal

修复专家 review(issue #7)的 P3 批次 4 项(编号 16-19):manifestPaths 解析改纯 JSON、内部代号注释改成人话、Windows hook 命令去 bash 依赖、verify.yml 加 timeout/concurrency。

## Requirements

### R1 — manifestPaths 解析改纯 JSON(P3.16)

- **R1.1** `scripts/gen-assets.ts` 额外生成 `cli/manifest.json`(纯 JSON = `BUNDLE_MANIFEST` 对象,供检查脚本消费;TS 版本 `manifest.generated.ts` 仅用于嵌入二进制)。
- **R1.2** `scripts/asset-integrity.ts` 新增 `readManifestJson(path)`(JSON.parse),`manifestPaths` 标记为 legacy(新代码不用正则)。
- **R1.3** `scripts/gen-assets.ts` stale 检查、`scripts/check-manifest-integrity.ts`、`scripts/manifest-integrity.test.ts` 全部改用 JSON.parse(消除整份 TS 正则的脆弱性:注释含 `path:`、路径含引号等误匹配)。
- **R1.4** `.github/workflows/verify.yml` freshness 检查文件清单加 `cli/manifest.json`。

### R2 — 内部代号注释改成人话(P3.17)

- **R2.1** 将 `core/` `application/` `adapters/` `cli/` `scripts/` 中注释里的内部代号(Child D/E、D1-D6、T1-T3、F2-F4、AC1/AC9/AC11、RD5、M7/M8、方案 a)改写为可自解释的人话描述,保留决策语义。
- **R2.2** 不改代码逻辑、不改公开 API、不改 `capabilities.yaml` 等数据文件;只动注释。
- **R2.3** `*.test.ts` 中引用代号的人话化同步(测试名/注释),不改断言语义。

### R3 — Windows hook 命令去 bash 依赖(P3.18)

- **R3.1** 三个模板(`.claude/settings.json` / `.grok/hooks/jspace.json` / `.cursor/hooks.json`)的 hook command 去掉 `2>/dev/null || true`,改为纯 `jspace context ...`(跨平台)。CLI 已保证内部吞错 exit 0(`failLines` + `gate` 非工作台静默);stdout 是唯一解析通道,stderr 被 host 忽略。
- **R3.2** `cli/commands/context.ts` 头注释、`harness-claude.md`/`harness-grok.md`/`harness-cursor.md` 对应描述同步(说明命令已无 shell 语法,CLI 自带吞错)。
- **R3.3** 确认无脚本/测试断言 `2>/dev/null || true` 字面量(init.test.ts 等)。

### R4 — verify.yml timeout/concurrency(P3.19)

- **R4.1** `.github/workflows/verify.yml` job 加 `timeout-minutes`(如 20)与 `concurrency`(PR run 取消过期,`group: verify-${{ github.ref }}` + `cancel-in-progress: true`)。

## Acceptance Criteria

- [ ] AC1 `cli/manifest.json` 存在且合法 JSON;`check-manifest-integrity.ts` / `manifest-integrity.test.ts` / gen-assets stale 检查均基于 JSON
- [ ] AC2 构造「TS 注释里含 path: 字符串」场景,JSON 解析不受影响(旧正则会误匹配)
- [ ] AC3 `rg "Child [A-Z]|AC[0-9]+|D[0-9]+|T[0-9.]+|F[0-9]+|RD[0-9]+|方案 a"` 在 core/application/adapters/cli/scripts 无残留(harness 决策代号 D1-D6 保留的除外——仅当用于真实现状描述)
- [ ] AC4 模板 3 文件 9 条 hook 命令无 `2>/dev/null`/`|| true`;context.ts 注释同步
- [ ] AC5 verify.yml 含 `timeout-minutes` + `concurrency`
- [ ] AC6 `bunx tsc --noEmit` + `bun test` 全过
- [ ] AC7 `bun run scripts/gen-assets.ts` 后 git diff 无残留(含 manifest.json)
- [ ] AC8 `bun run scripts/check-skills.ts` + `check-harness-consistency.ts` + `check-manifest-integrity.ts` 全过
- [ ] AC9 全量 `bun test`(manifest-integrity / asset-integrity 等)绿

## Out of Scope

- P0/P1/P2 已完成项
- 代号改名影响公开行为或数据文件(capabilities.yaml 的 harness 键、cron enum 等不动)
- Windows hook 的真实 PowerShell 验证(CI 无 Windows harness 会话;模板命令已无 shell 语法故跨平台)
