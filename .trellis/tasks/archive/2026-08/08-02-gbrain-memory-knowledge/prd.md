# gbrain 记忆/知识分型轻量约定

## Goal

在 `skills/jspace-bootstrap/references/gbrain.md` 补充两节约定:type→记忆/知识映射 + 写回纪律。**不改 schema**——沿用现有 5 个 `type` 值,不新增 frontmatter 字段。

## Requirements

- 在 `Page frontmatter` 段之后新增 `## Page type semantics (memory vs knowledge)` 节:
  - 一张 type 映射表:`reference`/`lesson` = knowledge(append-only)、`decision`/`note` = memory(固定 slug 覆盖写)、`smoke` = discardable。
  - 明确 memory 与 knowledge 的判别:memory 描述当前状态,knowledge 不随时间失效。
  - 明确长文知识本体住文件中心,gbrain 知识页 = 摘要 + 指针,不是全文。
  - 明确检索取向:会话注入重近期记忆,问答重稳定知识。
- 新增 `## Write-back discipline` 节:
  - 状态性记忆:固定 slug、覆盖写(`project/<id>/state` 型),不造历史噪声。
  - 沉淀知识:append-only,新 lesson/reference/durable decision 是新页,不覆盖旧知识页。
  - 每条页带 `project` + `tags`,`source` 记出处。
  - slug 从 project/topic + 稳定标识派生,不随手发明。
  - 记忆事实沉淀为知识时,写新知识页,不把状态页写满。
- 内容为英文,与 gbrain.md 现有风格一致。
- 不改动 gbrain.md 其余任何内容。

## Constraints

- 不新增 frontmatter 字段、不改 `type` 枚举、不动 CLI。
- 对 gbrain"同 slug put 即 upsert"的假设在 bootstrap 时验证,不成立则修正此约定。

## Acceptance Criteria

- [ ] `Page frontmatter` 之后存在 `## Page type semantics (memory vs knowledge)` 节,含完整映射表。
- [ ] 存在 `## Write-back discipline` 节,含覆盖写与 append-only 两条纪律。
- [ ] 全文无新增字段/type 值;gbrain.md 其余段落与改动前一致。
- [ ] `gbrain.md` 仍为合法 Markdown,章节顺序合理。

## Key Decisions

- **轻量约定而非加正交字段**:gbrain 现有 `type`(reference/lesson/decision/note/smoke)已隐含区分记忆与知识;JSpace 架构中长文本体住文件中心、gbrain 只存事实与指针,故不需要 `kind: memory|knowledge` 字段。加字段是过度设计,且改数据契约、事后难迁移。
- **策略留给涌现**:检索权重、新鲜度衰减、归档规则等属于"填充物",等真实工作台(M2/M3)跑出检索需求再定。
