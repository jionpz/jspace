# bun CLI 编译模式实测(地面真值)

> 来源:2026-08-02 于 macOS arm64 / bun 1.3.14 用临时探针脚本实测。bun 官方文档研究见 `research/cli-bun-ts.md`。

## 1. 编译模式下路径语义(关键)

`bun build --compile ./probe.ts --outfile probe-bin` 后运行:

| 表达式 | 源码模式(`bun run`) | 编译模式(独立二进制) |
|---|---|---|
| `process.execPath` | bun 本体路径 | **真实二进制路径**(如 `/tmp/bunprobe/probe-bin`) |
| `process.argv[1]` | 源文件路径 | `/$bunfs/root/probe-bin`(内嵌虚拟 FS) |
| `import.meta.dir` | 源文件所在目录 | `/$bunfs/root`(内嵌虚拟 FS,**不可用于定位磁盘文件**) |

**结论:**
- 定位"CLI 安装目录"必须用 `dirname(process.execPath)`;`import.meta.dir` 在编译模式下是虚拟路径,不可用。
- **编译模式检测**:`process.argv[1]?.startsWith('/$bunfs/')`(bun 内嵌 FS 标记)。Windows 上该标记形式需在 CI 验证(假设一致,列为待验证项)。

## 2. `import.meta.glob` 在 bun 下不可用

源码模式与编译模式均报 `TypeError: import.meta.glob is not a function`(bun 1.3.14 未对它做变换)。

**结论:模板内嵌不能用 `import.meta.glob`。**

## 3. 自包含二进制正解:构建期生成资产模块

`scripts/gen-assets.ts` 在构建期遍历模板/技能树,生成 `assets.generated.ts`:

```ts
export const ASSETS: Record<string, string> = {
  "templates/workbench/AGENTS.md": "…内容…",
  "skills/jspace-bootstrap/SKILL.md": "…内容…",
  // …
};
```

CLI 静态 `import { ASSETS }` → 构建期被 bun bundler 打进单文件。

**实测两模式均正确:**
- 源码模式:`isCompiled: false`,`installDir = process.cwd()`(或 import.meta.dir 推导)
- 编译模式:`isCompiled: true`,`installDir = dirname(process.execPath)` = 真实安装目录
- 两种模式都能把内嵌树物化到 `installDir/out/...`(等价 Python `shutil.copytree` 语义)

**代价**:改模板/技能内容需重新生成模块再编译(`bun run scripts/gen-assets.ts && bun build --compile`)。收益:单代码路径、二进制完全自包含、模板不会因拷贝丢失。权衡后采用。

## 4. 交叉编译(已实测,修正早期假设)

`bun build --compile --target=<bun-<os>-<arch>>` **支持交叉编译**(macOS arm64 宿主实测):

| target | 产物 | file 识别 |
|---|---|---|
| `bun-linux-x64` | `probe-linux` | ELF 64-bit x86-64,dynamically linked(GNU/Linux) |
| `bun-windows-x64` | `probe-win.exe` | PE32+ console x86-64(MS Windows) |
| 本机 `bun`(默认) | `probe-bin` | Mach-O arm64(macOS) |

- **产物体积 ~95MB**(`probe-linux` 95M / `probe-win.exe` 98M):bun 运行时自包含的固定成本,与业务代码无关。
- 交叉产物在本机无法运行验证(ELF/PE 不能跑在 macOS arm64)→ **CI 仍需各平台原生 runner 做真实冒烟**;交叉编译用于本地快速出全平台产物 + 单 runner 集中构建。
- Windows 编译可用 flag:`--windows-icon/--windows-title/--windows-publisher/--windows-version/--windows-description/--windows-copyright`(来自 `bun build --help`)。

**设计影响(父 design R1 修正)**:非"必须原生构建";而是"构建可集中(交叉编译),**冒烟必须原生**"。CI 矩阵取舍见父 design 4.4。

## 5. 待验证(Windows)

- `/$bunfs/` 前缀在 Windows 编译产物是否一致(大概率一致,bun 内部虚拟 FS)。
- `bun install -g` 在 Windows 的 shim 形态(`gbrain` vs `gbrain.exe` vs `.cmd`)。

## 5. `__DEV_ROOT__` 占位符语义(设计决策)

现模板/AGENTS 引用 `__DEV_ROOT__/bin/jspace doctor`。编译模式下无 `bin/jspace` 子路径。建议:workbench 统一改为从 PATH 调用 `jspace`(编译二进制装进 PATH bin 目录),`__DEV_ROOT__` 仍物化为源码/安装根目录。该决策由子任务 cli-bun-ts + bootstrap-skill 细化。
