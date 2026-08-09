#!/bin/sh
# JSpace 一键安装脚本（macOS / Linux，POSIX sh）
# 用法: curl -fsSL <raw>/install/install.sh -o /tmp/jspace-install.sh && bash /tmp/jspace-install.sh
# 环境变量: JSPACE_VERSION=<tag>（默认 latest）、JSPACE_BASE_URL=<base>（默认 GitHub releases）
# 选项: --uninstall | --no-rc | --no-path | --force | -h
set -eu

# --- 全局常量（标记块，安装/卸载共用） ---
MARK_START="# >>> jspace init >>>"
MARK_END="# <<< jspace init <<<"

# --- 工具函数 ---
log()  { printf '✓ %s\n' "$*"; }
warn() { printf '⚠ %s\n' "$*" >&2; }
err()  { printf 'jspace-install: error: %s\n' "$*" >&2; exit 1; }

# 可移植真实路径解析（macOS BSD readlink 无 -f；macOS15+ 有）
resolve_realpath() {
    p="$1"
    if command -v readlink >/dev/null 2>&1 && readlink -f "$p" >/dev/null 2>&1; then
        readlink -f "$p"
    elif command -v perl >/dev/null 2>&1; then
        # 解析失败（含父目录不存在的空输出）回退原路径，由调用方按普通文件判断
        r="$(perl -MCwd -e 'print Cwd::abs_path($ARGV[0])' "$p" 2>/dev/null)" || r=""
        [ -n "$r" ] && printf '%s' "$r" || printf '%s' "$p"
    else
        printf '%s' "$p"
    fi
}

# 下载（curl 优先，wget 回退）；失败返回非 0。
# 进度条仅 stderr 为终端时显示；管道/CI 下保持 -s 静默，避免 \r 刷屏
dl() { # url outfile
    if command -v curl >/dev/null 2>&1; then
        if [ -t 2 ]; then
            curl -fSL --progress-bar "$1" -o "$2"   # 交互终端: 进度条
        else
            curl -fsSL "$1" -o "$2"                  # 管道/CI: 静默
        fi
    elif command -v wget >/dev/null 2>&1; then
        if [ -t 2 ]; then wget --show-progress -qO "$2" "$1"; else wget -qO "$2" "$1"; fi
    else
        return 1
    fi
}

# 从 checksums.txt 提取指定资产名的哈希（兼容 GNU -b 的 `*` 前缀）
# 输出: 小写 hex 哈希；无匹配输出空
expected_hash() { # checksums_file asset
    awk -v a="$2" '{f=$2; sub(/^\*/,"",f); if(f==a) print $1}' "$1" | head -n 1 | tr '[:upper:]' '[:lower:]'
}

# 向 rc 文件追加标记块（幂等；符号链接先解析；编辑前备份；不完整块守卫）
append_markblock() { # rcfile
    rcf="$1"
    real="$(resolve_realpath "$rcf")"
    if [ -e "$real" ] && [ ! -f "$real" ]; then
        warn "rc 不是普通文件（$real），跳过自动注入。请手动加入: export PATH=\"$BIN_DIR:\$PATH\""
        return 0
    fi
    if [ ! -e "$real" ] && [ ! -d "$(dirname "$real")" ]; then
        warn "rc 所在目录不存在（$real），跳过自动注入。请手动将 $BIN_DIR 加入 PATH"
        return 0
    fi
    if grep -qF "$MARK_START" "$real" 2>/dev/null; then
        if grep -qF "$MARK_END" "$real" 2>/dev/null; then
            log "PATH 配置已存在（幂等）: $real"
        else
            warn "rc 标记块不完整（$real），跳过自动注入。请手动检查 # >>> jspace init >>> 附近内容"
        fi
        return 0
    fi
    [ -f "$real" ] && [ ! -e "$real.jspace-bak" ] && cp "$real" "$real.jspace-bak"
    printf '\n%s\n%s\n%s\n' "$MARK_START" "$line" "$MARK_END" >> "$real"
    log "已写入 PATH 配置: $real"
}

# --- 参数解析 ---
MODE=install; FORCE=0; DO_RC=1
for arg in "$@"; do
    case "$arg" in
        --uninstall) MODE=uninstall ;;
        --no-rc|--no-path) DO_RC=0 ;;
        --force) FORCE=1 ;;
        -h|--help)
            printf 'JSpace 安装脚本\n用法: bash install.sh [--uninstall] [--no-rc|--no-path] [--force] [-h]\n'
            exit 0 ;;
        *) err "未知选项: $arg" ;;
    esac
done

# --- 安装路径（单点定义，全链路统一引用） ---
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

# --- 卸载 ---
if [ "$MODE" = uninstall ]; then
    printf '%s\n' "卸载 jspace..."
    # 已知 rc 文件逐个剥离标记块
    for rc in "${ZDOTDIR:-$HOME}/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.config/fish/config.fish"; do
        [ -f "$rc" ] || continue
        real="$(resolve_realpath "$rc")"
        [ -f "$real" ] || continue
        bak="$real.jspace-bak"
        if grep -qF "$MARK_START" "$real" 2>/dev/null; then
            if ! grep -qF "$MARK_END" "$real" 2>/dev/null; then
                # 标记块不完整（只剩 START 无 END）：sed 区间删除会误删到文件尾，跳过并提示
                warn "rc 标记块不完整（$real），请手动检查 # >>> jspace init >>> 附近内容"
                continue
            fi
            tmp="$real.jspace-tmp.$$"
            # 仅删标记块区间，保留用户行（绝不整文件回滚）
            if sed "/^${MARK_START}$/,/^${MARK_END}$/d" "$real" > "$tmp"; then
                # 有备份(安装前 rc 已存在): 保留剥离后的 rc，删备份
                if [ -f "$bak" ]; then
                    mv "$tmp" "$real"; rm -f "$bak"
                else
                    # 无备份(安装时新建的 rc): 剥离后仅剩空白则整体删除
                    if [ -z "$(tr -d '[:space:]' < "$tmp")" ]; then rm -f "$tmp" "$real"; else mv "$tmp" "$real"; fi
                fi
                log "已移除 rc 标记块: $real"
            else
                rm -f "$tmp"
            fi
        elif [ -f "$bak" ]; then
            # 备份在但标记块不在（前次卸载未完成）: 清理陈旧备份
            rm -f "$bak"
        fi
    done
    # 移除二进制与安装目录（目录仅空才删）
    rm -f "$BIN_DIR/jspace"
    if [ -d "$BIN_DIR" ] && [ -z "$(ls -A "$BIN_DIR" 2>/dev/null)" ]; then
        rmdir "$BIN_DIR" 2>/dev/null || true
    fi
    log "卸载完成。新终端生效。"
    exit 0
fi

# --- 安装：打印计划（披露） ---
printf '%s\n' "jspace 安装计划:"
printf '  - 安装到  %s\n' "$BIN_DIR"
[ "$DO_RC" = 1 ] && printf '  - 目录不在 PATH 时自动写入 shell rc（标记块，可卸载回滚）\n'
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) [ "$DO_RC" = 1 ] || printf '  - 已跳过 PATH 配置（--no-rc）\n' ;; esac

# --- 平台/架构探测 ---
case "$(uname -s)" in
    Darwin) OS=macos ;;
    Linux)  OS=linux ;;
    *) err "不支持的系统: $(uname -s)（支持 macOS / Linux）" ;;
esac
case "$(uname -m)" in
    arm64|aarch64)     ARCH=arm64 ;;
    x86_64|amd64)      ARCH=x64 ;;
    *) err "不支持的架构: $(uname -m)（支持 x64 / arm64）" ;;
esac
# Rosetta：被转译时强制 arm64（避免 x86_64 误报；Intel/旧 macOS 该 oid 未知则静默回退）
if [ "$OS" = macos ] && command -v sysctl >/dev/null 2>&1; then
    if sysctl -n sysctl.proc_translated 2>/dev/null | grep -qx 1; then ARCH=arm64; fi
fi
# Linux musl：当前 release 仅 glibc，明确报错
if [ "$OS" = linux ]; then
    if [ -f /etc/alpine-release ] || { command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | head -1 | grep -qi musl; }; then
        err "当前 release 仅提供 glibc 构建；此系统为 musl（如 Alpine）。请在 glibc 发行版（Ubuntu/Debian/Fedora/Arch…）安装"
    fi
fi
ASSET="jspace-$OS-$ARCH"
printf '  - 目标产物  %s\n' "$ASSET"

# --- 下载（两段式到临时目录） ---
BASE_URL="${JSPACE_BASE_URL:-https://github.com/jionpz/jspace/releases}"
# https-only 下载（checksum 与二进制同源，http 可被同源劫持一起过）;
# 本地 e2e 需要 http 时显式 JSPACE_ALLOW_INSECURE=1。
case "$BASE_URL" in
  https://*) ;;
  http://*)
    [ "${JSPACE_ALLOW_INSECURE:-0}" = "1" ] || err "JSPACE_BASE_URL 非 https（$BASE_URL）;本地 e2e 需 JSPACE_ALLOW_INSECURE=1 放行"
    ;;
  *) err "JSPACE_BASE_URL 非法: $BASE_URL（须以 https:// 开头）";;
esac
VER="${JSPACE_VERSION:-latest}"
# GitHub 的 /releases/download/<tag> 会把 latest 当字面 tag（返回 404）；
# latest 必须走 /releases/latest/download 重定向写法，具体 tag 才走 /download/<tag>
if [ "$VER" = latest ]; then
    DL="$BASE_URL/latest/download"
else
    DL="$BASE_URL/download/$VER"
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

dl "$DL/$ASSET" "$TMP/jspace"         || err "下载失败: $DL/$ASSET（请检查网络与版本 ${VER}）"
dl "$DL/checksums.txt" "$TMP/checksums.txt" || err "下载失败: $DL/checksums.txt"
[ -s "$TMP/jspace" ] || err "下载内容为空: $ASSET"

# --- SHA-256 校验（平台感知：sha256sum 优先，shasum 回退） ---
if command -v sha256sum >/dev/null 2>&1; then
    HASHTOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
    HASHTOOL="shasum -a 256"
else
    err "缺少 sha256 校验工具（需要 sha256sum 或 shasum）"
fi
EXPECTED="$(expected_hash "$TMP/checksums.txt" "$ASSET")"
[ -n "$EXPECTED" ] || err "checksums.txt 中未找到产物 ${ASSET} 的校验和（发布不完整？）"
ACTUAL="$($HASHTOOL "$TMP/jspace" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
[ "$ACTUAL" = "$EXPECTED" ] || err "SHA-256 校验不匹配（下载损坏或被篡改）。期望 ${EXPECTED}，实际 ${ACTUAL}"

# --- 安装 ---
mkdir -p "$BIN_DIR"
if [ -e "$BIN_DIR/jspace" ] && [ "$FORCE" != 1 ]; then
    if "$BIN_DIR/jspace" --version 2>/dev/null | grep -q '^jspace '; then
        : # 已是 jspace（幂等重装），覆盖
    else
        err "已有同名文件 $BIN_DIR/jspace 且不是 jspace（可能来自其他安装源）。用 --force 覆盖，或先 --uninstall"
    fi
fi
mv "$TMP/jspace" "$BIN_DIR/jspace"
chmod +x "$BIN_DIR/jspace"
# 绝对路径自检（PATH 写入只对后续进程生效，当前会话不能依赖裸 jspace）
VERSION_OUT="$("$BIN_DIR/jspace" --version 2>&1)" || err "安装后自检失败"
log "已安装 $VERSION_OUT"

# --- PATH / rc 自动配置 ---
if [ "$DO_RC" = 1 ]; then
    case ":$PATH:" in
        *":$BIN_DIR:"*) log "目录已在 PATH: $BIN_DIR" ;;
        *)
            shell_base="$(basename "${SHELL:-}")"
            case "$shell_base" in
                zsh)
                    line="export PATH=\"$BIN_DIR:\$PATH\""
                    append_markblock "${ZDOTDIR:-$HOME}/.zshrc"
                    ;;
                bash)
                    line="export PATH=\"$BIN_DIR:\$PATH\""
                    # macOS 登录 shell 不读 .bashrc，需同时写 .bash_profile（存在才写，各自独立幂等）
                    append_markblock "$HOME/.bashrc"
                    if [ -f "$HOME/.bash_profile" ]; then
                        append_markblock "$HOME/.bash_profile"
                    else
                        printf '%s\n' "  （提示）未找到 ~/.bash_profile，macOS 登录 shell 需手动将 $BIN_DIR 加入 PATH"
                    fi
                    ;;
                fish)
                    fish_dir="$HOME/.config/fish"; mkdir -p "$fish_dir"
                    line="set -gx PATH \"$BIN_DIR\" \$PATH"
                    append_markblock "$fish_dir/config.fish"
                    ;;
                *)
                    warn "无法识别 shell（SHELL=${SHELL:-空}），请手动将 $BIN_DIR 加入 PATH，新终端生效"
                    ;;
            esac
            printf '%s\n' "请新开终端（或 source rc）后使用 jspace；非交互 shell 需显式 export PATH"
            ;;
    esac
fi

log "安装完成。运行 jspace --version 确认，jspace init <目录> 生成工作台。"
