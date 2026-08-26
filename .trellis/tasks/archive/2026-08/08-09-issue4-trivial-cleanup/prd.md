# issue4 清理组:head/注释残留(1/2/3)

## Goal

三项纯文本级收尾,全部 1 行改动,无行为变更。issue #4 的 1/2/3。

## Requirements

1. **install.sh:161 musl 探测 `head -1` → `head -n 1`**。
   第 50 行已在 issue #2 修好(`expected_hash` 内 `head -n 1`),同文件 161 行未同步,两处不一致。
   定位:`install/install.sh:161` `ldd --version 2>&1 | head -1 | grep -qi musl`。

2. **`core/contracts/distribution.test.ts:3` 删 "belong to Child B" 注释**。
   "Child A/B" 是早期任务拆分内部代号,已从 `distribution.ts` 清理(issue #3 P2-5),测试文件遗漏。
   改为指向真实归属,例如 "This file tests the distribution manifest schema; see core/contracts/distribution.ts"。

3. **`core/contracts/hub.test.ts:1` 文件头 "hub v4" 注释更新**。
   schema 已统一到 `schema_version: 1`(issue #3 P2-2),类型名 `HubV4` 是历史命名保留。
   注释改为:"hub contract tests — schema_version 1 (the HubV4 type name is a legacy identifier kept for code history; the schema field is schema_version: 1)"。

## 额外发现(需决策,超出 issue 预期)

issue 提示词「grep -n 'head -[0-9]' install/ scripts/ skills/ 全仓确认无第三处」——实际 `scripts/check-ac1.sh`
有 3 处 `head -N`(head -5/-5/-10)。这些是开发自检脚本(非分发脚本),GNU/BSD head 均支持数字直连写法,
严格 POSIX 需求弱。**决策:一并改为 `head -n N`**,与全仓统一,消除下次 review 同类告警(3 行,零风险)。

## Acceptance Criteria

- [ ] `install/install.sh:161` 用 `head -n 1`,与 50 行一致
- [ ] `grep -n 'head -[0-9]' install/ scripts/ skills/` 无任何匹配(全仓统一 `-n` 形式)
- [ ] `distribution.test.ts:3` 无 "Child B";`hub.test.ts:1` 无 "hub v4" 误导性措辞
- [ ] bun test 全绿(注释改动不触发,但作为回归门禁)

## Notes

- 纯文本改动,不提交行为逻辑。不引入新测试。
- 属轻量任务,PRD-only,不建 design/implement。
