# Design — asset-ingest 深度抽取集成 markitdown + 修正 project/areas 映射

> 技术设计。对齐 `prd.md` 的 R1–R4；不含逐步执行清单（见 `implement.md`）。

## 1. 核心设计：分层抽取器（R1）

### 1.1 为什么分层而非替换
- `office-extract.py`：零依赖（python3 stdlib），随技能物化进工作台，幻影行过滤 + 行数上限等定制逻辑对 filehub 场景有价值；**无头 cron 批量第一遍依赖它可靠执行**。
- `markitdown`：pip 包，**不能嵌入 jspace 二进制**，工作台可能未安装。但覆盖 PDF/HTML/DOCX/XLSX/PPTX/MD（office-extract 缺的 PDF/HTML/DOCX 正是 filehub 常见重资产）。
- 结论：**markitdown 可用则增强，不可用则回退 office-extract**。不是二选一替换。

### 1.2 统一抽取入口 `extract.py`
新建 `skills/asset-ingest/scripts/extract.py`（python3，与 office-extract.py 同目录、同分发形态）：

```
python3 skills/asset-ingest/scripts/extract.py <input> [--out <file>]
```

**路由逻辑**：
1. 检测 markitdown 可用性：`shutil.which("markitdown")`（CLI 存在）或 `python3 -c "import markitdown"` 探测。
2. **markitdown 可用** → 对所有支持格式走 markitdown（子进程 `markitdown <file>` 或 python API）→ stdout markdown；`--out` 则写伴生文件。
3. **markitdown 不可用** →
   - 扩展名 `.xlsx` / `.pptx` → 转调 `office-extract.py`（零依赖路径，行为不变）。
   - `.pdf` / `.html` / `.docx` / `.md` → **明确报错** `stderr: 需 markitdown(pip install markitdown; PDF 需 'markitdown[pdf]')`，退出码非 0，不静默、不写半成品。

**检测缓存**：进程内一次探测（`functools.lru_cache`），多次调用不重复 spawn。

### 1.3 markitdown 调用方式
```python
import subprocess
# CLI 形式(与 office-extract 一致,可被 skill 文档直接引用)
res = subprocess.run(["markitdown", input_path], capture_output=True, text=True)
if res.returncode != 0:
    raise ExtractError(res.stderr.strip())
text = res.stdout
```
- PDF 需 `markitdown[pdf]`（pdfminer 等）；HTML/DOCX/XLSX/PPTX 基础包即可。
- 输出已是 markdown（含标题/表格/链接），与 office-extract 的「逐 sheet 表 / 逐页」格式不同但同为 markdown——策展 Key Facts 时**内容导向**，不强求格式一致。

### 1.4 抽取入口与 office-extract 的关系
| 维度 | office-extract.py（保留） | extract.py（新增） |
|---|---|---|
| 依赖 | 零（stdlib） | 探测 markitdown；无则回退 |
| 格式 | xlsx/pptx | 全格式（有 markitdown）/ xlsx/pptx（无） |
| 分发 | 物化进工作台 | 同目录同分发 |
| 无头 cron | 直接可用 | 有 markitdown 也走它；无则回退（xlsx/pptx 仍可用） |

`deep-extract.md` 命令示例改为 `extract.py`（统一入口），office-extract.py 作为回退在文档中说明。

## 2. 决策表映射修正（R2）

### 2.1 现状（真实测试验证）
- CLI `ingest begin --project <ID>` 强制，`resolveProjectId`（`application/ingest/project.ts`）：registered project → 用 registered；否则**派生 id + warning**，不阻塞。
- `asset-ingest/SKILL.md` 决策表「归属」写「领域资料(书籍) → `areas/<领域>/`」——但 CLI 不认 areas 作为 project 参数，领域资料入库时 `--project books` 会 warning。

### 2.2 修正后的使用方式（skill 文档如实描述）
| 资料类型 | `--project`（CLI 强制） | `--target` | `--slug` |
|---|---|---|---|
| 项目产出 | `<项目id>`（registered 首选） | `projects/<项目>/<文件名>` | `assets/<项目>/<语义名>` |
| 领域资料 | `<领域名>`（如 books；CLI 派生 + warning，可忽略） | `areas/<领域>/<文件名>` | `assets/<领域>/<语义名>` |

- `areas/` 是 **target 路径组织**，不是 CLI 的 project 参数——决策表措辞从「归属 → areas」改为「target 组织：项目产出 `projects/`，领域资料 `areas/`；`--project` 恒为归属 id（项目或领域名）」。
- warning 消除方式说明：注册 project（CLI 现无 `project add` 命令，用 `jspace domain add` 或直接编辑 `.jspace/hub.json` 的 projects 数组；不消除也不影响功能）。

### 2.3 不动 CLI
不改 `use-cases.ts` / `project.ts` / registry.ts 的 `--project` 语义。纯文档对齐。

## 3. deep-extract.md 更新（R3）

- 工具：`extract.py`（统一入口，分层路由）+ `office-extract.py`（回退路径）。
- 格式矩阵：

  | 格式 | 依赖 | 说明 |
  |---|---|---|
  | xlsx / pptx | 无 | office-extract（零依赖）；有 markitdown 也可走它 |
  | pdf | markitdown[pdf] | 最常见重资产；无则明确报错 |
  | html / docx / md | markitdown | 无则明确报错 |

- 已知限制修正：「docx 不支持」→「docx/pdf 需 markitdown」；新增「markitdown 未装时 pdf/html/docx 报错并提示安装」。
- 安装指引：`pip install markitdown`；PDF 额外 `pip install 'markitdown[pdf]'`；macOS 系统 python 受 PEP 668 保护 → `python3 -m venv <venv> && source <venv>/bin/activate && pip install 'markitdown[pdf]'`。

## 4. 测试（R4/R5）

| 层 | 覆盖 |
|---|---|
| `extract.py` 路由单测 | markitdown 可用（PDF → 非空）/ 不可用（xlsx 回退 office-extract / pdf 明确报错） |
| 回归 | 现有 `office-extract.test.py` 全绿（零依赖路径不破坏） |
| 端到端 | 隔离环境：markitdown 装好的 venv 下 PDF+HTML 走 extract.py 生成 `.extract.md` |
| project add | 注册后 `ingest begin` 不再 warning；`project add` 写 hub.json projects 数组、`project list` 可读回 |
| 全量 | `bun test` 全绿 |

## 5. CLI 补 `project add` 命令（R4）

### 5.1 现状缺口
`application/ingest/use-cases.ts:77` 的 warning 文案指向 `run "jspace project add"`，但 **CLI 没有 `project add` 命令**（只有 `domain`/`resource`）。这是真实误导。

### 5.2 命令设计
```
jspace project add <id> [--domain <domain>] [--asset-rel-path <rel>]
jspace project list
```
- 写 `.jspace/hub.json` 的 `projects` 数组，复用 `domain/resource` 既有写入模式（`application/registry/` + `adapters/fs/workbench-state.ts` 的原子写 + hub+local 配对写）。
- `Project` 契约字段：`id` / `domain` / `asset_rel_path` / `status`（`core/contracts/hub.ts`）。
  - `id` 必填（`ID_PATTERN`）；`domain` 默认 `files`；`asset_rel_path` **派生默认 `projects/<id>`**（契约要求以 `projects/` 开头命名子路径，不可为空）；`status` 默认 `active`。
- **决策**：`domain` 默认 `files`；未注册时 `fail` 并提示 `run "jspace domain add files"`（对齐 `resourceAdd` 的 fail 模式）。真实使用中 `filehub init --register` 已创建 `files` domain，因此默认即可用。
- `project add` 幂等：已存在同 id → `fail`（报已存在，防重复）。
- `project list`：复用 `domain list` 的输出风格（`id  domain  status`），支持 `--json`。

### 5.3 决策表闭环
- 项目产出：`jspace project add <项目id> --domain <项目domain>` → `--project <项目id>` 注册 → **warning 消失**。
- 领域资料：仍可 `--project <领域名>`（派生 + warning），但**推荐**给常用领域也 `project add`（如 `books`/`papers`）消除 warning、让 slug 稳定。
- skill 决策表加一句：「领域资料也建议 `project add` 注册，warning 消除 + slug 稳定」。

## 6. 兼容与影响面

- **可直接 break**（用户决策）：skill 文档 + 脚本 + 新增命令，无迁移通道。
- **物化链**：`skills/asset-ingest/scripts/extract.py` 新增 → `gen-assets` 重跑 → 嵌入二进制 → `jspace init` 物化。
- **无头 cron**：office-extract 回退路径保证 xlsx/pptx 无 markitdown 仍可跑；PDF 无头 cron 若遇 → 明确报错提示（不静默），由用户决定装 markitdown。**不自动安装 pip 包**（保持无头纯净）。
- **既有工作台**：不自动回填；新 `init` 才有 extract.py；`project add` 是 CLI 新增，旧二进制无此命令（升级后可用）。
- **`--project` 语义不变**：仍强制归属 id；本任务只补注册命令 + 对齐文档，不改 use-cases.ts 的解析。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| markitdown 版本行为差异 | 只依赖其「子进程输出 markdown」契约，不绑内部 API |
| PDF 抽取质量依赖 pdfminer | 伴生文件是派生存档，策展 Key Facts 是人工精炼，不 dump |
| 分层路由引入复杂度 | 单一入口 + 探测缓存 + 明确报错，脚本 <150 行 |
| 无头环境 markitdown 缺失 | 回退路径保证 xlsx/pptx 不回归；pdf/html/docx 显式提示 |
| project add 与 domain/resource 写入模式耦合 | 复用既有 `workbench-state.ts` 原子写 + hub/local 配对写，不另起炉灶 |
| 默认 domain=files 过窄 | 用户可 `--domain` 覆盖；MVP 保持简单，随使用涌现加深 |

