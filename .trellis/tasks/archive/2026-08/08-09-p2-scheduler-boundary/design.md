# P2-1 scheduler applyOps linux 穿透下沉 —— design

## 背景

`scheduler-service.ts` 的 `applyOps` 对 linux 特判:直接 import `adapters/scheduler/linux.ts` 的 `crontabBlock`,用完整 enabled 集重建整块后单次 `adapter.apply(create)`;其它平台逐 op apply。这违反 hexagonal boundary:
- application 层 `import { crontabBlock } from "../../adapters/scheduler/linux.ts"`(application → adapter 内部 helper 穿透);
- application 知道「linux 是整块写入 crontab」这一平台细节;
- linux adapter 的 `buildContent` 因此只能返回占位 `cron.id`(注释自称 placeholder)。

## 方案对比

| 方案 | 形态 | 评价 |
|---|---|---|
| A-transparent(采纳) | `SchedulerAdapter` 增加批量 apply 端口;linux 在其内部重建整块;application 只调一个方法 | 符合现有端口哲学:buildContent/inspect/identity 均已下沉,apply 的「per-cron vs whole-block」是最后一个平台细节 |
| B-reconcile 端口 | 新增 `reconcile(desired, installed, applyOne)` 端口,由各 adapter 自决 per-cron/whole | 语义更强但引入第二个 reconcile 概念,与现有 `planReconciliation` 重叠,改动面更大 |

采纳 **A**:issue 推荐方向,且「inspect 返回 per-cron、whole-block 藏在 apply 内部」完全成立 —— 不改变 `planReconciliation` 的 per-cron 决策表与 inspect 形状。

## 端口形态

### 新增 `applyBatch`(必选)

```ts
// adapters/scheduler/types.ts — SchedulerAdapter
export interface SchedulerAdapter {
  ...
  /** Apply a batch of reconciliation ops. Default semantic: one op at a time
   *  (darwin/win32). A platform whose install is whole-file (linux crontab)
   *  re-derives its content from the full enabled set and applies once. */
  applyBatch(ops: SchedulerOp[], enabled: CronDefinition[], tag: string, root: string, env: SchedulerEnv): string[];
  ...
}
```

- **darwin / win32**:`applyBatch = (ops) => ops.flatMap((o) => this.apply(o, tag, root, env))` —— 行为与现状逐 op 完全一致。
- **linux**:忽略 op 细节,用 `crontabBlock(enabled, tag, root, env.jspaceBinary, env.path, env.home)` 重建整块(0 个 enabled → 空块),带 backup 单次 `replaceManagedBlock` + `writeCrontab`。语义:「以 enabled 集为准重建本 workbench 的 managed block」—— create/update/delete 天然都被覆盖(被 disable 的 cron 从 enabled 集消失 → 从 block 移除;全部 disabled → 空块 → 整块清除)。保留现有 delete-per-line 的替代实现吗?不需要:整块重建等价且更简单;唯一差异是 delete 单 op 时(如 disable 一个 cron)也整块重写,行为等价(目标 block 相同)。

### `buildContent` 去占位

linux 的 `buildContent` 不再返回 `cron.id`,改为返回该 cron 的**真实 crontab 单行**(复用单行生成逻辑)。为此把 `crontabBlock` 拆出单行 helper:

```ts
export function crontabLine(c: CronDefinition, tag: string, root: string, jspaceBin: string, path: string, home: string): string;
export function crontabBlock(crons, tag, root, jspaceBin, path, home): string; // 内部 map crontabLine
```

`buildContent(c, tag, root, env)` = `crontabLine(c, tag, root, env.jspaceBinary, env.path, env.home)`。这样:
- `buildDesired` 生成的 DesiredTask.content 携带真实 per-cron line(dry-run/调试有意义);
- `applyBatch` 忽略 content,用 enabled 重建整块 —— 两套内容来源职责清晰(per-cron 展示 / whole-block 落盘)。

### scheduler-service 简化

```ts
// 删除:import { crontabBlock }
// applyOps 整个删掉,改调用:
const results = deps.adapter.applyBatch(ops, enabled, deps.tag, root, deps.env);
```

`buildDesired` / `planReconciliation` / inspect 均不改(仍是 per-cron)。

## 交互正确性(逐场景)

| 场景 | desired | installed | ops | applyBatch(linux) |
|---|---|---|---|---|
| 首次 install 2 个 enabled cron | 2 | [] | 2 create | 重建含 2 行的整块 → block 写入 |
| 改 1 个 cron 的 schedule | 2 | 2(旧) | 1 update | 重建含新 schedule 的整块 → 覆盖 |
| disable 1 个 cron | 1 | 2 | 1 delete | 重建只含剩 1 行的整块 → 该行消失 |
| 全部 disabled | 0 | 2 | 2 delete | enabled=[] → 空块 → 整块清除 |
| dry-run | — | — | 展示 per-cron ops(不 apply) | 不变(applyBatch 不进 dry-run) |

darwin/win32 逐 op apply 行为与现状完全一致(回归面=0)。

## 兼容性 / 回滚

- 端口新增是 additive(现有 adapter 需补 applyBatch,三个平台一次性改齐,无中间态)。
- 行为回归点:verify.yml 的 cron install 整链(linux crontab 语法与 tag 解析不变,仅写盘路径从 applyOps 移到 applyBatch)。
- 回滚:单 commit 可整体 revert;端口变更不出现在任何持久化格式中。

## 验证

- `bun test` 全绿(重点:use-cases.test.ts cronInstall 各 distribution 分支、scheduler.test.ts)。
- `tsc --noEmit`。
- verify.yml 整链(若本机可跑 linux crontab 场景则实测;否则靠测试覆盖)。
- 新增用例(若测试层已有):单 cron enable 不影响 sibling;全部 disabled 整块清除(现有覆盖,不改语义)。
