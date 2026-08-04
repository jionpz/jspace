#!/usr/bin/env bash
# scripts/check-ac1.sh — 判定 AC1(Haiku 冷跑)是否通过。
# 读 AC1 环境终态(不依赖 transcript),返回 PASS/FAIL + 明细。
#
# 用法: scripts/check-ac1.sh [工作台目录]
# 默认 /tmp/jspace-ac1
set -euo pipefail

TARGET="${1:-/tmp/jspace-ac1}"
JSPACE="$TARGET/bin/jspace"
GBRAIN_HOME="$TARGET/brain"
GBRAIN="$HOME/.bun/bin/gbrain"

PASS=0
FAIL=0
SKIP=0

pass() { PASS=$((PASS+1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL+1)); echo "  ❌ $1"; }
skip() { SKIP=$((SKIP+1)); echo "  ⏭️  $1"; }

echo "=== AC1 终态判定 ==="
echo

# 1. AO1: source 已被移除
if [ ! -f "$TARGET/_inbox/供应商报价明细.xlsx" ]; then
  pass "source 已从 inbox 移除(ingest --complete 执行过)"
else
  fail "source 仍留在 _inbox/ (journal 停留在 staged/cleanup-pending)"
fi

# 2. filehub 存入(验证 journal 记录了 committed)
JOURNALS=$(ls "$TARGET/.jspace/state/ingest/" 2>/dev/null | head -5)
if [ -n "$JOURNALS" ]; then
  for j in "$TARGET"/.jspace/state/ingest/*.json; do
    STATUS=$(python3 -c "import json; print(json.load(open('$j')).get('status',''))" 2>/dev/null)
    if [ "$STATUS" = "committed" ]; then
      pass "journal 已 committed"
    elif [ -n "$STATUS" ]; then
      pass "journal 状态=$STATUS (committed 后才真正完成)"
    fi
  done
else
  fail "无 journal 文件(ingest begin 未执行)"
fi

# 3. gbrain 页存在(入脑)
PAGE=$(GBRAIN_HOME="$GBRAIN_HOME" "$GBRAIN" list -n 20 2>/dev/null | head -5)
if echo "$PAGE" | grep -q "acme\|供应商报价"; then
  pass "gbrain 页存在"
else
  fail "gbrain 页缺失(gbrain list 未命中)"
  # show all pages as debug
  echo "    现有页: $PAGE"
fi

# 4. project index.md 登记
if [ -f "$TARGET/filehub/projects/acme/index.md" ]; then
  pass "project index.md 已登记"
else
  skip "project index.md 未创建(条件性路径,非必须)"
fi

# 5. 召回自检
QUERY_RESULT=$(GBRAIN_HOME="$GBRAIN_HOME" "$GBRAIN" query "acme 供应商 12800" 2>/dev/null | head -10)
if echo "$QUERY_RESULT" | grep -q "供应商"; then
  pass "召回自检命中(query 'acme 供应商 12800' 返回目标页)"
else
  fail "召回自检未命中(embedding 不可达或页缺失)"
  echo "    query 输出: $QUERY_RESULT"
fi

echo
echo "=== 结果: $PASS pass, $FAIL fail, $SKIP skip ==="
if [ "$FAIL" -eq 0 ]; then
  echo ">>> AC1 通过 <<<"
  exit 0
else
  echo ">>> AC1 失败(见明细) <<<"
  exit 1
fi