# asset-ingest 深度抽取集成 markitdown(PDF/HTML/DOCX) + 修正 project/areas 映射

## Goal

真实入库验证（2026-08-05，下载学习资料入库闭环）发现两个缺口，本任务修复：

1. **深度抽取覆盖不足**：`office-extract.py` 只支持 xlsx/pptx（零依赖 stdlib）。PDF 是 filehub 最常见的重资产，但无抽取器（真实测试中 PDF 无法提取文本）；HTML/DOCX 同样不支持。用户提出用社区验证的开源工具 **markitdown**（Microsoft，支持 PDF/HTML/DOCX/XLSX/PPTX/MD）覆盖。
2. **skill 决策表与 CLI 语义不一致**：`asset-ingest/SKILL.md` 决策表写「领域资料(书籍) → `areas/<领域>/`」，但 CLI `ingest begin` **强制 `--project <ID>`**，domain 不被当作 project（真实测试报 `warn: project books is not registered`）。映射需对齐。

## Background — 已验证的事实（2026-08-05）

- `office-extract.py`：零依赖（zipfile + ElementTree），支持 xlsx/pptx，幻影行过滤 + 每 sheet 行数上限，随技能物化进工作台。`deep-extract.md` 明确列「docx 不支持」。
- `markitdown`（pip 包，v0.1.7）：CLI 可作子进程调用（`markitdown <file>` → stdout markdown），支持 PDF/HTML/DOCX/XLSX/PPTX/MD。真实测试：PDF RAG 综述提取 171K 字符、HTML 教程转 22K markdown，均成功。
- **关键约束**：markitdown 是 pip 包，**不能嵌入 jspace 二进制**（与 office-extract.py 随技能物化不同）。工作台可能无 markitdown。
- CLI `ingest begin` 用 `resolveProjectId`（`application/ingest/project.ts`）：registered project → 用 registered；否则派生 id 并只 warning，**不阻塞**。

## Scope

**In scope**：
- `skills/asset-ingest/` 深度抽取层：新增 markitdown 支持（PDF/HTML/DOCX），保留 office-extract 零依赖路径
- `skills/asset-ingest/SKILL.md` 决策表：project/areas 映射修正
- `skills/asset-ingest/references/deep-extract.md`：更新工具说明 + 格式支持矩阵
- **CLI 补 `project add` 命令**（warning 文案 `run "jspace project add"` 指向不存在的命令——真实缺口，顺带补齐）
- 对应测试（抽取器分层路由逻辑 + project add）

**Out of scope**：
- 改 CLI `ingest begin` 的 `--project` 语义（`--project` 仍是强制归属 id，本任务只补注册命令 + 对齐文档）
- 真实 `~/filehub` 入库（本任务在隔离环境验证，不动真实数据）
- `check-ac1.sh` / AC1 流程（独立，已完成）

## Requirements

### R1 — 分层抽取器（保留零依赖 + 增强 markitdown）
- 新增一个**统一抽取入口**（如 `extract.py`），路由策略：
  - 检测 markitdown 可用（`command -v markitdown` / `python3 -c "import markitdown"`）
  - **可用** → markitdown 处理所有支持格式（PDF/HTML/DOCX/XLSX/PPTX/MD）
  - **不可用** → 回退 `office-extract.py` 处理 xlsx/pptx；PDF/HTML/DOCX **明确报错提示**「需 markitdown（`pip install markitdown`）」，不静默失败
- `office-extract.py` 保留（零依赖，无头 cron 场景可靠，幻影行过滤等定制逻辑不丢）
- 抽取输出格式统一为 markdown，`--out` 伴生 `.extract.md` 语义不变

### R2 — 决策表映射修正（project/areas）
- `asset-ingest/SKILL.md` 决策表「归属」行：**对齐 CLI 现实**——CLI 只认 `--project`（registered id 或派生名），`areas/` 是 target 路径组织，不是 CLI 的 project 参数
- 明确使用方式：领域资料 → `--project <领域名>`（如 `books`，CLI 派生 id 并 warning）+ target 走 `areas/<领域>/`；项目产出 → `--project <项目id>` + target 走 `projects/<项目>/`
- 文档说明：若要消除 warning，注册 project（CLI 无 `project add` 命令——补充说明用 `domain add` 或 hub.json 手工，或不影响功能仅提示）

### R3 — deep-extract.md 更新
- 工具说明改为分层描述（office-extract 零依赖 + markitdown 增强）
- 新增格式支持矩阵：xlsx/pptx（office-extract，无依赖）｜ PDF/HTML/DOCX/MD（markitdown，需 pip）
- 更新「已知限制」：docx/pdf 从「不支持」改为「需 markitdown」
- 补充 markitdown 安装指引（`pip install markitdown`，含 `[pdf]` 依赖提示 + macOS PEP 668 venv 方式；**不自动安装，遇 PDF/HTML 报错再按提示装**）

### R4 — CLI 补 `project add`（真实缺口）
- 新增 `jspace project add <id> [--domain <domain>] [--asset-rel-path <rel>]`：注册 project 到 `.jspace/hub.json` 的 projects 数组（复用 domain/resource 既有写入模式），消除 `ingest begin` 的「project not registered」warning
- 补 `project list`（或复用现有输出面），范围只做 add+list，不做 remove/edit
- 决策表映射闭环：`--project <registered 项目 id>` → 无 warning；领域资料仍可 `--project <领域名>`（派生 + warning 可忽略）

### R5 — 测试
- 抽取入口路由逻辑单测：markitdown 可用/不可用两条路径
- xlsx 仍走 office-extract（不回归）
- PDF 抽取（若测试环境有 markitdown）验证输出非空
- project add：注册后 `ingest begin` 不再 warning
- `bun test` / 相关脚本全绿

## Constraints

- **不嵌入 markitdown 进二进制**：pip 包不可依赖，分层方案是硬约束
- **不自动安装 pip 包**：保持无头 cron 纯净；文档指引 + 报错提示，用户按需装
- **office-extract.py 零依赖不变**：无头 cron 场景依赖它可靠执行，不能改成「必须 markitdown」
- **`--project` 语义不变**：仍是强制归属 id；本任务补注册命令 + 对齐文档，不改 use-cases.ts 的 project 解析
- **隔离环境验证**：不动真实 `~/filehub` / `~/.gbrain`
- 改 skill/脚本后重跑 `gen-assets`（记忆 [[jspace-cli-assets-regeneration]]）

## Acceptance Criteria

- [ ] AC1：隔离环境下载一份 PDF + HTML，走新抽取入口 → 均生成伴生 `.extract.md`（markitdown 路径）
- [ ] AC2：模拟无 markitdown（PATH 移除）→ xlsx 仍走 office-extract 成功；PDF/HTML 明确报错「需 markitdown」，不静默
- [ ] AC3：`asset-ingest/SKILL.md` 决策表映射修正（领域资料 `--project <领域名>` + `areas/` target；项目产出 `--project <项目id>` + `projects/` target）
- [ ] AC4：`deep-extract.md` 更新（分层说明 + 格式矩阵 + 已知限制修正 + 安装指引）
- [ ] AC5：`jspace project add <id>` 注册后 `ingest begin` 不再 warning；`project add/list` 可用
- [ ] AC6：抽取路由单测 + project add 测试通过；`bun test` 全绿
- [ ] AC7：`gen-assets` 重跑，嵌入式资产同步

## Key Decisions（规划留痕）

- **分层而非替换（2026-08-05）**：markitdown 不能嵌入二进制（pip 包），office-extract.py 零依赖对无头 cron 可靠——所以「markitdown 可用则增强、不可用则回退」是唯一正确形态，不是二选一。
- **对齐 CLI 而非改 CLI（2026-08-05）**：CLI `--project` 强制 + 派生 id 是既有行为；本任务让 skill 文档如实描述它（领域资料用领域名作 project + areas/ target），不改 CLI 语义，范围可控。
- **PDF/HTML 缺失是真实使用暴露（2026-08-05）**：下载资料入库时 PDF 无提取器卡住，这是真实 friction，不是设计预期——用户提出 markitdown 方向正确。
- 对齐依据：GOAL.md（filehub 重资产抽取深度是已闭合里程碑 #4，PDF 支持是自然延伸）、记忆 [[jspace-cli-assets-regeneration]]（改 skill 必重跑 gen-assets）。
