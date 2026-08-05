#!/usr/bin/env python3
"""extract.test.py — 自包含测试(无 pytest 依赖)。

验证 extract.py 分层路由:
- markitdown 不可用 -> xlsx 回退 office-extract 成功;pdf/html 明确报错(含安装提示)
- markitdown 可用(mock 为假 CLI,不依赖真实安装)-> pdf 走 markitdown 输出非空
- --out 写伴生文件;未知扩展名报错

运行: python3 extract.test.py  (PASS/FAIL + 退出码 0/1)
"""

import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract  # noqa: E402  (模块名无连字符,可直接 import)

CT_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
CT_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def build_xlsx(path: str) -> None:
    """最小 xlsx(office-extract 零依赖可解析)。"""
    ct = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"""
    wb = f"""<workbook xmlns="{CT_MAIN}" xmlns:r="{CT_OFFICE}">
 <sheets><sheet name="样例" sheetId="1" r:id="rId1"/></sheets></workbook>"""
    rels = f"""<Relationships xmlns="{CT_REL}">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"""
    sst = f"""<sst xmlns="{CT_MAIN}" count="2" uniqueCount="2"><si><t>商品</t></si><si><t>服务器</t></si></sst>"""
    sheet = f"""<worksheet xmlns="{CT_MAIN}"><sheetData>
 <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
 <row r="2"><c r="A2"><v>32000</v></c></row>
 </sheetData></worksheet>"""
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/sharedStrings.xml", sst)
        z.writestr("xl/worksheets/sheet1.xml", sheet)


def make_fake_markitdown(tmp: str) -> str:
    """写一个跨平台的假 markitdown CLI(python 脚本),输出固定 markdown。"""
    shim = os.path.join(tmp, "fake_markitdown.py")
    with open(shim, "w") as f:
        f.write("import sys\nprint(f'# markitdown(fake) for {sys.argv[1]}')\n")
    return shim


def main() -> int:
    failures = []
    tmp = tempfile.mkdtemp(prefix="extract-test-")

    def check(label: str, cond: bool, detail: str = ""):
        if cond:
            print(f"  ok: {label}")
        else:
            print(f"  FAIL: {label} {detail}")
            failures.append(label)

    xlsx = os.path.join(tmp, "sample.xlsx")
    build_xlsx(xlsx)
    pdf = os.path.join(tmp, "report.pdf")
    with open(pdf, "w") as f:
        f.write("%PDF fake")
    html = os.path.join(tmp, "guide.html")
    with open(html, "w") as f:
        f.write("<html>fake</html>")

    # 1. markitdown 不可用 -> xlsx 回退 office-extract(零依赖路径)
    extract._markitdown_cmd = lambda: None
    md = extract.extract_to_markdown(xlsx)
    check("无 markitdown: xlsx 回退 office-extract", "## Sheet: 样例" in md and "32000" in md)

    # 2. markitdown 不可用 -> pdf 明确报错(含 [pdf] 安装提示),不静默
    try:
        extract.extract_to_markdown(pdf)
        check("无 markitdown: pdf 明确报错", False)
    except extract.ExtractError as e:
        msg = str(e)
        check("无 markitdown: pdf 明确报错", "markitdown" in msg and "markitdown[pdf]" in msg, msg)

    # 3. markitdown 不可用 -> html 明确报错(基础安装提示)
    try:
        extract.extract_to_markdown(html)
        check("无 markitdown: html 明确报错", False)
    except extract.ExtractError as e:
        check("无 markitdown: html 明确报错", "pip install markitdown" in str(e))

    # 4. markitdown 可用(mock)-> pdf 走 markitdown,输出非空
    shim = make_fake_markitdown(tmp)
    extract._markitdown_cmd = lambda: [sys.executable, shim]
    md = extract.extract_to_markdown(pdf)
    check("markitdown: pdf 输出非空", "markitdown(fake)" in md)

    # 5. markitdown 路径 --out 写伴生文件
    out = os.path.join(tmp, "report.extract.md")
    rc = extract.main([pdf, "--out", out])
    check("markitdown: --out 写伴生", rc == 0 and "markitdown(fake)" in open(out).read())

    # 6. 未知扩展名报错(在 markitdown 不可用前提下;可用时全委托 markitdown 不报)
    extract._markitdown_cmd = lambda: None
    try:
        extract.extract_to_markdown(os.path.join(tmp, "x.txt"))
        check("未知扩展名报错", False)
    except extract.ExtractError:
        check("未知扩展名报错", True)

    print("---")
    if failures:
        print(f"FAILED: {len(failures)} case(s): {failures}")
        return 1
    print("PASS: 全部测试通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
