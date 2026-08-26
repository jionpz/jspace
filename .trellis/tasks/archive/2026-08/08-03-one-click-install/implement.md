# 一键脚本安装 — 执行计划

## 实施清单（按序）

- [x] 1. `install/install.sh`（macOS/Linux，POSIX sh）——本机 e2e 已验证：全新/幂等/校验拒绝/下载失败/改rc卸载/默认卸载/XDG覆盖/bash双文件/fish/未知shell 全通过
  - 平台/架构探测（uname + Rosetta `sysctl.proc_translated` + Linux glibc/musl）→ 产物名映射
  - 打印计划动作（安装位置 / 将改的 rc / PATH 变更）；`--no-rc`/`--no-path` opt-out
  - 两段式下载（`curl -fsSL -o` 临时文件，无 curl 回退 wget）；`JSPACE_BASE_URL`/`JSPACE_VERSION` 环境变量覆盖
  - checksum 校验：平台感知（Darwin `shasum -a 256` / Linux `sha256sum`），`awk -v a="$asset" '{f=$2; sub(/^\*/,"",f); if(f==a) print $1}'` 精确匹配资产名列取哈希 token、转小写比对（**禁用 `grep -Fx`**——`-x` 整行匹配恒失配，复评已实测）；无匹配/不匹配 → 删半成品 exit≠0
  - 装到 `BIN_DIR=${XDG_BIN_HOME:-$HOME/.local/bin}`（参数展开默认值禁用 `~`，否则输出字面 `~/.local/bin`），chmod +x；已有异源二进制提示（非 `--force` 不覆盖）；脚本开头 `set -eu`，下载失败 `rm -f` 临时文件
  - **绝对路径自检** `"$BIN_DIR/jspace" --version`
  - rc 标记块：zsh `${ZDOTDIR:-$HOME}/.zshrc`、bash `.bashrc`+`.bash_profile`、fish `config.fish`（先 mkdir）；符号链接 rc readlink 解析；编辑前备份 `.jspace-bak`；未知 shell 只打印指令
  - `--uninstall`：只删标记块（绝不整文件回滚）；当前 rc==备份+标记块 才恢复备份；安装时**新建**的 rc 若卸载后仅剩标记块 → 删该文件；删 `.jspace-bak`；删二进制，目录仅空才删
- [x] 2. `install/install.ps1`（Windows，PowerShell）——本机无 pwsh，语法待 CI verify-install（Windows）真机验证
  - 等价流程；`PROCESSOR_ARCHITEW6432`/`PROCESSOR_IDENTIFIER` 探测（含模拟提示）
  - `Invoke-WebRequest` 下载 + `Get-FileHash`（`.ToLowerInvariant()` 比对）；TLS12 + `$ProgressPreference='SilentlyContinue'`
  - 装到 `$env:LOCALAPPDATA\jspace\bin`；.NET User PATH（展开绝对路径、按 `;` 去重大小写不敏感、去尾反斜杠）
  - `-Uninstall` 参数 + `$env:JSPACE_UNINSTALL` 双触发；卸载按条目精确删 PATH
- [x] 3. `.github/workflows/build.yml`——YAML 已验证；cron 冒烟注释已去计费锁表述
  - release 作业：`cd artifacts && sha256sum * > checksums.txt` 后随 `artifacts/*` 上传
  - 新增 `verify-install` 作业（`needs: release` + `startsWith(github.ref,'refs/tags/')` 守卫，3 OS runner）：固定 tag 拉取 + 步骤内注入 `JSPACE_VERSION=${{ github.ref_name }}`、每 step 注入 PATH、绝对路径断言 `--version`、幂等二次安装、`--uninstall` 后文件不存在——**直接启用**（计费锁前提已推翻）
- [x] 4. `docs/PLATFORMS.md`：修正「CI 计费锁」过期表述；追加「一键安装验证矩阵」章节
- [x] 5. `README.md`「快速开始」重排完成
- [x] 6. 发布首个 `v1.0.0`（经 owner 确认）：
  - 推前核对 ✓（main 8543ef1..478025e；tag 指向含 checksums CI 改动的提交）
  - push → CI run 30783613995：build 6 平台全绿 → release 成功 → verify-install 三平台全绿
  - release 正式（isDraft=false, isPrerelease=false, Latest）；资产 6 二进制 + checksums.txt 齐全
  - `latest/download/<asset>` 与 `checksums.txt` 均 HTTP 200
- [x] 7. 验收回填（AC 逐条）：
  - AC 三平台一行安装 ✓（verify-install：ubuntu-x64/macos-arm64/windows-x64 真机通过）
  - AC 错误路径 ✓（本机实测：篡改二进制/checksums、404 → exit≠0 无残留；musl/未知架构明确报错）
  - AC 幂等 ✓（重装不重复追加 rc 标记块）
  - AC 卸载无残留 ✓（改 rc 再卸载保留编辑；新建 rc 整体删除；目录仅空才删；Windows PATH 条目移除）
  - AC 校验真实执行 ✓（篡改 → 拒绝；CI 生成的 checksums 与 verify-install 自检通过）
  - AC Windows 卸载落盘可达 ✓（verify-install Windows 作业 `-Uninstall` 端到端）
  - AC v1.0.0 链路 ✓（release Latest + 全资产 200）

## 验证命令

```bash
# 语法检查
sh -n install/install.sh && bash -n install/install.sh
command -v shellcheck && shellcheck install/install.sh || echo "shellcheck not installed"
command -v pwsh && pwsh -NoProfile -Command "\$null = [scriptblock]::Create((Get-Content -Raw install/install.ps1)); 'ps1 syntax ok'" || echo "pwsh not available"

# macOS 本机端到端（v1.0.0 发布后；两段式）
curl -fsSL https://raw.githubusercontent.com/jionpz/jspace/main/install/install.sh -o /tmp/jspace-install.sh \
  && bash /tmp/jspace-install.sh
"$BIN_DIR/jspace" --version              # 期望: jspace 1.0.0（绝对路径自检）
# XDG 覆盖 e2e：XDG_BIN_HOME=/tmp/jspace-bin bash /tmp/jspace-install.sh → 自检/rc 标记块引用 /tmp/jspace-bin
# 幂等：再次安装不报错、不重复追加 PATH 标记块
# 卸载 + rc 回滚：
bash /tmp/jspace-install.sh --uninstall
[ ! -e "$HOME/.local/bin/jspace" ] && echo "binary gone"   # 默认 BIN_DIR 场景；XDG 覆盖时断言 $BIN_DIR
grep -c 'jspace init' "${ZDOTDIR:-$HOME}/.zshrc" || true   # 期望 0（标记块已删）
# 「安装后改 rc 再卸载」不丢编辑：安装后往 rc 追加 alias → 卸载 → alias 仍在、标记块已删
# 符号链接 rc 用例：ln -s 一个 rc → 安装 → 链接未被切断、内容追加到真实文件
# 下载失败负向：404/断网 → exit≠0 且 /tmp 无残留临时文件
# 校验拦截（负向）：下载后校验前给二进制追加字节 → 期望拒绝、exit≠0、无残留

# 本地模拟 e2e（无 release 时的降级验证）
JSPACE_BASE_URL=http://127.0.0.1:8000 bash /tmp/jspace-install.sh   # 本地 HTTP 服务托管模拟资产

# CI verify-install：`gh run watch <id>` 等三平台 job 全绿
```

## 风险文件 / 回滚点

- `install/install.sh`、`install/install.ps1`：新增文件，独立可删
- `.github/workflows/build.yml`：release 作业 + verify-install 作业，可 revert
- `v1.0.0` tag 推送：唯一外部/较不可逆步骤 → 排在本地验证之后，执行前 owner 确认；出错可删 release（不删 tag 亦可重建 release）

## task.py start 前复查

- [x] prd 收敛通过（无遗留 TBD/重复事实/过期事实）
- [x] design.md / implement.md 齐备且覆盖 A1–A4 + B1–B6
- [x] install 脚本语法检查通过（`sh -n` / `bash -n`；PS1 待 CI）
- [x] 评审复评通过（快复核 17/17 项：P0/P1 全部关闭）
