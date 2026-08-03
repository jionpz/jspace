#!/usr/bin/env python3
"""office-extract.test.py — 自包含测试(无 pytest 依赖)。

构造合成 xlsx/pptx 并断言抽取输出,覆盖:
- 多 sheet / 共享字符串 / 数字 / 内联字符串 / 布尔 / 空 sheet
- 无 sharedStrings(纯 inlineStr)
- 多页 pptx 顺序
- 错误输入: 不存在文件 / 非 zip / 旧格式 .xls

运行: python3 office-extract.test.py  (PASS/FAIL + 退出码 0/1)
"""

import importlib
import os
import sys
import tempfile
import zipfile
from typing import Optional

# office-extract.py 带连字符,不能直接 import 模块名 → 用 importlib 按文件路径加载
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
office_extract = importlib.import_module("office-extract")

CT_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
CT_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def xlsx_types_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""


def build_xlsx(path: str, sheet1: str, sheet2: str, shared: Optional[str], wb_sheets: str, rels: str) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", xlsx_types_xml())
        z.writestr("xl/workbook.xml", wb_sheets)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        if shared is not None:
            z.writestr("xl/sharedStrings.xml", shared)
        z.writestr("xl/worksheets/sheet1.xml", sheet1)
        z.writestr("xl/worksheets/sheet2.xml", sheet2)


def case_full() -> tuple[str, str, str, str, str]:
    """多 sheet + 共享字符串 + 数字 + 内联 + 布尔 + 空 sheet。返回 (wb, rels, shared, sheet1, sheet2)。"""
    wb = f"""<workbook xmlns="{CT_MAIN}" xmlns:r="{CT_OFFICE}">
 <sheets><sheet name="报价单" sheetId="1" r:id="rId1"/><sheet name="空表" sheetId="2" r:id="rId2"/></sheets></workbook>"""
    rels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"""
    shared = f"""<sst xmlns="{CT_MAIN}" count="3" uniqueCount="3">
 <si><t>商品</t></si><si><t>单价</t></si><si><t>服务器</t></si></sst>"""
    sheet1 = f"""<worksheet xmlns="{CT_MAIN}"><dimension ref="A1:C3"/><sheetData>
 <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>1</v></c></row>
 <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>32000</v></c><c r="C2" t="inlineStr"><is><t>启用</t></is></c></row>
 <row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="b"><v>1</v></c></row>
 </sheetData></worksheet>"""
    sheet2 = f"""<worksheet xmlns="{CT_MAIN}"><sheetData></sheetData></worksheet>"""
    return (wb, rels, shared, sheet1, sheet2)


def build_full(path: str) -> None:
    wb, rels, shared, s1, s2 = case_full()
    build_xlsx(path, s1, s2, shared, wb, rels)


def build_no_shared(path: str) -> None:
    """无 sharedStrings,全 inlineStr。"""
    wb = f"""<workbook xmlns="{CT_MAIN}" xmlns:r="{CT_OFFICE}">
 <sheets><sheet name="内联" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    rels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
    sheet1 = f"""<worksheet xmlns="{CT_MAIN}"><sheetData>
 <row r="1"><c r="A1" t="inlineStr"><is><t>标题</t></is></c><c r="B1"><v>42</v></c></row>
 </sheetData></worksheet>"""
    build_xlsx(path, sheet1, "", None, wb, rels)


def build_phantom(path: str) -> None:
    """一真实行 + 一个高空行号的幻影行(全空 <row>,应被过滤)。"""
    wb = f"""<workbook xmlns="{CT_MAIN}" xmlns:r="{CT_OFFICE}">
 <sheets><sheet name="名单" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    rels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
    sheet1 = f"""<worksheet xmlns="{CT_MAIN}"><sheetData>
 <row r="1"><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="B1"><v>12800</v></c></row>
 <row r="1048574"></row>
 </sheetData></worksheet>"""
    build_xlsx(path, sheet1, "", None, wb, rels)


def build_trunc(path: str) -> None:
    """超过 ROWS_LIMIT 的非空行 → 应截断 + 注记。"""
    wb = f"""<workbook xmlns="{CT_MAIN}" xmlns:r="{CT_OFFICE}">
 <sheets><sheet name="大表" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    rels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
    n = office_extract.ROWS_LIMIT + 2
    body = "".join(f'<row r="{i}"><c r="A{i}"><v>{i}</v></c></row>' for i in range(1, n + 1))
    sheet1 = f"""<worksheet xmlns="{CT_MAIN}"><sheetData>{body}</sheetData></worksheet>"""
    build_xlsx(path, sheet1, "", None, wb, rels)


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"


def build_pptx(path: str) -> None:
    pct = f"""<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
 <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
 <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>"""
    # slide1 展示顺序在 slide2 之后(sldId rId2 在前)——验证页序按展示顺序
    prs = f"""<p:sldIdLst xmlns:p="{P_NS}" xmlns:r="{CT_OFFICE}">
 <p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst>"""
    prsrels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>"""

    def slide(text: str) -> str:
        return f"""<p:sld xmlns:a="{A_NS}" xmlns:p="{P_NS}"><p:cSld><p:spTree>
 <p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>
 </p:spTree></p:cSld></p:sld>"""

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", pct)
        z.writestr("ppt/presentation.xml", prs)
        z.writestr("ppt/_rels/presentation.xml.rels", prsrels)
        z.writestr("ppt/slides/slide1.xml", slide("第一张(实为第 2 页)"))
        z.writestr("ppt/slides/slide2.xml", slide("第一页标题"))


def main() -> int:
    failures = []
    tmp = tempfile.mkdtemp(prefix="office-extract-test-")

    def check(label: str, cond: bool, detail: str = ""):
        if cond:
            print(f"  ok: {label}")
        else:
            print(f"  FAIL: {label} {detail}")
            failures.append(label)

    # 1. 全功能 xlsx
    xlsx = os.path.join(tmp, "full.xlsx")
    build_full(xlsx)
    md = office_extract.extract_to_markdown(xlsx)
    check("xlsx sheet 名", "## Sheet: 报价单" in md and "## Sheet: 空表" in md)
    check("xlsx 共享字符串", "商品" in md and "32000" in md)
    check("xlsx 单元格引用", "| 2 | 服务器 | 32000 | 启用 |" in md)
    check("xlsx 布尔", "true" in md)
    check("xlsx 空 sheet 标注", "(空)" in md)
    check("xlsx 日期限制注记", "未转日期" in md)

    # 2. 无 sharedStrings(inlineStr)
    no_shared = os.path.join(tmp, "no-shared.xlsx")
    build_no_shared(no_shared)
    md2 = office_extract.extract_to_markdown(no_shared)
    check("xlsx 无 sharedStrings", "标题" in md2 and "42" in md2)

    # 2b. 幻影行(全空高空行)过滤
    phantom = os.path.join(tmp, "phantom.xlsx")
    build_phantom(phantom)
    md_ph = office_extract.extract_to_markdown(phantom)
    check("幻影行被过滤", "1048574" not in md_ph and "12800" in md_ph)

    # 2c. 行数上限截断
    trunc = os.path.join(tmp, "trunc.xlsx")
    build_trunc(trunc)
    md_tr = office_extract.extract_to_markdown(trunc)
    emitted = len([l for l in md_tr.splitlines() if l.startswith("| ") and l[2:].lstrip()[0].isdigit()])
    check("超限截断注记", "截断" in md_tr, "缺截断注记")
    check("截断行数≤上限", emitted <= office_extract.ROWS_LIMIT, f"emitted={emitted}")

    # 3. pptx 页序(展示顺序)
    pptx = os.path.join(tmp, "deck.pptx")
    build_pptx(pptx)
    md3 = office_extract.extract_to_markdown(pptx)
    s1 = md3.find("## Slide 1")
    s2 = md3.find("## Slide 2")
    check("pptx 页序-第1页", s1 < s2 and "第一页标题" in md3[s1:s2], f"s1={s1} s2={s2}")
    check("pptx 第2页内容", "第一张(实为第 2 页)" in md3)

    # 4. 错误输入
    try:
        office_extract.extract_to_markdown(os.path.join(tmp, "nonexistent.xlsx"))
        check("不存在文件报错", False)
    except office_extract.ExtractError:
        check("不存在文件报错", True)
    bad = os.path.join(tmp, "bad.xlsx")
    with open(bad, "w") as f:
        f.write("not a zip")
    try:
        office_extract.extract_to_markdown(bad)
        check("非 zip 报错", False)
    except office_extract.ExtractError:
        check("非 zip 报错", True)
    try:
        office_extract.extract_to_markdown(os.path.join(tmp, "old.xls"))
        check("旧格式 .xls 报错", False)
    except office_extract.ExtractError:
        check("旧格式 .xls 报错", True)

    print("---")
    if failures:
        print(f"FAILED: {len(failures)} case(s): {failures}")
        return 1
    print("PASS: 全部测试通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
