# Research: 死代码审计（未使用的导出 / 函数 / 文件 / 分支）

- **Query**: 扫描 TS 源（adapters/ application/ cli/ core/ scripts/，排除 *.test.ts 与 *generated.ts），找出未被引用的导出 / 函数 / 文件 / 分支。
- **Scope**: internal
- **Date**: 2026-08-06

## 方法

- 对每个非测试、非生成物的 TS 文件，提取全部 `export function/const/class`，grep 全仓（含测试）统计定义文件之外的引用次数。
- 对引用为 0 的符号逐一人工核实（排除「仅本文件使用」的内部 helper）。
- 模块级：用 import 图确认每个生产文件是否有 import 者（scripts/*.ts 为入口脚本，直接 `bun run`，不算死文件）。

## 结论一：模块级无死文件

import 图显示：`adapters/ application/ cli/ core/` 下每个生产文件都有至少一个 import 者。`scripts/*.ts`（build-all / check-skills / clean-bun-build / gen-assets / gen-version）全部被 package.json scripts 或彼此引用，均为入口脚本。**无整文件死代码。**

## 结论二：确认死导出（全仓零引用，含测试）

| 符号 | 位置 | 判断依据 | 建议 |
|---|---|---|---|
| `readAgentsFile` | `application/workspace/agents-block.ts:40-46` | 全仓 grep 只有定义处 1 处（无 import / 无调用，测试也未用） | **可安全删**（导出 + 函数体） |
| `writeAgentsFile` | `application/workspace/agents-block.ts:48-51` | 同上，零引用 | **可安全删** |

> 说明：`agents-block.ts` 其余函数（`extractAgentsBlock` / `replaceAgentsBlock` / `JSPACE_BLOCK_START/END` / `agentsPath`）均被 `workspace.ts`、`embed.ts`、测试使用。只有这两个文件级读写 helper 是迁移遗留死代码。

## 结论三：不必要的导出（仅本文件使用，非死代码但可收敛）

以下导出**没有任何外部 import 者**，只在定义文件内部使用。不是死代码，但导出无意义（`noUnusedLocals` 不会抓导出未用）：

| 符号 | 位置 | 说明 |
|---|---|---|
| `readHub` / `readLocal` | `adapters/fs/workbench-state.ts:55,57` | 仅在 :70 `readWorkbenchState` 内部使用 |
| `agentsRel` | `application/workspace/agents-block.ts:53` | 仅在 :59 `agentsPath` 内部使用 |
| `applyOps` | `application/automation/scheduler-service.ts:59` | 仅在 :91 `cronInstall` 内部使用 |
| `formatJson` | `adapters/fs/workbench-state.ts:75` | 仅在 :104/:147-148 内部使用 |
| `export { CONFIG_DIR }` | `application/workspace/init.ts:21` | 从 files.ts 引入后原样再导出；全仓无人从 init.ts import CONFIG_DIR |
| `openIncidents` | `application/automation/incidents.ts:92-94` | **仅测试**使用（`state.test.ts:10,44,49,72`）；生产侧 doctor.ts:153、status.ts:54 均内联 `readIncidents().records.filter(...)`，未走此函数 |

建议：以上可整体归「需确认」档。删除导出关键字（保留函数本体）即可收敛，行为零变化；`openIncidents` 属「仅测试消费的生产导出」，可改为测试本地 helper 或保留（语义清晰），拿不准就保留。

## 结论四：defensive 死分支 / 兼容分支（保留）

| 分支 | 位置 | 判断 |
|---|---|---|
| `migrateHubSchema` 的 `guard++ > 8` 循环上限 | `core/registry/migrations.ts:50-57` | 防死循环的通用保护，**保留** |
| `UPGRADE_ACTIONS` 含 `"delete"` | `core/contracts/upgrade.ts:22` | 注释明示「legacy alias, kept for decode compatibility」——升级 journal 是恢复关键数据，老 journal 可能含 `delete`，**保留**（解码兼容机制） |
| `workspaceUpgrade` 的 `remove` 分支 best-effort unlink | `application/workspace/workspace.ts:287-296` | 「file already gone」的容错，通用机制，**保留** |

## 结论五：空文件 / 占位文件 / 注释-only 文件

- 无空 TS 文件；无注释-only TS 文件。
- 唯一 <40 字节的跟踪文件是 `.trellis/.version`（6 字节，Trellis 元数据，正常）。
- 未发现占位符实现的假函数。

## 判定汇总（保守）

- **可安全删**：`readAgentsFile`（agents-block.ts:40）、`writeAgentsFile`（agents-block.ts:48）。
- **需确认**：5 处「仅本文件使用」的无意义导出（readHub/readLocal/agentsRel/applyOps/formatJson/CONFIG_DIR 再导出）、`openIncidents`（仅测试消费）。
- **保留**：所有 defensive 分支与解码兼容别名（见结论四）。
