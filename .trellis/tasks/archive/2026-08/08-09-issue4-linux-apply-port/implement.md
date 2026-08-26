# issue4 linux apply() 接口收缩 — 实施清单

## 前置

- [ ] 确认当前无 active task(本 task 已创建,尚未 start)
- [ ] 基线:bun test 全绿 / tsc 通过(改动前快照,便于区分回归来源)

## 实施步骤(顺序执行)

1. **types.ts:65 删接口字段**
   - 删除 `apply(op: SchedulerOp, tag: string, root: string, env: SchedulerEnv): string[];`
   - `applyBatch` 注释保留(已说明 whole-file 语义)

2. **darwin.ts:145–163 → 模块级 `applyOne`**
   - 提取 `function applyOne(op, tag, root, env): string[]`(方法体原样)
   - `applyBatch` 改 `ops.flatMap((o) => applyOne(o, tag, root, env))`
   - 确认无 `this.apply` 残留

3. **win32.ts:125–136 → 模块级 `applyOne`**
   - 同上处理

4. **linux.ts:164–187 删 `apply` 方法**
   - 删除整个 `apply`(含 create/update/delete 分支)
   - 文件头注释补:managed block 唯一安全写入路径是 applyBatch
   - 确认 `parseManagedLine`/`extractTagBlock` 等被 `apply` 独用的工具仍被 `inspect`/`applyBatch` 使用(保留,不删)

5. **use-cases.test.ts:42–45 fakeAdapter 删 `apply`**
   - 删除 `apply: (op) => {...}` 属性
   - `applyBatch` 保留(内部已有 onApply 委托)

6. **静态验证**
   - `grep -rn '\.apply(' adapters/ application/ core/ --include='*.ts'` → 无直接调用残留
   - `bun test`(重点 use-cases.test.ts / scheduler.test.ts)
   - `bun run tsc`(或项目等价 tsc 命令,见 package.json)

## 提交

- 单 commit,message 风格:`fix(review): P2-x … (issue #4)` 对应此处
  `fix(review): issue4 收缩 SchedulerAdapter 端口,删 apply() 只留 applyBatch (issue #4)`

## Review gate

- [ ] grep 无 `.apply(` 直接调用
- [ ] darwin/win32 applyBatch 行为与改动前一致(测试通过即证)
- [ ] linux.ts 无 apply,唯一写入路径 applyBatch
- [ ] bun test 全绿 / tsc 通过
