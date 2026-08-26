# M5 模板去个人化 — 技术设计

## 架构与边界

中性化的对象是**模板**（`templates/workbench/`），不是 owner 已生成的工作台。改动后 `assets.generated.ts` 由构建脚本重新生成（模板 → 嵌入式树），随编译二进制分发。

| 层 | 改动 |
|---|---|
| 模板 `templates/workbench/` | 删两域、清 hub.json、AGENTS.md/README 中性化 |
| `skills/jspace-bootstrap/references/` | 清 owner 路径（cc-switch/代理/agent-infra 引用） |
| 构建产物 `cli/assets.generated.ts` | `bun run scripts/gen-assets.ts` 重新生成 |
| 编译二进制 | `bun run build` 重编译，交付物随 v1.0.1+ 发布 |

## 中性默认状态（目标）

```
templates/workbench/
  .gitignore
  .jspace/hub.json      → { version: 3, domains: [], resources: [] }
  .jspace/cron.json     → 保留（产品级默认三任务，不动）
  AGENTS.md             → 中性（无 jspace-dev/agent-infra/cc-switch/__DEV_ROOT__）
  README.md             → 中性（结构清单去掉两域，说明"初始无域，从真实使用涌现"）
  workspace/            → 移除（空）
  skills/jspace-bootstrap/ + skills/asset-ingest/   → 保留
```

## 关键决策

### 1. 空 workspace 作为中性默认
- hub.json 空数组：`validateHub` 的 forEach 跳过空数组，doctor 0 error（已核实 cli/registry.ts:87/147）。
- AGENTS.md「Initial domains」句改为：「初始无域。域从真实使用涌现（复现/有资源/有边界等信号满足时按 Domain Governance 创建）。」
- Modes 表删除 `Agent-infra domain` 行；`Agent-infra Workflow` 段整体删除。
- Domain Governance 举例 `docker`/`notes` 保留（中性举例，非 owner 内容）。

### 2. `__DEV_ROOT__` 从模板移除
- 删除后默认模板无占位符 → `materializeTree` 的替换对中性模板是 no-op，二进制安装的 `devRoot()=安装目录` 泄漏自然消失。
- `cli/embed.ts` 机制本身不动（保留给 owner 手动添加 dev-repo 链接 / 未来需要）。
- AGENTS.md「Development Mode」段、README「与开发仓库的关系」段：删除 `__DEV_ROOT__` 具体引用，改为通用表述（如「如需维护 JSpace 开发仓库，按其 AGENTS.md 流程操作」）。

### 3. gbrain 保留为产品记忆层
- AGENTS.md「First core - gbrain」保留（GOAL 四大支柱的记忆层设计），但删除「注册于 agent-infra」的域绑定。
- bootstrap skill 的 gbrain 安装/接线逻辑保留（它本身用 gbrain 标准路径，中性）。

### 4. bootstrap references 中性化
- `harnesses.md` cc-switch 段：删 owner 路径与 agent-infra 引用，改为「可选：用户自有 provider/代理管理（如 cc-switch）按用户环境配置」。
- `gbrain.md` Option C（cc-switch proxy 模型对齐）：删 owner 代理细节，改为中性占位说明或标注「按用户本地代理配置」。
- 逐文件 grep 确认无 `/Users/jionpz`、`cc-switch`、`agent-infra`、`jspace-dev`、`__DEV_ROOT__` 残留。

## 验证口径

- **源码 init**：`bun run cli/main.ts init /tmp/wb` → 工作台目录 grep 六个 owner 字符串 = 0 命中；`bun run cli/main.ts doctor --dir /tmp/wb` = 0 error。
- **二进制 init**：`bun run build` 后 `bin/jspace init /tmp/wb2`（默认 BIN_DIR 之外）→ 同上 grep = 0、doctor 0 error。
- **cron**：`bin/jspace cron list --dir /tmp/wb2` 列出默认三任务。
- **回归**：`bunx tsc --noEmit` 通过；`bun run scripts/gen-assets.ts` 产物干净。
- **owner 工作台不受影响**：不改动 `~/jspace-work` 等已生成目录。

## 兼容性 / 迁移

- hub.json schema 版本仍为 3（空数组合法，无需 bump）。
- 已有工作台（含 owner 的）不受影响——模板只影响未来 init。
- owner 如需恢复 dev-repo 链接：`jspace domain add jspace-dev --path workspace/jspace-dev` + `jspace resource add jspace ...`（或手工写 hub.json，doctor 校验）。

## 风险

- 中性化后 AGENTS.md 若残留对已删域的引用 → doctor 不报（域不存在不校验），但会造成 AI 路由困惑。故验收以 grep 零命中为准，不依赖 doctor 兜底。
- `assets.generated.ts` 是生成文件，若改模板后忘记重新生成，构建产物仍是旧模板 → 验收强制先重新生成再验证。
