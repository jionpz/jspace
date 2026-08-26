# 一键脚本安装 — 技术设计

## 架构与边界

仓库内产物 + 一处 CI 改动：

| 文件 | 平台 | 分发方式 |
|---|---|---|
| `install/install.sh` | macOS / Linux（POSIX sh） | `curl -fsSL https://raw.githubusercontent.com/jionpz/jspace/main/install/install.sh -o /tmp/jspace-install.sh && bash /tmp/jspace-install.sh` |
| `install/install.ps1` | Windows（PowerShell） | `irm <url> -OutFile $env:TEMP\jspace-install.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\jspace-install.ps1`（两段式落盘，符合红线；`irm\|iex` 仅保留为卸载的 env 触发兜底） |
| `checksums.txt` | 全部 | CI release 作业生成、随 release 上传 |

- 卸载不独立成文件：`install.sh --uninstall`、`install.ps1 -Uninstall` / `$env:JSPACE_UNINSTALL`。安装位置固定已知，卸载可反推。
- 脚本随仓库 main 分发；**版本解析不依赖 GitHub API / jq**（固定 release URL 模式）。
- **两段式下载**（非裸 `curl|bash`）：先落临时文件并校验非空，再执行——下载失败时 `curl` 的退出码得以保留（管道取末命令退出码的问题消除），且符合治理红线。

## 数据流（install.sh，PS1 等价）

```
两段式下载 install.sh → bash
  → 打印计划动作（安装位置 / 将修改的 rc / PATH 变更）——披露 + 无 opt-out 前先告知
  → 平台/架构探测（uname -s/-m；macOS Rosetta 用 sysctl.proc_translated；Linux glibc/musl 探测）
  → 产物名映射：jspace-<os>-<arch>[.exe]；musl → 明确报错列出支持发行版
  → 下载 URL：${JSPACE_BASE_URL:-https://github.com/jionpz/jspace/releases}/download/${JSPACE_VERSION:-latest}/<asset>
  → 下载 checksums.txt + 二进制到临时文件
  → 本地校验：Darwin `shasum -a 256` / Linux `sha256sum`；`awk` 按资产名精确匹配行 → 取首字段(哈希token) → 转小写比对
  → 不匹配 → 删临时文件、报错 exit≠0；匹配 → 安装
  → chmod +x → 安装到 $BIN_DIR/jspace
  → 绝对路径自检："$BIN_DIR/jspace" --version
  → 目录不在 PATH → 自动写 rc 标记块（见下）
  → 提示：新终端生效 / 非交互 shell 需显式 source
```

## 关键决策

### 产物名映射（与 build.yml / build-all.ts 严格一致）
- `Darwin`+`arm64`→`jspace-macos-arm64`，`x86_64/amd64`→`jspace-macos-x64`
- `Linux`+`arm64/aarch64`→`jspace-linux-arm64`，`x86_64/amd64`→`jspace-linux-x64`
- Windows：`$env:PROCESSOR_ARCHITEW6432` 优先（x86 PS 下的 64 位 OS），回退 `$env:PROCESSOR_ARCHITECTURE`；`AMD64`→x64、`ARM64`→arm64
- 未知架构 → 明确报错列出支持列表，exit≠0

### 架构边界
- **Rosetta**：macOS 先 `sysctl -n sysctl.proc_translated`，=1 → 强制 arm64（避免 x86_64 误报）；Intel 或旧 macOS 该 oid 报 `unknown oid` → 静默回退 `uname -m`（不中断安装）
- **Windows 模拟**：`PROCESSOR_ARCHITEW6432`=AMD64 且 `PROCESSOR_IDENTIFIER` 含 ARM64 → 提示「将以模拟模式安装 x64」
- **glibc/musl**：Linux 用 `ldd --version`（或 `/etc/alpine-release` 存在）判定 musl → 明确报错「当前 release 仅 glibc」，列出支持发行版；PLATFORMS.md 标注

### 校验（checksum）
- 生成侧（CI）：release 作业 `cd artifacts && sha256sum * > checksums.txt` 后再上传 `artifacts/*`（checksums.txt 生成后不哈希自身）
- 消费侧（脚本）：**禁用 `grep -Fx`**（`-x` 要求整行等于资产名，而每行是 `hash  asset`，恒失配——复评已实测）。用 `awk -v a="$asset" '{f=$2; sub(/^\*/,"",f); if(f==a) print $1}' checksums.txt | head -1` 精确匹配资产名列（兼容 GNU `-b` 的 `*` 前缀）；6 个产物名互不为子串，无需担心误匹配。无匹配 → 报错「checksums.txt 缺失该产物」exit≠0；**转小写比对**（规避 Get-FileHash 大写 hex、双空格差异）；校验工具探测失败须明确报错 exit≠0
- 威胁模型：SHA-256 防**传输损坏/不完整**，不防发布源被攻破（checksums 与二进制同源）；信任根 = 仓库写权限

### 安装位置
- **`BIN_DIR` 单点定义**：脚本开头一次解析 `BIN_DIR=${XDG_BIN_HOME:-$HOME/.local/bin}`（`~` **不得**出现在参数展开默认值里——`${X:-~/.local/bin}` 输出字面 `~`，复评已实测；必须写 `$HOME`）。自检、rc 标记块 PATH、卸载、verify-install 断言四处统一引用该变量，杜绝 XDG 覆盖后 A1 复发。
- macOS/Linux：`BIN_DIR`（默认 `$HOME/.local/bin`，`$XDG_BIN_HOME` 非空则用其值）
- Windows：`$env:LOCALAPPDATA\jspace\bin`
- 已存在同名二进制（brew/rustup 来源）：打印来源提示，不静默覆盖（`--force` 才覆盖）

### PATH / rc 自动追加（owner 拍板：自动写 rc）
- 目标：zsh→`${ZDOTDIR:-$HOME}/.zshrc`（ZDOTDIR 空时回退 `$HOME`，避免拼成 `/.zshrc`）；bash→`~/.bashrc` **且同时写 `~/.bash_profile`**（macOS 登录 shell 不读 .bashrc）；fish→先 `mkdir -p ~/.config/fish` 再写 `config.fish`；未知 shell→只打印可粘贴指令，**不改**
- 标记块（幂等 + 可逆）：
  - zsh/bash：`# >>> jspace init >>>` / `export PATH="$BIN_DIR:$PATH"` / `# <<< jspace init <<<`
  - fish：`set -gx PATH $BIN_DIR $PATH`（同标记块包裹）
- **符号链接 rc**（dotfiles 用户）：编辑前解析真实路径再操作。macOS BSD `readlink` 无 `-f`（macOS 15 本机已确认可用，旧版无）——脚本需可移植探测：先 `readlink -f "$rc"` 成功则用其输出，失败回退 `perl -MCwd -e 'print Cwd::abs_path(...)'`，再失败则跳过自动注入、打印手动指令；解析结果不指向常规文件也跳过。macOS 本机 e2e 补符号链接 rc 用例
- **备份**：仅当将要编辑时 `cp "$rc" "$rc.jspace-bak"`（已存在则跳过）；卸载处理完成后删除 `.jspace-bak`
- **卸载语义（关键）**：只剥离标记块（sed 按行区间删除）；**绝不整文件恢复备份**。仅当「当前 rc 内容 == 备份内容 + 标记块」（即安装后无外部编辑）才用备份恢复；否则只删标记块、保留用户编辑并打印提示。重装时若「备份在但标记块不在」（前次卸载未完成）→ 重建备份。
- **安装前无 rc 文件的卸载分支**：若安装时**新建**了 rc（无备份）、卸载后内容恰等于标记块 → 直接删除该 rc 文件（否则残留空文件，违反「卸载无残留」）；若卸载后仍有用户行 → 只剥离标记块保留 rc
- `--no-rc` / `--no-path`：跳过 rc 写入 / PATH 检查（opt-out）

### Windows PATH（用户作用域，精确管理）
- 读：`[Environment]::GetEnvironmentVariable('Path','User')`（处理 `$null`）；写入用 `$env:LOCALAPPDATA` 展开的**绝对路径**（避免字面 `%LOCALAPPDATA%` 写 REG_SZ 永不展开）
- 去重：按 `;` 切分，大小写不敏感、去尾反斜杠
- 写：`[Environment]::SetEnvironmentVariable('Path', $merged, 'User')`（.NET API，无 setx 1024 字符截断；新进程生效）
- 卸载：按 `;` 边界精确删除安装目录条目，绝不整体还原快照（否则覆盖用户新增项）

### 下载与自检
- 下载：`curl -fsSL -o`；无 curl 回退 `wget -qO`；再失败报错。脚本开头 `set -eu`（或逐命令显式检查 `$?`），下载后校验退出码并在失败时 `rm -f` 临时文件（或 `trap` 统一清理）——保证「下载失败 → exit≠0 且 /tmp 无残留」可达成
- 自检一律**绝对路径**：Unix `"$BIN_DIR/jspace" --version`；Windows `& "$env:LOCALAPPDATA\jspace\bin\jspace.exe" --version`（PATH 写入只对后续进程生效，当前会话裸 `jspace` 必 command not found）

### Windows 卸载可达性（关键）
- `irm|iex` 管道脚本无 `$args`，`-Uninstall` 无法经 param 绑定；落盘脚本带 MOTW，RemoteSigned 策略拦截
- 双触发：① `powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall`（落盘执行，README 主推）；② 脚本开头检查 `$env:JSPACE_UNINSTALL`（`irm|iex` 前先设环境变量也可卸载）
- PS1 开头固定 `[Net.ServicePointManager]::SecurityProtocol = [SecurityProtocolType]::Tls12`（PS5.1 默认 TLS1.0）+ `$ProgressPreference='SilentlyContinue'`（iwr 进度条拖慢）+ `Invoke-WebRequest` 加 `-UseBasicParsing`（PS5.1 无 IE 引擎环境会抛错）；`Get-FileHash` 结果 `.ToLowerInvariant()`

### CI（build.yml）
- release 作业：`cd artifacts && sha256sum * > checksums.txt`，随 `artifacts/*` 上传 → `latest/download/checksums.txt` 可用
- 新增 **verify-install 作业**（`needs: release`，仅 `startsWith(github.ref,'refs/tags/')`，3 OS runner 各跑一次真机一键安装）：
  - 从 `releases/download/${{ github.ref_name }}/<asset>` **固定 tag** 拉取（规避首个 release 时 `releases/latest` 最终一致性竞态）；**步骤内显式注入 `JSPACE_VERSION=${{ github.ref_name }}`**，防止脚本默认回落 `latest` 恰踩竞态
  - 每 step 显式注入 PATH（POSIX `export PATH=...`；Windows 写 `$env:GITHUB_ENV`）
  - 断言 `jspace --version`（绝对路径调用）、幂等二次安装、`--uninstall` 后文件不存在
  - 因「CI 计费锁」前提已被证据推翻，**直接启用**，不置 `if:false`
- 发布前核对：`git show v1.0.0:.github/workflows/build.yml | grep -q checksums.txt`；`git tag -l 'v*'` 防误推

## 兼容性 / 迁移

- 不改变 CLI、不改产物名、不动 `.gitignore`（bin/ 仍不提交）
- `docs/PLATFORMS.md`：修正「CI 计费锁」过期表述，追加安装验证矩阵
- README「快速开始」重排：概念 → 三平台一行安装 → 验证 → 卸载 → 开发段（安装命令两段式）

## 运维 / 回滚

- 首次可用依赖 `v1.0.0` release；tag 推送为外部动作，执行前经 owner 确认（红线），出错可删 release
- 回滚点：install 脚本独立可删；CI 改动可 revert；release 可删
- 降级路径（CI 意外不可用）：`JSPACE_BASE_URL` 指向本地 HTTP 服务做 e2e，或 `gh release create v1.0.0 bin/*` 直接传本地 build-all 产物 + 手工 checksums

## 风险

- 跨平台真机验证依赖 CI verify-install；CI 不可用则 macOS 本机 + 本地 HTTP 模拟，Linux/Windows 如实标注延期
- 未签名 `.exe` SmartScreen/MOTW：README 提示绕过；verify-install Windows 确认不被弹窗阻塞
- raw main 脚本被篡改：信任 raw 链路，与行业惯例一致；不在本任务范围
