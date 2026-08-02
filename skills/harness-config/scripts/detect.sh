#!/usr/bin/env bash
# detect.sh — 检测本机已安装的 AI harness(单一事实源治理文档的接线目标)。
# 自包含 POSIX bash;不硬编码用户路径,一律基于 $HOME;尊重各 harness 的配置目录环境变量。
#
# 输出(TSV): harness<TAB>binary<TAB>config_dir<TAB>state
#   state:
#     installed    binary 在 PATH 上(命令可用)
#     config_only  无 binary,但存在配置目录或 GUI 应用(Cursor)→ 提醒人工确认
#     not_found    未安装
#
# 用法: bash detect.sh
# 退出码恒为 0(检测自身不失败);可被 SKILL.md Phase 0 / 会话外调用。

set -u

for h in pi claude codex cursor; do
  case "$h" in
    pi)     dir="${PI_CODING_AGENT_DIR:-${HOME:-}/.pi}" ;;
    claude) dir="${CLAUDE_CONFIG_DIR:-${HOME:-}/.claude}" ;;
    codex)  dir="${CODEX_HOME:-${HOME:-}/.codex}" ;;
    cursor) dir="${HOME:-}/.cursor" ;;
  esac

  bin=$(command -v "$h" 2>/dev/null || true)

  if [ -n "$bin" ]; then
    state="installed"
  elif [ -d "$dir" ]; then
    state="config_only"
  elif [ "$h" = "cursor" ] && { [ -d "/Applications/Cursor.app" ] || [ -d "${HOME:-}/Applications/Cursor.app" ]; }; then
    state="config_only"   # Cursor 是 GUI 应用:装了 GUI 但 CLI 未在 PATH
  else
    state="not_found"
  fi

  printf '%s\t%s\t%s\t%s\n' "$h" "$bin" "$dir" "$state"
done
