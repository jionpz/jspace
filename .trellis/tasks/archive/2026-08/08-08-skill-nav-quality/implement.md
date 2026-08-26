# Implement — skill 导航质量：~/.agents/skills 统一物化 + 引用统一前缀

> 需求见 `prd.md`，设计见 `design.md`。方案 A 已拍板（多 harness：Claude/Grok/Pi/OpenCode）。

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun run scripts/check-skills.ts      # C1 新正则（新旧都查）
bun run scripts/gen-assets.ts && git diff --exit-code
```

## 步骤

### S1 · 物化命令 `jspace skills install`

- [x] S1.1 新建 `application/skills/install.ts`（纯逻辑，DI）：`installSkills(deps)`，
      源 = ASSETS `skills/<name>/` 前缀，目标 = `expandTilde("~/.agents/skills/<name>/")`，
      排除 `__pycache__`/点文件；create/skip（补缺不覆盖，对齐 harness-config `--ignore-existing`）
- [x] S1.2 `WireResult`-like 结果：每 skill 的 created/skipped 文件清单 + 将写目标（供 --dry-run）
- [x] S1.3 新建 `cli/commands/skills.ts`：`skillsSpec`，子命令 `install`，`--dry-run`，
      默认物化 workbench 4 skill（skills-manifest）
- [x] S1.4 注册进 `cli/commands/registry.ts`
- [x] S1.5 单测：create/skip 幂等、`__pycache__` 排除、重复执行 skip、`--dry-run` 不落盘
- [x] S1.6 `bunx tsc --noEmit && bun test`

### S2 · 引用重写（全仓库 ~80 处）

- [x] S2.1 先写脚本列出全部待改引用（`grep -rn 'references/\|\.\./' skills/ --include="*.md"`），
      按 design §3.1 表逐条映射；**排除** `../<workbench>-inbox/` 路径描述
- [x] S2.2 jspace-use：6 个 references + `../asset-ingest/references/gbrain-write.md` → `~/.agents/skills/...`
- [x] S2.3 asset-ingest：7 个 references → `~/.agents/skills/asset-ingest/...`
- [x] S2.4 memory-recall：3 references + `../asset-ingest/references/gbrain-write.md` + `../SKILL.md`
- [x] S2.5 memory-writeback：2 references + `../jspace-use/references/gbrain.md`×4 + `../asset-ingest/SKILL.md`×3 + `../SKILL.md`
- [x] S2.6 harness-config：2 references → `~/.agents/skills/harness-config/...`
- [x] S2.7 断言：`grep -rn '\`references/\|\`\.\./' skills/ --include="*.md"` 干净（无残留）

> **Review gate 1**：S2.7 grep 必须干净——残留 = 导航仍断。

### S3 · check-skills C1 更新

- [x] S3.1 新正则 `~/.agents/skills/<name>/<rest>` → 校验 repo `skills/<name>/<rest>` 存在
- [x] S3.2 **保留旧正则**：旧形态（`references/x.md` / `../<skill>/...`）命中即 fail（防残留）
- [x] S3.3 `bun run scripts/check-skills.ts` 通过

### S4 · 端到端验证

- [x] S4.1 `bun run cli/main.ts skills install --dir /tmp/<wb>`（注入 tmp HOME）→
      `~/.agents/skills/<name>/` 4 skill + references 齐
- [x] S4.2 重复执行 → 全 skip，幂等
- [x] S4.3 确认 `__pycache__` 未物化
- [x] S4.4 `grep -rn '\`references/\|\`\.\./'` 全仓库干净
- [x] S4.5 `check-skills` / `gen-assets` 幂等

### S5 · 真实会话验收（需用户）

- [x] S5.1 在 `workspace/<domain>/` 启动 claude → 调用 jspace-use → references 引用可解析（AC4）
- [x] S5.2 确认 Grok/Pi/OpenCode（如已装）读 skill 引用不依赖 CLAUDE_ 变量

> **Review gate 2**：S5.1 是唯一无法自动化的判据，收工前拿到确认。

### S6 · 收尾

- [x] S6.1 全套验证命令跑通；gen-assets 幂等
- [x] S6.2 仓库 PUBLIC：无真实路径（`~` 是机器无关占位；测试 fixture 用 tmp HOME）

## 不做

- 不改 references 内容本身（只改导航写法）
- 不引入 `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}`（方案 A 已否决 harness 特有变量）
- 不自动执行 `skills install`（显式命令；对齐 harness-config 自装语义）
- 不处理 `~/.agents/skills/` 的自动刷新（用户跑 `skills install`）

## 完成判据

`prd.md` AC1~AC6 全部勾选。AC4 需真实 claude 会话确认。
