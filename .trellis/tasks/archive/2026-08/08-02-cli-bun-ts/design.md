# CLI bin/jspace 迁移到 bun+TS — 技术设计

**子任务**:08-02-cli-bun-ts | **父**:08-02-cross-platform-migration

## 1. 目标

`bin/jspace`(Python,711 行)重写为 TS/bun,行为逐项一致,`bun build --compile` 产免运行时单文件二进制。父任务 design.md 的 D1-D6 为本设计输入。

## 2. 目录与文件布局

```
bin/jspace            # 构建产物(POSIX 无扩展名;Windows 为 jspace.exe)
cli/
  main.ts             # 入口 + 参数分发(手写最小解析器)
  args.ts             # 子命令/选项定义 + parse 帮助文本(对齐 --help)
  registry.ts         # hub.json 读写 + validate_hub(逐项搬迁)
  init.ts             # init 流程 + 占位符物化
  cmds.ts             # domain/resource 命令
  embed.ts            # ASSETS 读取 + 模板/技能物化(compiled/source 双模式)
  assets.generated.ts # 构建期生成: Record<path, content>
scripts/
  gen-assets.ts       # 遍历 templates/workbench + skills/{jspace-bootstrap,asset-ingest} → assets.generated.ts
tsconfig.json         # bun 默认即可(moduleResolution bundler)
package.json          # dev-only,bun 作为运行时;scripts: build / gen-assets / dev
```

## 3. 关键实现设计

### 3.1 参数解析(零依赖)
- 手写最小解析器:命令面固定(`init`/`doctor`/`domain list|add|remove`/`resource list|add|remove`/`--version`/`--help`),选项逐个匹配。产出与 argparse `--help` 对齐的文本。
- 决策记录:若研究结论(commander 是否值得)倾向用库,则在此记录并采用;默认手写。

### 3.2 资产内嵌(父 D2/D3)
- `scripts/gen-assets.ts`:遍历 `templates/workbench/**`、`skills/jspace-bootstrap/**`、`skills/asset-ingest/**` → `assets.generated.ts`。
- `embed.ts`:
  - `isCompiled = process.argv[1]?.startsWith('/$bunfs/')`
  - `installDir = isCompiled ? dirname(process.execPath) : <repo root 由 import.meta.dir 推导>`
  - `materializeTree(dest)`:`for (rel, content) of ASSETS → mkdirSync(dirname, {recursive:true}) + writeFileSync`
- init 拷贝即调用 `materializeTree(target)`(等价 Python `shutil.copytree(dirs_exist_ok=True)`),随后占位符替换。

### 3.3 占位符 `__DEV_ROOT__`(父 D4,✅ 已确认)
- source:仓库根字符串;compiled:`installDir`(二进制所在目录)。
- 替换逻辑:`_materialize_placeholders` 对已物化树逐个文本文件 `replaceAll('__DEV_ROOT__', devRoot)`。
- 配套(owner 确认):workbench 文档引用改 PATH 上的 `jspace` 命令;本子任务保证编译二进制可作为 `jspace` 命令安装到 PATH(产物名 `jspace[.exe]`)。

### 3.4 registry 校验(父 D6)
- `registry.ts` 逐项搬迁 `validate_hub`:version、domains(id 命名/唯一/path 越界守卫 `_is_within`/README/domain.json/domain.json id 与 purpose)、resources(id/domain 引用/entrypoints 非空/kind/value/primary 约束/唯一 primary path/warning: primary path 文件缺失)。错误文案逐字保留。
- `_is_within` 用 `path.relative(child,parent)` 判断是否越界(等价 Python relative_to)。

### 3.5 输出/退出契约
- error:`console.error('jspace: error: ' + msg)`;`process.exitCode = 1`。
- doctor summary:`jspace: doctor ok/failed: N error(s), M warning(s)`。
- JSON 输出:`JSON.stringify(x, null, 2)`(unicode 默认保留,等价 ensure_ascii=False)。

### 3.6 build 脚本(供 CI 复用)
- `scripts/build.ts`(或 package.json script):参数 `--os/--arch/--outfile`,内部 `gen-assets` + `bun build --compile cli/main.ts --minify --outfile ...`。
- 命名约定:`jspace-<os>-<arch>`(Windows 加 `.exe`)。os/arch 由 `process.platform`/`process.arch` 或显式传入(CI 用显式)。

## 4. 兼容性与对拍策略

- 迁移期间保留旧 Python `bin/jspace` 于 git(不删,直到验收通过)。TS 产物放 `bin/jspace.new`?——不,直接放 `bin/jspace`,旧版从 git 取回。实施时明确。
- 对拍用例清单(见 implement.md):每命令的正常/错误路径,新旧输出 diff。

## 5. 风险

- Windows `/$bunfs/` 检测假设(父 R6):CI 加断言。
- 编译二进制 ~95MB(父 R7):如实记录;本地验证优先用 source 模式(`bun run`),release 才编译。
- 交叉编译可用(父 R1 修正):本地可 `--target=bun-<os>-<arch>` 出全平台产物做形状检查,但**真实行为验证在本机 source 模式 + CI 原生 runner 冒烟**。
