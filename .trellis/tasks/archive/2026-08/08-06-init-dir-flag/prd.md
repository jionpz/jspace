# init 支持 --dir 统一 CLI 接口

## Goal

`jspace init` 是唯一用位置参数（`jspace init /path`）的命令，其余命令全用 `--dir`。新用户按其余命令习惯敲 `jspace init --dir /path` 会得到 `unrecognized arguments: --dir`（exit 2）。本任务让 init 支持 `--dir`，保留位置参数向后兼容，同时给出时报 ambiguous。

## Requirements

- `cli/commands/registry.ts` 的 `initSpec` 加 `features: { dir: true }`（注入 `--dir` 选项与解析）。
- init handler 用 `ctx.root`（`--dir` ?? cwd，已在 main.ts 解析）作为目标目录；位置参数 `target` 保留兼容。
- 同时给出 `--dir` 与位置参数时报 ambiguous 错误（exit 2，对齐框架现有冲突 pattern，command.ts:393 的同名冲突语义扩展为「dir vs target」异名冲突）。
- 帮助文本正确展示 `--dir` 选项（`usage: jspace init [-h] [--dir DIR] [--force] [target]`）。
- 文档（README / GOAL.md / skills 中 init 用法示例）同步：优先推荐 `--dir` 形式，位置参数标注兼容。

## Acceptance Criteria

- [ ] `jspace init --dir <fresh-dir>` 成功初始化（与 `jspace init <fresh-dir>` 等价结果）。
- [ ] `jspace init <fresh-dir>`（位置参数）仍然可用（向后兼容）。
- [ ] `jspace init --dir X Y` 报 ambiguous 错误、exit 2（`--dir` 与位置参数同时给出）。
- [ ] `jspace init --dir <fresh-dir> --force` 在非空目录可用（--force 与 --dir 组合正常）。
- [ ] `jspace init --help` 展示 `--dir DIR`。
- [ ] `jspace init --dir <already-init>` 报「already a JSpace workbench」（错误路径经 --dir 同样生效）。
- [ ] `bun test cli/init.test.ts cli/handler-wiring.test.ts` 全绿（新增 --dir / 冲突用例）。
- [ ] `bun run scripts/gen-assets.ts` 同步（若模板/资产受影响；init 改动一般不影响资产，确认即可）。

## Notes

- 位置参数与 `--dir` 的冲突检测放在 handler 层（`ctx.dir` 与 `args.target` 同时非空即报错），不动框架层——框架只对同名 dest 冲突自动报错，init 是唯一的异名冲突场景。
- 仓库 PUBLIC：示例/文档中性占位。
