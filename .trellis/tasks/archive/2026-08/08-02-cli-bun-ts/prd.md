# CLI bin/jspace 迁移到 bun+TS

## Goal

把 `bin/jspace`(24KB Python CLI)重写为 **TypeScript on bun**,命令面、参数、输出格式、退出码与现 Python 版逐项一致;用 `bun build --compile` 产出免运行时依赖的当前平台单文件二进制。**父任务:08-02-cross-platform-migration**。

## Background / Decisions

- 语言选 bun+TS(owner 拍板),理由见父任务 PRD。
- 本子任务只迁移 CLI 本体;`.trellis/` Python 工具链不迁移。
- registry 校验规则(`validate_hub`)是行为契约,不允许在迁移中改变检查项。

## Requirements

- R1.1 全部命令(`init`/`doctor`/`domain list|add|remove`/`resource list|add|remove`/`--version`)重写为 TS;`--help` 文本、`jspace: error:`/`jspace: warning:` 输出前缀、退出码(0 / 非0)与现版一致。
- R1.2 零运行时第三方依赖(与现 stdlib 对齐)。参数解析用 bun 内置/手写最小解析器即可,**不引入 commander 等运行时依赖**(除非研究结论表明值得,届时记录决策)。
- R1.3 跨平台文件/路径正确:`node:path`(`isAbsolute`/`resolve`/`relative`)、`node:fs` `cpSync`(递归、dirs_exist_ok)替换 `shutil.copytree`;`_materialize_placeholders` 的 `__DEV_ROOT__` 替换逻辑保留。
- R1.4 能算出 CLI 自身源码/安装目录(替换 Python `Path(__file__).resolve().parent.parent`),**在 TS 源码模式和编译单文件两种形态下都成立**(用于定位 `templates/workbench`、`skills/` 源目录)。
- R1.5 `hub.json` v3 的全部校验项(version、id 命名、domain path 越界、README/domain.json 存在、entrypoint kind/value/primary 约束、全局唯一性)逐一保留,错误文案一致。
- R1.6 `bun build --compile` 产出当前平台单文件二进制,命名带平台标识(如 `jspace-darwin-arm64`、`jspace-windows-x64.exe`);提供 build 脚本/文档(为子任务 github-ci-release 复用)。
- R1.7 迁移后在新 CLI 上对现有模板跑 `doctor`/`init` 冒烟,结果与旧 Python CLI 一致。

## Acceptance Criteria

- [ ] TS CLI 命令面、`--help`、error/warning 前缀、退出码与 Python 版逐项一致(对照用例清单)。
- [ ] 零运行时第三方依赖(产物无外部包)。
- [ ] `validate_hub` 全检查项保留;同一份 `hub.json` 在旧/新 CLI 下 `doctor` 输出一致。
- [ ] 源码模式与编译模式都能正确定位模板/技能源目录。
- [ ] 本机(macOS arm64)`bun build --compile` 成功产出命名规范的二进制,并能运行 `jspace --version`。
- [ ] build 命令/脚本可被 CI 复用(平台 + 架构参数化)。

## Constraints

- 不破坏现 workbench 的 `hub.json` v3 schema。
- 不改 registry 校验语义。
- 平台/架构相关的跨平台事实(Windows bun global shim、compile 交叉编译能力、内置模块可用性)以父任务 `research/` 产出为准,冲突时更新本 PRD。

## Ordering / Dependencies

- 本子任务先行。子任务 `gbrain-harness-wiring`、`bootstrap-skill`、`github-ci-release` 依赖本任务的 CLI 形态与 build 脚本。
- 验收可与旧 CLI 对比完成(本机同时保留旧 Python 版作参考)。

## Notes

- 参考:父任务 `research/cli-bun-ts.md`(待产出)。
