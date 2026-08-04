#!/usr/bin/env bash
# scripts/prepare-ac1.sh — 为 AC1(Haiku 冷跑 asset-ingest golden run)准备隔离环境。
#
# AC1 是 skills 重构任务的可证伪验收:用中等模型(Haiku 4.5)仅凭物化后的
# skills/asset-ingest/SKILL.md + 按需读的 references,把一份样本从 inbox 跑完
# journal 四步(begin → advance --gbrain → advance --index → advance --complete)。
#
# 本脚本只准备环境(工作台 + filehub + 隔离 gbrain + 中性样本),不剧透任何命令
# ——模型必须自己从 skill 里学怎么做,这正是 AC1 要验证的。
#
# 用法: scripts/prepare-ac1.sh [目标目录]   (默认 /tmp/jspace-ac1)
# 前提: 仓库根可跑 `bun run cli/main.ts`;`gbrain` 在 PATH 或 ~/.bun/bin。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-/tmp/jspace-ac1}"
GBRAIN_BIN="$(command -v gbrain || echo "$HOME/.bun/bin/gbrain")"

echo "==> AC1 隔离环境: $TARGET"

# --- 0. gbrain 前置 ---
if [ ! -x "$GBRAIN_BIN" ]; then
  echo "!! 未找到 gbrain($GBRAIN_BIN)。先安装 gbrain 再重跑。" >&2
  exit 1
fi

# --- 1. 清理 + 初始化工作台(物化最新 skills) ---
rm -rf "$TARGET"
cd "$REPO"
bun run cli/main.ts init "$TARGET" >/dev/null
echo "  ✓ 工作台已初始化(含物化的 skills/)"

# --- 2. 注册隔离 filehub(在 TARGET 内,不碰真实 ~/filehub) ---
mkdir -p "$TARGET/filehub"
bun run cli/main.ts filehub init "$TARGET/filehub" --register --dir "$TARGET" >/dev/null
echo "  ✓ filehub 已注册(TARGET/filehub)"

# --- 3. inbox + 中性样本(acme 供应商报价 xlsx,含关键数字) ---
mkdir -p "$TARGET/_inbox"
SAMPLE="$TARGET/_inbox/供应商报价明细.xlsx"
python3 - "$SAMPLE" << 'PYEOF'
import sys, zipfile
p = sys.argv[1]
CT = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
OFF = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
content_types = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="{CT}">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""
wb = f"""<workbook xmlns="{CT}" xmlns:r="{OFF}">
 <sheets><sheet name="报价单" sheetId="1" r:id="rId1"/></sheets></workbook>"""
rels = f"""<Relationships xmlns="{REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
shared = f"""<sst xmlns="{CT}" count="2" uniqueCount="2">
 <si><t>商品</t></si><si><t>单价</t></si><si><t>服务器</t></si></sst>"""
sheet = f"""<worksheet xmlns="{CT}"><dimension ref="A1:B2"/><sheetData>
 <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
 <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12800</v></c></row>
 </sheetData></worksheet>"""
with zipfile.ZipFile(p, "w") as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("xl/workbook.xml", wb)
    z.writestr("xl/_rels/workbook.xml.rels", rels)
    z.writestr("xl/sharedStrings.xml", shared)
    z.writestr("xl/worksheets/sheet1.xml", sheet)
print("  ✓ 中性样本已生成(_inbox/供应商报价明细.xlsx, 单价 12800)")
PYEOF

# --- 4. 隔离 gbrain(GBRAIN_HOME 指向 TARGET,不碰 ~/.gbrain) ---
mkdir -p "$TARGET/brain"
export GBRAIN_HOME="$TARGET/brain"
"$GBRAIN_BIN" init --pglite --no-embedding --non-interactive >/dev/null 2>&1 || {
  echo "!! gbrain init 失败。请手动执行后重跑。" >&2
  exit 1
}
echo "  ✓ 隔离 gbrain 已就绪(GBRAIN_HOME=$TARGET/brain)"

# --- 5. dev wrapper:让模型跑 jspace 时用最新源码,而非可能过期的编译二进制 ---
mkdir -p "$TARGET/bin"
cat > "$TARGET/bin/jspace" << MAKEWRAPPER
#!/bin/sh
# dev wrapper: always run the latest source (gen-assets already rebuilt assets)
exec bun run "$REPO/cli/main.ts" "\$@"
MAKEWRAPPER
chmod +x "$TARGET/bin/jspace"
echo "  ✓ dev wrapper 已建(TARGET/bin/jspace → 最新源码)"

# --- 6. 写 AC1 场景请求(给 Haiku 的一句话,模拟真实用户) ---
cat > "$TARGET/AC1-TASK.md" << 'EOF'
# AC1 任务

请把 `_inbox/` 里的 `供应商报价明细.xlsx` 入库:归入项目 `acme`,深度抽取关键数字,
做成可召回的知识资产。参考本工作台 `skills/asset-ingest/` 的说明完成,做完跑召回自检。
EOF
echo "  ✓ 场景请求已写(AC1-TASK.md)"

# --- 7. 验证就绪 ---
cd "$TARGET"
"$TARGET/bin/jspace" doctor --dir . >/dev/null 2>&1 && echo "  ✓ doctor 通过(wrapper 可用)" || echo "  ! doctor 有 warning(filehub 相关,AC1 不受影响)"
"$GBRAIN_BIN" doctor --fast >/dev/null 2>&1 && echo "  ✓ gbrain 健康" || echo "  ! gbrain doctor 非致命"

echo ""
echo "================ AC1 就绪 ================"
echo ""
echo "交互式(推荐,最接近真实):"
echo "  export GBRAIN_HOME=$TARGET/brain"
echo "  export PATH=$TARGET/bin:\$PATH"
echo "  cd $TARGET && claude --model haiku"
echo "  在会话里说: 读一下 AC1-TASK.md,按里面要求做。"
echo ""
echo "Headless(复刻 cron 无头配置,~15 分钟):"
echo "  export GBRAIN_HOME=$TARGET/brain PATH=$TARGET/bin:\$PATH"
echo "  cd $TARGET && claude --model haiku -p \"读一下 AC1-TASK.md,按里面要求做。把每步命令和输出都记下来\" --dangerously-skip-permissions"
echo "==========================================="
