# bun + TypeScript CLI 跨平台事实(研究 + 实测)

**子任务**:08-02-cli-bun-ts | **版本**:bun 1.3.14(macOS arm64 实测)
> 本文合并了主会话实测(`empirical-bun-probe.md`)与研究子代理确认的交叉编译结论。标 ✅ = 本机实测验证;标 ⏳ = 待 Windows 验证。

## 1. `bun build --compile` 用法与产物 ✅

```bash
bun build --compile ./cli/main.ts --minify --outfile <name>            # 本机平台
bun build --compile ./cli/main.ts --target=bun-windows-x64 --outfile jspace-windows-x64.exe   # 交叉
bun build --compile ./cli/main.ts --target=bun-linux-x64   --outfile jspace-linux-x64
```

- `--target` 合法值:`bun`(本机)、`bun-windows-x64`、`bun-linux-x64`、`bun-darwin-*` 等(参考 `bun build --help`)。browser/node target 与本 CLI 无关。
- **交叉编译可用**(macOS arm64 → Windows x64 / Linux x64 均产出合法 PE32+/ELF;`file` 识别确认)。**但交叉产物不能在构建机运行冒烟** → CI 冒烟必须原生 runner。
- 产物命名:`--outfile` 决定;Windows 交叉产物建议带 `.exe`。
- Windows 专有编译 flag(来自 `--help`):`--windows-hide-console`、`--windows-icon`、`--windows-title`、`--windows-publisher`、`--windows-version`、`--windows-description`、`--windows-copyright`。
- **产物体积 ~95MB/个**(bun 运行时自包含),与业务代码大小无关。
- **AVX 兼容性(实测发现)**:bun 默认的 x64 编译目标(`bun-linux-x64`/`bun-windows-x64`/`bun-darwin-x64`)使用 AVX 指令,在无 AVX 的 CPU 上会 `Illegal instruction` 崩溃(Rosetta 模拟 amd64 实测复现)。**x64 分发应用 `-baseline` 目标**(`bun-linux-x64-baseline` 等),Rosetta/老机器实测可跑;arm64 目标无此问题,无需 baseline。

## 2. 编译模式路径语义 ✅

| 表达式 | `bun run`(源码) | 编译二进制 |
|---|---|---|
| `process.execPath` | bun 本体 | **真实二进制路径** |
| `process.argv[1]` | 源文件 | `/$bunfs/root/<name>`(内嵌虚拟 FS) |
| `import.meta.dir` | 源目录 | `/$bunfs/root`(虚拟,不可定位磁盘文件) |

- **安装目录必须用 `dirname(process.execPath)`**;源码模式用 `import.meta.dir` 推导仓库根。

## 3. 编译模式检测 ✅

- 有效:`process.argv[1]?.startsWith('/$bunfs/')`(bun 内嵌 FS 前缀)。
- ⏳ 该前缀在 Windows 交叉产物是否一致 → CI 加断言验证。
- **`Bun.isStandaloneExecutable` 不存在**(1.3.14 两模式均 `undefined`,已实测排除)。

## 4. 内嵌资产(自包含) ✅

- **`import.meta.glob` 在 bun 不可用**(两模式均 `is not a function`,已实测)。
- 正解:**构建期生成资产模块** `scripts/gen-assets.ts` → `cli/assets.generated.ts`(`Record<string,string>`),静态 import → 打进单文件。实测双模式均可物化到安装目录。
- 代价:改模板/技能需重新生成再编译(`bun run scripts/gen-assets.ts`)。

## 5. Node/bun 内置可用性(编译模式) ✅

- `node:path`(`isAbsolute`/`resolve`/`relative`)、`node:fs`(`mkdirSync`/`writeFileSync`/`rmSync`/`cpSync`)、`process.env`、`process.platform`、`process.arch`、`process.exitCode`、`console.error` 均可用(探针直接使用验证)。
- `fs.cpSync(src,dest,{recursive:true})` 语义 ≈ Python `shutil.copytree(dirs_exist_ok=True)`;本设计用 ASSETS 遍历物化,不依赖 cpSync。

## 6. 零依赖参数解析 ⏳/决策

- 命令面小(init/doctor/domain/resource + 子命令),**手写最小解析器**可行;不引入 commander 等运行时依赖。
- 若后续命令面膨胀再评估;记录决策于 design D1。

## 7. `__DEV_ROOT__` 计算(设计建议)

- source:`path.resolve(import.meta.dir, '..')`(cli/ 的上一级 = 仓库根)
- compiled:`dirname(process.execPath)`(安装目录)
- 见父 design D4(workbench 引用改 `jspace` 命令的决策待 owner 确认)。

## 8. 待 Windows 验证 ⏳

- `bun install -g <pkg>` 在 Windows 的全局 bin 位置与 shim 形态(`gbrain` / `gbrain.exe` / `.cmd`),直接影响 MCP stdio `command` 写法 → 归 `gbrain-harness-wiring` 子任务,在 Windows runner 验证。
- `/$bunfs/` 前缀在 Windows 的一致性。
