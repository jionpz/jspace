# bootstrap skill 跨平台化 — 执行计划

**子任务**:08-02-bootstrap-skill | **父**:08-02-cross-platform-migration

## 顺序依赖
- 平台事实以父任务 `research/harness-ci-facts.md` 为准(已定稿);接线路径复用 gbrain-harness-wiring 更新后的 references。

## 执行清单 ✅
- [x] Phase 0 工具安装表(三平台):
  - python3:mac(brew)/linux(apt、dnf)/**win**(`winget install Python.Python.3.12` 或 python.org;命令为 `python`/`py`)
  - bun:posix(官方脚本)/**win**(`powershell -c "irm bun.sh/install.ps1 | iex"`);**治理红线**:两者均标注"执行前核验 bun.sh 官方来源",不再是无审查 curl|bash
  - git:win(`winget install Git.Git`)等
  - 验证命令分平台(`python3 --version`,win 用 `python`/`py`)
- [x] `references/registry.md`:校验命令改 `jspace doctor --dir .`(源码兼容 `__DEV_ROOT__/bin/jspace`);手动 fallback 标注 Windows 替代(`python -m json.tool`/`ConvertFrom-Json`)。
- [x] `references/harnesses.md`/`gbrain.md`:gbrain 解析 Windows `where`/`.exe`(由 gbrain-harness-wiring 完成,本任务复核)。
- [x] Phase 4 收尾 smoke 跨平台:`jq`(win → python/PowerShell)、`find|sort`(win → Get-ChildItem)、`jspace doctor`。
- [x] `__DEV_ROOT__/bin/jspace` 引用改 `jspace` 命令(D4;源码检出兼容说明保留):Phase 2/Phase 4/Note。
- [x] Phase 3 Windows 路径指针 → references/harnesses.md 跨平台速查表。
- [x] Phase 1 `~/.gbrain` 补 Windows `%USERPROFILE%\.gbrain`。

## 验证
- 三平台视角逐阶段走查 SKILL.md:每步有平台对应命令。
- 残留 `__DEV_ROOT__/bin/jspace` 均为有意的源码兼容说明;`jq`/`find`/`sort` 均带 Windows 替代。

## 评审门 / 回滚
- bun 安装命令已标注来源核验(治理红线);文档变更,低风险。

## 参考
- 父 design 4.3、D4、`research/harness-ci-facts.md`。
