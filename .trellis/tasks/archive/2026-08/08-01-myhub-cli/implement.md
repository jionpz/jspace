# Implement: JSpace CLI - registry 管理（R3）+ 模板修正（R8）

## 前置

- 任务 `task.py start` 进入 in_progress 后开始。
- 开工前跑 `trellis-before-dev` skill，读取 `.trellis/spec/` 的 backend 层规范与开发前清单。
- 只改：`bin/jspace`、`templates/workbench/AGENTS.md`（如需）。不触碰 `skills/jspace-bootstrap/`。

## Ordered Checklist

1. **registry 读写层**（`bin/jspace` 新增辅助函数）
   - `_load_registry(root)`：读 hub.json，JSONDecodeError → fail（复用现有错误输出风格）。
   - `_save_registry(root, data)`：`json.dumps(indent=2, ensure_ascii=False)` + trailing newline 写盘。
   - id 格式校验 `^[a-z0-9][a-z0-9-]*$` 与 domain path 约束（相对 + resolve 后在根内）**加进 `validate_hub()`**（error 级，domains[].id / resources[].id / domains[].path）；doctor 与写命令规则同源，无 CLI 层单独正则。
   - 仅**新建**记录按模板字段顺序构造对象（domains: id/path/tags；resources: id/type/domain/tags/entrypoints/notes；entrypoints: id/kind/value/primary）；已有记录按载入顺序原样回写（未知字段保留），保持 diff 稳定。

2. **domain 子命令**
   - `domain list [--json]`：打印 id + path（+ tags）；--json 输出 `{"domains": [...]}`。
   - `domain add <id> [--path] [--tag] [--purpose]`：默认 path=`workspace/<id>`；先做 `--path` 包含性**前置门**（相对路径且 resolve 后在工作台根内，`../` 逃逸拒绝——在生成任何文件之前执行，工作台外绝不落文件）；再生成 README.md + domain.json 骨架（summary 缺省与 purpose 相同；目标目录已存在时跳过文件生成，不覆盖）；`validate_hub()` 通过后写 hub.json，失败则回滚**本次新建**的骨架文件/目录（已存在的不动）。id 格式/重复由 validate_hub 拦截。
   - `domain remove <id> [--purge]`：不存在报错；检查 resources 引用（拒绝 + 列出引用）；默认保留域目录并提示，`--purge` 删目录（删除前校验目录 resolve 后位于工作台根内，纵深防御）。

3. **resource 子命令**
   - `resource list [--json]`：打印 id + domain + entrypoints；--json 输出 `{"resources": [...]}`。
   - `resource add <id> --domain <id> (--path | --url) [--tag] [--notes]`：`--path` 自动置 `primary: true`（CLI 不提供 `--primary` flag）；entrypoint id 默认与 kind 同名（`path` / `url`）；id 格式、绝对路径、domain 引用、URL 禁 primary 均由写前 `validate_hub()` 拦截。
   - `resource remove <id>`：不存在报错；按 id 移除。

4. **写前校验接入**：所有 add/remove 在内存 mutate 后调用 `validate_hub()`（含新增的 id 格式、domain path 约束——规则单一来源）；errors 非空 → 打印全部错误 + exit 1，不写 hub.json，并回滚本次新建的骨架文件；warnings 不阻塞写（允许注册尚不存在的路径）。`domain add` 的路径包含性前置门是唯一的 CLI 侧独立检查（理由见 design Data Flow 时序说明）。

5. **模板修正（R8）** `templates/workbench/AGENTS.md`（三处悬空引用 + 退出通道）
   - Durable Knowledge Routing 表：`.trellis/tasks/<task>/` 行 → gbrain 持久事实 + 域 runbook（工作台无任务管理）。
   - Confirmation Rules："outside the active Trellis task scope" → 工作台无任务管理，改为注册表/文档变更遵循工作台 AGENTS.md 自身规则。
   - Quality Checks："Do not add task-management concepts that duplicate Trellis" → 不引入工作台任务管理概念。
   - 退出通道：README.md 或 AGENTS.md 注明"如需任务管理可在工作台运行 `trellis init`"。
   - line 35 / 140（指向开发仓库 Trellis）与 hub.json/domain.json 的 trellis 标签保留不动。

6. **开发仓库 AGENTS.md**：Development Workflow 验证段补充 registry 命令验证步骤（如适用）。

7. **测试与验证**（见下）。

## Validation Commands

```bash
# 1. 编译
python3 -m py_compile bin/jspace

# 2. 干净初始化 + doctor
rm -rf /tmp/jspace-smoke
bin/jspace init /tmp/jspace-smoke
bin/jspace doctor --dir /tmp/jspace-smoke        # 期望 0 error

# 3. registry 演练（在 /tmp/jspace-smoke 内）
cd /tmp/jspace-smoke
J=/Users/jionpz/mycode/jspace/bin/jspace
$J domain list --json                                          # 期望：{"domains":[...]}
$J domain add docker --purpose "Docker 与容器编排管理"           # 期望生成 workspace/docker/
$J doctor --dir .                                               # 0 error
$J domain add docker                                            # 期望失败：重复 id
$J domain add Bad_Id                                            # 期望失败：非法 id（validate_hub 拦截，无骨架残留）
$J domain add esc --path ../esc                                 # 期望失败：路径逃逸（前置门拦截，工作台外无文件）
$J domain add esc --path workspace/../../esc                    # 期望失败：路径逃逸（resolve 后在根外）
$J domain add tmp --path workspace/tmp                          # 期望成功：自定义相对路径
$J resource add my-app --domain docker --path /tmp/my-app       # 期望成功；entrypoint 自动 primary: true
$J resource add bad1 --domain nope --path /x                    # 期望失败：未注册 domain
$J resource add bad2 --domain docker --path relative/path       # 期望失败：相对路径
$J doctor --dir .                                               # 0 error（/tmp/my-app 缺失仅 warning）
$J domain remove docker                                         # 期望拒绝（my-app 引用）
$J domain remove nope                                           # 期望失败：no such domain
$J resource remove my-app
$J domain remove docker                                         # 期望成功（目录保留 + 提示）
$J domain add docker                                            # 期望成功；已存在的 README.md/domain.json 不被覆盖（内容不变）
$J domain remove tmp --purge                                    # 期望删除 workspace/tmp/
$J resource list --json                                        # 期望：{"resources":[...]} 含预期字段
$J doctor --dir .                                               # 仍 0 error

# 4. doctor 拦截手工编辑（规则同源验证）
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path('hub.json'); d = json.loads(p.read_text())
d['domains'].append({'id': 'Bad_Id', 'path': 'workspace/nope'})
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
EOF
$J doctor --dir .                                               # 期望 error（含非法 id）
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path('hub.json'); d = json.loads(p.read_text())
d['domains'] = [x for x in d['domains'] if x['id'] != 'Bad_Id']
p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
EOF
$J doctor --dir .                                               # 恢复后 0 error
```

## Risk Files / Rollback Points

| 文件 | 风险 | 回滚 |
|---|---|---|
| `bin/jspace` | 核心改动；parser/handler/校验回归 | 每步 py_compile + smoke；git commit 分块 |
| `templates/workbench/AGENTS.md` | 模板文本修正影响生成内容 | init 后 diff 确认；单块 revert |
| hub.json 写回格式 | 与手工维护格式不一致破坏 diff | `git diff` 对比模板/现有工作台格式 |

## Follow-up (non-blocking)

- 独立任务：R4 cron 管理（系统调度 + harness 无头执行）。
- 后续增强：resource update、R7 分发打包。
