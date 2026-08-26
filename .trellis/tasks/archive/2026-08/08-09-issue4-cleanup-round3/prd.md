# Code Review Round 3 收尾清扫(issue #4)

## Goal

关闭 issue #4 的 6 项收尾清扫,使三轮 code review 的所有发现 100% 关闭。
当前 HEAD `d143e79`,bun test 432/0 fail、tsc、Python 抽取、check-skills 全绿,基线健康。

## 需求来源

issue #4「Code Review Round 3: 收尾清扫(6 项)」,全部 6 项均已核实与代码现状一致。

## 子任务(独立可验证)

| child | 内容 | 类型 |
|---|---|---|
| 08-09-issue4-trivial-cleanup | 1/2/3:install.sh head 探测 + 2 处测试注释残留 | 轻量(PRD-only) |
| 08-09-issue4-linux-apply-port | 4:linux adapter `apply()` 接口地雷(方案 A:收缩端口删 apply) | 复杂(prd+design+implement) |
| 08-09-issue4-tests-dx | 5/6:linux applyBatch 空 enabled 直测 + 旧版本契约报错修复指引 | 复杂(prd+design+implement) |

## 执行顺序约束

- child2(接口收敛)先于 child3(applyBatch 直测 + seam):两者都改 `adapters/scheduler/linux.ts`,
  先删 apply 再在其上加 seam,避免同一文件双写冲突。
- child1 无依赖,可与 child2 并行;child3 依赖 child2 完成。

## 验收标准(跨 child 集成)

- [ ] `grep -n 'head -[0-9]' install/ scripts/ skills/` 无残留(全仓统一 `head -n N` 形式)
- [ ] `adapters/scheduler/types.ts` SchedulerAdapter 接口不再含 `apply()`;三个 adapter 编译通过
- [ ] linux adapter 唯一写 crontab 的安全路径是 `applyBatch`(含注释说明 whole-file 语义)
- [ ] 真实 linuxAdapter.applyBatch 空 enabled 清块与非空整块重建有直接测试(注入 seam,不触真实 crontab)
- [ ] 旧格式状态文件(version 字段)报错文案含修复指引(init/schema_version 字样),并有单测覆盖
- [ ] bun test 全绿、tsc 通过、check-skills 不回归
- [ ] issue #4 逐项勾选后关闭

## Notes

- 维持「无兼容性负担」原则:第 6 项只加报错文案,不引入迁移通道。
- 第 4 项确认无生产调用、无测试引用 apply(),收缩端口无外部行为影响。
