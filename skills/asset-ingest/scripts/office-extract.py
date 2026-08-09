#!/usr/bin/env python3
"""office-extract.py — 零依赖抽取 xlsx / pptx 为 markdown（python3 stdlib only）。

JSpace asset-ingest 深度抽取工具：把 excel（逐 sheet + 单元格引用 + 值）与
ppt（逐页文本）抽成可读 markdown，供策展 Key Facts 与生成伴生 .extract.md。

用法:
    python3 office-extract.py <input.xlsx|.pptx> [--out <file>]

- 无 --out: markdown 写 stdout;有 --out: 写入文件并打印摘要到 stdout。
- 退出码: 0 成功;非 0 失败(stderr 给原因)。
- 确定性、幂等;仅依赖 zipfile + xml.etree(无第三方库)。

限制(文件级注记):
- 日期/时间单元格输出为 Excel 序列值(如 45658),不做日期转换。
- 公式单元格输出缓存值(如无缓存值为空);不做公式求值。
- 合并单元格语义、图片/图表/OCR、docx、.xls 旧格式不支持。

用法示例:
    python3 office-extract.py ~/filehub/_inbox/2026-08-03-acme.xlsx --out ~/filehub/_inbox/2026-08-03-acme.extract.md
"""

import sys
import zipfile
from xml.etree import ElementTree as ET

# OOXML 命名空间
NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NS_OFFICE = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
NS_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"

DATE_NOTE = (
    "说明: 日期/时间单元格为 Excel 序列值(如 45658),未转日期;"
    "公式单元格为缓存值;不做公式求值。"
)

# 每 sheet 输出的数据行上限(防超大表撑爆伴生文件;全量数据仍在本体文件)
ROWS_LIMIT = 1000


class ExtractError(Exception):
    """抽取失败(非 OOXML / 结构缺失等)。"""


def _col_letter(index: int) -> str:
    """0-based 列索引 -> 列字母(A=0, Z=25, AA=26...)。"""
    s = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        s = chr(65 + rem) + s
    return s


def _resolve_part(zf: zipfile.ZipFile, rels_path: str, rid: str, base: str) -> str:
    """经 rels 文件把 r:id 解析为部件路径(Target 可能是相对 base 或根绝对)。"""
    if rid is None:
        raise ExtractError("r:id 缺失")
    if rels_path not in zf.namelist():
        raise ExtractError(f"缺少关系文件: {rels_path}")
    root = ET.fromstring(zf.read(rels_path))
    target = None
    for r in root.iter(f"{NS_REL}Relationship"):
        if r.get("Id") == rid:
            target = r.get("Target")
            break
    if target is None:
        raise ExtractError(f"未找到 r:id={rid}")
    if target.startswith("/"):
        return target.lstrip("/")
    return base.rstrip("/") + "/" + target


def _text_of(elem) -> str:
    """元素下所有 <t> 文本拼接(处理富文本 run)。"""
    return "".join(t.text or "" for t in elem.iter(f"{NS_MAIN}t"))


def _read_xlsx(path: str):
    """解析 xlsx -> {sheets: [(name, rows)], note: str}。rows 为 list[list[(ref, value)]]。"""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise ExtractError("不是有效的 OOXML zip 文件")
    except FileNotFoundError:
        raise ExtractError(f"文件不存在: {path}")

    if "xl/workbook.xml" not in zf.namelist():
        raise ExtractError("不是有效的 xlsx(缺 xl/workbook.xml)")

    # 共享字符串(存在时)
    shared = []
    if "xl/sharedStrings.xml" in zf.namelist():
        ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
        for si in ss_root.iter(f"{NS_MAIN}si"):
            shared.append(_text_of(si))

    # sheet 顺序 + rels 映射
    wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
    sheets = []
    for s in wb_root.iter(f"{NS_MAIN}sheet"):
        name = s.get("name") or ""
        rid = s.get(f"{NS_OFFICE}id")
        sheets.append((name, rid))

    rels_path = "xl/_rels/workbook.xml.rels"
    zf_names = set(zf.namelist())

    result = []
    for name, rid in sheets:
        target = _resolve_part(zf, rels_path, rid, "xl")
        if target not in zf_names:
            raise ExtractError(f"sheet 部件缺失: {target}")
        sheet_root = ET.fromstring(zf.read(target))

        rows = []
        for row in sheet_root.iter(f"{NS_MAIN}row"):
            cells = []
            for ci, c in enumerate(row.iter(f"{NS_MAIN}c")):
                ref = c.get("r")
                if not ref:
                    # 无 r 属性时按位置推导: 用子元素顺序在行内累计不可靠,退化为列字母按 ci
                    col = _col_letter(ci)
                    row_num = row.get("r") or "?"
                    ref = f"{col}{row_num}"
                ctype = c.get("t")
                v = c.find(f"{NS_MAIN}v")
                is_el = c.find(f"{NS_MAIN}is")
                if is_el is not None:
                    val = _text_of(is_el)
                elif v is not None and v.text is not None:
                    if ctype == "s":
                        idx = int(v.text)
                        val = shared[idx] if idx < len(shared) else f"<shared#{idx}>"
                    elif ctype == "b":
                        val = "true" if v.text.strip() in ("1", "true") else "false"
                    else:
                        val = v.text.strip()
                else:
                    val = ""
                cells.append((ref, val))
            # 过滤全空行(Excel 幻影行: 巨大 used range 里绝大多数 <row> 无内容)
            if any(val for _ref, val in cells):
                rows.append(cells)
        result.append({"name": name, "rows": rows})
    return {"sheets": result, "note": DATE_NOTE}


def _read_pptx(path: str):
    """解析 pptx -> {slides: [list[str] 段落文本]}。"""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise ExtractError("不是有效的 OOXML zip 文件")
    except FileNotFoundError:
        raise ExtractError(f"文件不存在: {path}")

    if "ppt/presentation.xml" not in zf.namelist():
        raise ExtractError("不是有效的 pptx(缺 ppt/presentation.xml)")

    prs_root = ET.fromstring(zf.read("ppt/presentation.xml"))
    ids = [s.get(f"{NS_OFFICE}id") for s in prs_root.iter(f"{NS_P}sldId")]

    zf_names = set(zf.namelist())
    rels_path = "ppt/_rels/presentation.xml.rels"
    result = []
    for rid in ids:
        target = _resolve_part(zf, rels_path, rid, "ppt")
        if target not in zf_names:
            raise ExtractError(f"slide 部件缺失: {target}")
        slide_root = ET.fromstring(zf.read(target))

        # 按段落(a:p)组织文本;无段落时退回平铺全部 a:t
        paras = []
        for p in slide_root.iter(f"{NS_A}p"):
            texts = [t.text.strip() for t in p.iter(f"{NS_A}t") if t.text and t.text.strip()]
            if texts:
                paras.append(" ".join(texts))
        if not paras:
            flat = [t.text.strip() for t in slide_root.iter(f"{NS_A}t") if t.text and t.text.strip()]
            paras = flat
        result.append(paras)
    return {"slides": result}


def _render_xlsx(path: str, data) -> str:
    out = [f"# {path.split('/')[-1]} — 抽取", f"来源: {path}", f"> {data['note']}"]
    for sheet in data["sheets"]:
        out.append(f"\n## Sheet: {sheet['name']}")
        rows = sheet["rows"]
        if not rows:
            out.append("(空)")
            continue
        total = len(rows)
        truncated = total > ROWS_LIMIT
        rows = rows[:ROWS_LIMIT]
        if truncated:
            out.append(f"> (截断: 本 sheet 共 {total} 行非空数据,仅展示前 {ROWS_LIMIT} 行;全量在本体文件)")
        # 列集合 = 所有行单元格引用中的列字母(保持出现顺序)
        cols = []
        colset = set()
        for r in rows:
            for ref, _val in r:
                col = "".join(ch for ch in ref if ch.isalpha())
                if col and col not in colset:
                    colset.add(col)
                    cols.append(col)
        header = "| 行\\列 | " + " | ".join(cols) + " |"
        sep = "|" + "---|" * (len(cols) + 1)
        out.append(header)
        out.append(sep)
        for r in rows:
            first_ref = r[0][0] if r else ""
            row_num = "".join(ch for ch in first_ref if ch.isdigit()) or "?"
            # 逐 ref 解析列字母,构建 列->值 映射
            cellmap = {}
            for ref, val in r:
                col = "".join(ch for ch in ref if ch.isalpha())
                cellmap[col] = val
            vals = [cellmap.get(c, "") for c in cols]
            row_line = "| " + " | ".join([row_num] + [v.replace("|", "\\|").replace("\n", " ") for v in vals]) + " |"
            out.append(row_line)
    return "\n".join(out)


def _render_pptx(path: str, data) -> str:
    out = [f"# {path.split('/')[-1]} — 抽取", f"来源: {path}"]
    for i, paras in enumerate(data["slides"], 1):
        out.append(f"\n## Slide {i}")
        if not paras:
            out.append("(空)")
            continue
        for p in paras:
            escaped = p.replace("|", "\\|")
            out.append(f"- {escaped}")
    return "\n".join(out)


def extract_to_markdown(path: str) -> str:
    """主入口: 按扩展名抽取为 markdown 文本。"""
    lower = path.lower()
    if lower.endswith(".xlsx"):
        return _render_xlsx(path, _read_xlsx(path))
    if lower.endswith(".pptx"):
        return _render_pptx(path, _read_pptx(path))
    if lower.endswith((".xls", ".ppt")):
        raise ExtractError("仅支持 .xlsx/.pptx(OOXML 新格式);旧格式 .xls/.ppt 不支持")
    raise ExtractError("不支持的扩展名(需 .xlsx 或 .pptx)")


def main(argv) -> int:
    out_path = None
    rest = []
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            if i + 1 >= len(argv):
                print("error: --out 需要文件路径", file=sys.stderr)
                return 2
            out_path = argv[i + 1]
            i += 2
        elif argv[i].startswith("--out="):
            out_path = argv[i][len("--out="):]
            i += 1
        else:
            rest.append(argv[i])
            i += 1
    if len(rest) != 1:
        print("用法: python3 office-extract.py <input.xlsx|.pptx> [--out <file>]", file=sys.stderr)
        return 2
    path = rest[0]
    try:
        md = extract_to_markdown(path)
    except ExtractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(md)
        kind = "sheets" if path.lower().endswith(".xlsx") else "slides"
        print(f"抽取完成: 写 {out_path}({kind})")
    else:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
