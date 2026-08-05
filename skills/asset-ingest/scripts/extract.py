#!/usr/bin/env python3
"""extract.py — 分层深度抽取统一入口(markitdown 增强 + office-extract 零依赖回退)。

JSpace asset-ingest 深度抽取工具:统一入口。按需路由:
- markitdown 可用 -> 所有支持格式(PDF/HTML/DOCX/XLSX/PPTX/MD)走 markitdown。
- markitdown 不可用 -> xlsx/pptx 回退 office-extract.py(零依赖);pdf/html/docx/md
  明确报错并提示安装,不静默失败。

用法:
    python3 extract.py <input> [--out <file>]

- 无 --out: markdown 写 stdout;有 --out: 写入文件并打印摘要到 stdout。
- 退出码: 0 成功;非 0 失败(stderr 给原因)。失败即停,不写半成品伴生文件。
- 确定性、幂等;office-extract 回退路径仅依赖 python3 stdlib。

markitdown 安装(不自动安装;遇 pdf/html/docx 报错再按提示装):
    macOS 系统 python 受 PEP 668 保护,用 venv:
        python3 -m venv ~/.venvs/jspace && source ~/.venvs/jspace/bin/activate
        pip install 'markitdown[pdf]'   # PDF 需 [pdf] 额外依赖;html/docx/xlsx/pptx/md 基础包即可
"""

import functools
import importlib.util
import os
import shutil
import subprocess
import sys


class ExtractError(Exception):
    """抽取失败(缺 markitdown / 不支持格式 / 抽取器调用失败)。"""


# markitdown 覆盖的格式;无 markitdown 时这几类明确报错(不静默)
NEED_MARKITDOWN = (".pdf", ".html", ".htm", ".docx", ".md")
# office-extract 零依赖回退覆盖的格式
OFFICE_EXTRACT = (".xlsx", ".pptx")

INSTALL_HINT_BASE = "pip install markitdown"
INSTALL_HINT_PDF = "pip install 'markitdown[pdf]'"


@functools.lru_cache(maxsize=1)
def _markitdown_cmd():
    """探测 markitdown 可用性,返回可调用前缀([cmd...])或 None。进程内缓存一次。"""
    exe = shutil.which("markitdown")
    if exe:
        return [exe]
    # 无 CLI 但 python 模块在(如 ~/.local/bin 不在 PATH 的 --user 安装):试 python -m
    if importlib.util.find_spec("markitdown") is not None:
        return [sys.executable, "-m", "markitdown"]
    return None


def _extract_markitdown(path: str) -> str:
    cmd = _markitdown_cmd()
    if cmd is None:
        raise ExtractError("markitdown 不可用")
    res = subprocess.run(cmd + [path], capture_output=True, text=True)
    if res.returncode != 0:
        hint = INSTALL_HINT_PDF if path.lower().endswith(".pdf") else INSTALL_HINT_BASE
        detail = (res.stderr or res.stdout or "").strip() or "无输出"
        raise ExtractError(f"markitdown 抽取失败(exit {res.returncode}): {detail};如依赖未装齐,试 {hint}")
    if not res.stdout.strip():
        raise ExtractError("markitdown 输出为空(抽取可能失败)")
    return res.stdout


def _extract_office(path: str) -> str:
    """回退到 office-extract.py(零依赖):子进程调用,stdout 即 markdown。"""
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "office-extract.py")
    res = subprocess.run([sys.executable, script, path], capture_output=True, text=True)
    if res.returncode != 0:
        raise ExtractError((res.stderr or "").strip() or f"office-extract 失败(exit {res.returncode})")
    return res.stdout


def extract_to_markdown(path: str) -> str:
    """主入口: 分层路由,按 markitdown 可用性与扩展名抽取为 markdown。"""
    lower = path.lower()
    if _markitdown_cmd() is not None:
        return _extract_markitdown(path)
    if lower.endswith(OFFICE_EXTRACT):
        return _extract_office(path)
    if lower.endswith(NEED_MARKITDOWN):
        hint = INSTALL_HINT_PDF if lower.endswith(".pdf") else INSTALL_HINT_BASE
        raise ExtractError(f"需要 markitdown 才能抽取该格式:{hint}(本机未装;不自动安装)")
    raise ExtractError("不支持的扩展名(需 .pdf/.html/.docx/.xlsx/.pptx/.md)")


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
        print("用法: python3 extract.py <input> [--out <file>]", file=sys.stderr)
        return 2
    path = rest[0]
    try:
        route = "markitdown" if _markitdown_cmd() is not None else "office-extract 回退"
        md = extract_to_markdown(path)
    except ExtractError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"抽取完成({route}): 写 {out_path}")
    else:
        print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
