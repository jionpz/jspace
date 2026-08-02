#!/usr/bin/env bash
# detect.sh — 检测本机已安装的 AI harness(单一事实源治理文档的接线目标)。
# 自包含 POSIX bash;不硬编码用户路径,一律基于 $HOME。
#
# 输出(TSV): harness<TAB>binary<TAB>config_dir<TAB>state
#   state:
#     installed   binary 在 PATH 上(命令可用)
#     config_only 无 binary,但存在配置目录(残留配置,提醒人工确认)
#     not_found   未安装
#
# 用法: bash detect.sh
# 退出码恒为 0(检测自身不失败);可被 SKILL.md Phase 0 / 会话外调用。

set -u

for h in pi claude codex cursor; do
  case "$h" in
    pi)     dir="$HOME/.pi" ;;
    claude) dir="$HOME/.claude" ;;
    codex)  dir="$HOME/.codex" ;;
    cursor) dir="$HOME/.cursor" ;;
  esac

  bin=$(command -v "$h" 2>/dev/null || true)

  if [ -n "$bin" ]; then
    state="installed"
  elif [ -d "$dir" ]; then
    state="config_only"
  else
    state="not_found"
  fi

  printf '%s\t%s\t%s\t%s\n' "$h" "$bin" "$dir" "$state"
done
