# Implement — asset-ingest 深度抽取集成 markitdown + 修正 project/areas 映射

> 有序执行清单。对齐 `design.md`。可直接 break。每阶段有验证 + review gate。

## 执行顺序总览

**先抽取器（R1，核心）→ 再文档对齐（R2/R3）→ 测试 → 集成验证**。抽取器是最有实际价值的改动（PDF/HTML/DOCX 能用 markitdown 抽了），先落地隔离风险。

---

## Stage 0 — 基线快照（rollback point）
- [ ] `git status` 干净；记录 commit hash。
- [ ] `bun test` 全绿（当前 242 pass 基线）。
- [ ] 确认 `office-extract.test.py` 当前通过（零依赖路径基线）。

**Gate**：基线绿。任何阶段失败可 `git checkout -- skills/ scripts/` 回此点。

---

## Stage 1 — 分层抽取器 extract.py（R1）
- [ ] 新建 `skills/asset-ingest/scripts/extract.py`（与 office-extract.py 同目录）：
  - 单一入口：`python3 extract.py <input> [--out <file>]`
  - markitdown 探测（`shutil.which("markitdown")` 或 import 探测，`lru_cache`）
  - markitdown 可用 → 子进程调用 `markitdown <input>` → stdout markdown / `--out` 写伴生
  - 不可用 → xlsx/pptx 转调 `office-extract.py`；pdf/html/docx/md 明确报错（stderr 提示 `pip install markitdown` / `'markitdown[pdf]'`），退出码非 0
  - 复用 office-extract 的 ExtractError 语义（失败即停，不写半成品）
- [ ] 保留 `office-extract.py` 不动（零依赖回退路径）。
- [ ] 验证：`python3 extract.py`（无参/无 markitdown）报错合理；有 markitdown 时跑通 PDF。

**Gate**：分层路由逻辑正确；xlsx 无 markitdown 回退成功；pdf 无 markitdown 明确报错。

---

## Stage 2 — 决策表映射修正（R2）
- [ ] `skills/asset-ingest/SKILL.md` 决策表「归属」行：
  - 从「归属 → projects/areas」改为「`--project` 恒为归属 id；target 组织：项目产出 `projects/<项目>/`，领域资料 `areas/<领域>/`」
  - 加一行说明：领域资料用 `--project <领域名>`（CLI 派生 + warning，可忽略；注册 project 可消除）
- [ ] 核对 `references/filing.md` 是否有相同映射描述需同步（grep areas/projects）。

**Gate**：SKILL.md 决策表不再与 CLI 现实矛盾；领域资料入库方式描述准确。

---

## Stage 3 — deep-extract.md 更新（R3）
- [ ] 工具说明改分层：`extract.py`（统一入口）+ `office-extract.py`（回退路径）
- [ ] 格式支持矩阵表（xlsx/pptx 无依赖；pdf 需 markitdown[pdf]；html/docx/md 需 markitdown）
- [ ] 已知限制修正：「docx 不支持」→「docx/pdf 需 markitdown，未装则明确报错」
- [ ] 安装指引：`pip install markitdown` / `'markitdown[pdf]'`；macOS PEP 668 → venv 方式
- [ ] 命令示例改 `extract.py`

**Gate**：deep-extract.md 分层描述准确、安装指引可用（照做能装成功）。

---

## Stage 4 — CLI 补 project add（R4）
- [ ] `application/registry/project.ts`（或复用 domain 模式）：新增 `projectAdd` / `projectList` use cases
  - 写 `.jspace/hub.json` projects 数组；复用 `adapters/fs/workbench-state.ts` 原子写 + hub/local 配对写
  - `id` 必填（ID_PATTERN）；`domain` 默认 `files`（可 `--domain` 覆盖）；`status` 默认 `active`
  - 幂等：已存在同 id → fail（报已存在）
- [ ] `cli/commands/registry.ts`：注册 `projectSpec`（children: add/list），复用 `domainList` 输出风格（支持 --json）
- [ ] 验证：`jspace project add books --domain files` → `ingest begin --project books` 不再 warning；`project list` 可读回

**Gate**：project add 注册后 warning 消失（AC5）；list 读回正确。

---

## Stage 5 — 测试（R4/R5）
- [ ] `extract.py` 自测：markitdown 可用（PDF → 非空）/ 不可用（xlsx 回退 / pdf 明确报错）
- [ ] 回归：`office-extract.test.py` 全绿
- [ ] project add：注册后 `ingest begin` 不再 warning（单测或手工验证）
- [ ] 全量 `bun test` 全绿

**Gate**：抽取路由单测过；office-extract 不回归；全量绿。

---

## Stage 6 — 端到端 + 集成验证（AC1/AC2/AC7）
- [ ] 隔离环境：venv 装 markitdown[pdf] → PDF+HTML 走 `extract.py` 生成 `.extract.md` 非空（AC1）
- [ ] 模拟无 markitdown（PATH 移除 venv）→ xlsx 走 office-extract 成功；pdf 明确报错（AC2）
- [ ] project add 端到端：`jspace project add books` → `ingest begin --project books` 无 warning（AC5）
- [ ] `bun run gen-assets` 重跑，嵌入式资产同步（extract.py 进二进制）
- [ ] `bunx tsc --noEmit` 通过
- [ ] 提交（Phase 3.4，commit message 带任务 slug）

**Gate（最终·全 AC 对照）**：AC1–AC7 逐条勾。AC1/AC2/AC5 是核心可证伪项。

---

## Rollback points
- Stage 0 是总回滚点（`git checkout -- skills/ scripts/`）。
- 每 Stage 独立可回退；Stage 1 抽取器设计缺陷回 design 修（Phase 回滚，不硬推）。

## 验证命令速查
```bash
python3 skills/asset-ingest/scripts/extract.py <file>            # markitdown 路径
python3 skills/asset-ingest/scripts/extract.py <file.xlsx>       # 无 markitdown 回退
python3 skills/asset-ingest/scripts/office-extract.test.py        # 零依赖回归
bun run scripts/gen-assets.ts                                     # 同步嵌入式资产
bunx tsc --noEmit && bun test
```
