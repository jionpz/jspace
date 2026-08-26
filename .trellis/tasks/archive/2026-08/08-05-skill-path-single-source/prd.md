# 运行时 skill 路径单一来源 — skillRel/skillRoot + 引用修正 + 测试

## Goal

官方 skill 移入 `.jspace/skills/` 后,`compileSkillTarget`(cron skill 校验)与 inbox-tidy 守卫仍查根 `skills/`(P0 bug:全新工作台 `cron install` / `cron run inbox-tidy` 直接失败)。本任务:新增 `skillRel`/`skillRoot` 单一来源函数,所有运行时 skill 路径引用改用它,消除「路径散落各处、改位置必然漏改」,并同步测试。

## Requirements

- **R1 单一来源**:`application/workspace/manifest.ts` 新增 `skillRel(name)`(工作台相对路径 `.jspace/skills/<name>`)与 `skillRoot(root, name)`(工作台根下的绝对路径);`materializedRel` 的 `skills/` 分支复用 `skillRel` 派生,避免双写。
- **R2 引用修正**:以下消费方改用它——
  - `application/automation/definitions.ts`:skillRoot 探测 SKILL.md、fix 文案、diff 前缀、prompt 路径。
  - `application/automation/execute.ts`:inbox-tidy 守卫的 skill 目录探测。
  - `application/registry/filehub.ts`:notes 文案 `skills/asset-ingest` → `.jspace/skills/asset-ingest`。
- **R3 测试同步**:`definitions.test.ts` fixture 与断言、`execute.test.ts` 守卫 fixture 改为 `.jspace/skills/` 路径;新增对 `skillRel`/`skillRoot` 的断言。

## Acceptance Criteria

- [ ] **AC1** `skillRel("jspace-bootstrap")` === `.jspace/skills/jspace-bootstrap`;`skillRoot(root, name)` === `join(root, skillRel(name))`;`materializedRel("skills/jspace-bootstrap/SKILL.md")` 仍为 `.jspace/skills/jspace-bootstrap/SKILL.md`。
- [ ] **AC2** `compileSkillTarget` 对全新工作台(仅 `.jspace/skills/` 存在)返回 ok,prompt 含 `.jspace/skills/<name>/SKILL.md`;fix 文案无 `skills/<name>` 残留。
- [ ] **AC3** `execute.ts` inbox-tidy 守卫在 `.jspace/skills/asset-ingest` 存在时放行、不存在时拒绝,报错文案指向 `.jspace/skills/`。
- [ ] **AC4** `filehub.ts` notes 文案为 `.jspace/skills/asset-ingest`。
- [ ] **AC5** 全仓库运行时(非测试、非 generated)代码 grep `skills/<name>`(不带 `.jspace` 前缀)无残留;`bun test`、`bunx tsc --noEmit` 全绿。

## Notes

- bundle key 保持 `skills/<name>/...` 不变(gen-assets 结构零改动);只统一「key → 工作台路径」的消费方。
- `skillRel`/`skillRoot` 放 `manifest.ts`(已承载 `materializedRel`,同一路径映射域);不要新开文件。
- 不引入新顶层目录;不 bump 版本(本任务纯代码修正)。
