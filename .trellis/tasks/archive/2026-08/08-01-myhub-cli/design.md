# Design: JSpace CLI - registry 管理（R3）+ 模板修正（R8）

## Architecture & Boundaries

- 单文件扩展 `bin/jspace`（Python 标准库，零第三方依赖）：新增 registry 读写层 + `domain`/`resource` 两个子命令组（list / add / remove）。
- **复用并扩展 `validate_hub()`** 作为所有写操作的写前校验：内存中变更 → 校验 → 通过才落盘。新增规则（id 格式、domain path 相对且 resolve 后在根内）也进 `validate_hub()`，schema 校验单一来源，doctor 与写命令行为一致。
- 模板修正（R8）只改 `templates/workbench/AGENTS.md` 文本，不动 CLI 校验逻辑（doctor 不校验 AGENTS.md 内容）。

## Command Contracts

```
jspace domain list [--json]
jspace domain add <id> [--path <dir>] [--tag TAG ...] [--purpose TEXT]
jspace domain remove <id> [--purge]
jspace resource list [--json]
jspace resource add <id> --domain <id> (--path <abs> | --url <url>) [--tag TAG ...] [--notes TEXT]
jspace resource remove <id>
```

- `domain add`：默认 `path=workspace/<id>`；生成 `README.md` + `domain.json` 骨架（结构对齐现有 `agent-infra` / `jspace-dev`：domain.json 含 id/purpose/summary/tags，README.md 为中文标题 + 占位内容）；`purpose` 缺省给通用提示语，`summary` 缺省与 purpose 相同。**边界语义**：id 重复拒绝（写前校验挡）；`--path` 仅允许相对路径，且 resolve 后必须落在工作台根目录内（`../` 逃逸拒绝；绝对路径拒绝）——该包含性检查在生成骨架文件**之前**作为前置门执行（工作台外绝不落文件），并同时是 `validate_hub()` 的 error 规则（doctor 拦截手工编辑）；目标目录已存在时不覆盖已有 README.md/domain.json，仅追加 hub.json 记录并提示。
- `domain remove`：先检查 `resources[].domain` 引用，有引用则**拒绝删除**并列出引用资源 id（须先删资源）。默认只移除 hub.json 记录，**保留域目录**并提示；`--purge` 才删除目录（破坏性，依赖 git 回滚）。`--purge` 删除前 resolve 域目录并校验位于工作台根内，工作台外路径拒绝删除。
- `resource add` 校验：path 必须绝对路径；domain 必须已注册。**`--path` 自动置 `primary: true`**（单 entrypoint 下 primary 无信息量，PRD Q8）；CLI 不提供 `--primary` flag（PRD Q9 无兼容负担）。tags/notes 可选。**MVP 每个资源只支持单个 entrypoint**（多 entrypoint 属后续增强）；entrypoint id 默认与 kind 同名（`path` / `url`）。"URL entrypoint 不允许 primary"作为 schema 规则保留在 `validate_hub()`（拦截手工编辑）。
- `resource remove`：按 id 移除记录（不删任何外部路径/文件）。
- `--json` 输出供脚本消费；默认输出人类可读（对齐现有 CLI 的 `jspace: ...` 风格）。

## Contracts: id / output / format

- **id 规则**：domain 与 resource 的 id 均须匹配 `^[a-z0-9][a-z0-9-]*$`（小写字母、数字、连字符，首字符不能是连字符）。校验**统一实现于 `validate_hub()`**（error 级）：写命令经写前校验拦截，doctor 对手工编辑同样拦截，规则单一来源、无 CLI 层单独正则（PRD Q9：未上线，无历史 id 要容忍）。资源 `--domain` 引用同样由写前校验拦截。
- **remove 不存在 id**：报错 `no such domain: <id>` / `no such resource: <id>`，exit 1。
- **输出约定**：
  - 写操作成功：`jspace: ok: <摘要>`；失败：`jspace: error: <详情>`（stderr）+ exit 1（复用现有 `fail()` 风格）。
  - `--json` schema：
    - `domain list` → `{"domains": [{"id": ..., "path": ..., "tags": [...]}]}`
    - `resource list` → `{"resources": [{"id": ..., "type": ..., "domain": ..., "tags": [...], "entrypoints": [...]}]}`
  - 默认人类可读：一行一条（domain: `id  path`；resource: `id  domain  entrypoints`）。
- **hub.json 字段顺序稳定**（diff 友好）：**仅新建记录**按模板既有顺序构造对象——domains: `id/path/tags`；resources: `id/type/domain/tags/entrypoints/notes`；entrypoints: `id/kind/value/primary`（primary 仅 path entrypoint 携带）。已有记录按 `json.load` 的插入顺序原样回写，未知字段不丢弃、不归一化。
- **tag 处理**：`--tag` 可重复；去重、忽略空字符串。
- **域骨架 README.md 占位内容**：`# <id> domain` 标题 + 一段说明（"本域由 jspace domain add 创建，尚未填充内容；请按需补充管理方式/工作流。"）。

## Data Flow

```
registry = load(hub.json)   # 失败 → 报错退出（同 doctor 的 JSON 错误处理）
mutate(registry, args)
# domain add 专属前置门：--path 相对 + resolve 后在工作台根内（保护"生成文件"这一步本身）
domain add → 生成域骨架（README.md + domain.json；已存在则跳过）
errors, warnings = validate_hub(registry, root, [])   # 统一校验（含 id 格式、domain path 约束、primary 规则）
errors → 回滚本次新建的骨架文件/目录 + 打印全部错误 + 退出码 1，不写 hub.json
pass   → save(registry)     # json.dumps(indent=2, ensure_ascii=False) + trailing newline
```

> 时序说明：`validate_hub()` 会校验域的 README.md/domain.json 存在，因此 `domain add` 必须**先落骨架再校验**；校验失败时回滚本次创建的文件（仅本次创建的，已存在的不动）。包含性前置门保证任何文件生成都发生在工作台根内。

**warnings 不阻塞写**：写前校验只把 errors 当失败（重复 id、相对路径、无 primary path、未注册 domain 引用等）；warnings（如 primary path 不存在）允许写入——用于注册尚在创建中的路径，doctor 时再以 warning 呈现。

## Compatibility

首次开发、从未上线（PRD Q9）：**无兼容性负担**，不设迁移/弃用通道。

- hub.json `version` 维持常量 `"3"`，仅作 sanity 标记；无版本化承诺，版本化/升级机制推迟到 R7 分发。
- 写回格式 `indent=2, ensure_ascii=False` + 末尾换行：理由是 diff 友好与"人/AI 手工共编 hub.json"共存（未知字段保留见 Contracts），不是历史兼容。
- schema/CLI 若需调整，直接改模板 + `validate_hub()`；已生成的个人工作台重新 init 或手工对齐即可。
- `__DEV_ROOT__` 占位符仅在 init 时替换；registry 写命令不触碰占位符。

## Trade-offs

- **不做 resource update**（改 notes/tags/entrypoints）：MVP 只做增删查，真实需求涌现后再加。
- **MVP 单 entrypoint**：`resource add` 只支持单个 path/url entrypoint；多 entrypoint 属后续增强。
- **自动 primary、无 `--primary` flag**：单 entrypoint 下强制 `--primary` 是必错路径，故 `--path` 自动置位且不提供该 flag（PRD Q9 无兼容负担）；未来多 entrypoint 增强时再引入显式 primary 选择。
- **remove 不做级联删除**：保守方向，避免误删；`domain remove --purge` 是显式破坏性操作。
- **remove 无交互确认**：工作台可 git 同步，误删可回滚，CLI 保持可脚本化。
- **域骨架内容为占位**：`domain add` 生成通用模板，具体内容由用户在真实使用中填充（符合"域从真实使用中涌现"哲学）。

## Operational / Rollback

- 每次 CLI 改动后验证：`python3 -m py_compile bin/jspace` + smoke init/doctor + registry 演练。
- 提交分两块（CLI 功能 / 模板修正），任一步失败可单独 revert。
- 本任务不触碰 `skills/jspace-bootstrap/`（R5 保持 skill 方案）与 `.trellis/` 框架文件。
