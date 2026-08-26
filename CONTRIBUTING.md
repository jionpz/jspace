# Contributing to JSpace

感谢你对 JSpace 开发仓库的关注。本仓库是 CLI、工作台模板与官方技能的**源码与发行目录**；用户日常使用的 JWorkspace 由 `jspace init` 生成到其他目录。

## 环境

- [Bun](https://bun.sh) **1.3.14**（与 CI、`package.json` devDependency 一致）
- macOS / Linux / Windows 均可开发；Windows 上部分路径相关测试需注意 CRLF

```bash
bun install --frozen-lockfile
```

## 开发验证（提交前）

非平凡改动后，至少跑通以下五条门禁（与 `.github/workflows/verify.yml` 对齐）：

```bash
bunx tsc --noEmit
bun test
bun run scripts/check-manifest-integrity.ts
bun run scripts/check-skills.ts
bun run scripts/check-harness-consistency.ts
```

改 CLI 后建议额外做一次临时工作台冒烟：

```bash
bun run cli/main.ts init /tmp/jspace-smoke
bun run cli/main.ts doctor --dir /tmp/jspace-smoke
```

## Generated 资产提交纪律

改动 `templates/workbench/`、`skills/` 或 `adapters/harness/capabilities.yaml` 后，**必须**重跑生成脚本并提交产物：

```bash
bun run scripts/gen-assets.ts
```

需一并提交的 generated 文件包括（但不限于）：

- `cli/assets.generated.ts`
- `cli/manifest.generated.ts`
- `cli/manifest.json`
- `cli/skills.generated.ts`
- `adapters/harness/capabilities.generated.ts`
- `templates/workbench/AGENTS.md`（受管块由 gen-assets 渲染）

CI 的 asset freshness 步骤与 `check-skills.ts` C4 会拒绝未同步的 generated 文件。

### `GEN_ASSETS_ALLOW_MISSING`

仅当**故意删除**某个 manifest 源文件（例如弃用 skill）且需要 regenerate-and-drop 时，可临时设置：

```bash
GEN_ASSETS_ALLOW_MISSING=1 bun run scripts/gen-assets.ts
```

只接受 `"1"` 或 `"true"`。CI **不**设置此变量；日常开发勿滥用。

## Trellis 与任务目录

本仓库 vendored Trellis（`.trellis/workflow.md`、`.trellis/spec/` 等）用于开发侧任务规划。

- **版本化**：`.trellis/spec/`、`.trellis/workflow.md`、`.trellis/scripts/`
- **本地-only（gitignored）**：`.trellis/tasks/`、`.trellis/workspace/` — 含个人路径与会话记录，新克隆默认不存在，由 trellis 命令按需生成

请勿把个人任务笔记或机器路径提交进仓库。

## 改动约定

- 模板与技能以 `templates/workbench/` 和 `skills/` 为单一事实源；不要通过修改已生成的工作台反推模板。
- Harness 接线只改 `adapters/harness/capabilities.yaml` 与对应 seed 模板，不散改 adapter。
- 非平凡功能请先走 Trellis 工作流（或在与维护者沟通后实施）。
- 命名统一使用 `jspace`（项目、CLI、技能、文档、domain）。

## Pull Request

1. Fork 或分支开发，保持 `bunx tsc --noEmit` 与 `bun test` 绿。
2. PR 描述说明动机、范围与验证方式。
3. 涉及用户可见行为或 schema 变更时，在 PR 中注明升级/迁移影响。

## License

贡献即表示你同意按 [MIT License](./LICENSE) 授权你的改动。
