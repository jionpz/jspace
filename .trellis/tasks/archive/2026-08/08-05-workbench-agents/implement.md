# workbench agents 约定 — 执行计划(轻量)

## Checklist

- [x] `templates/workbench/AGENTS.md` 新增 `## Agents` 段(插在 Workspace Upgrade & Ownership 之后):声明式语义 + 三层归属表 + 项目级继承指针 + 对象标签格式模板 + 引用「Approved workbench skills」(不重复)。
- [x] 范围控制:只改工作台模板 AGENTS.md;未触碰 `~/.agents/agents.md`、README、各 harness agent 文件。
- [x] 不新增渲染区:对象标签格式为静态约定;工作台能力引用既有 skill 块,防双源 drift。
- [x] `bun run scripts/gen-assets.ts` 再生 + 幂等验证(`git diff cli/` 二次不变)。
- [x] `bun test` 全绿(267 pass / 0 fail)。
- [x] 冒烟:新 init 工作台含 `## Agents` 段;「Brain operations」/「Approved workbench skills」渲染区字节不变;`jspace doctor` ok。
- [x] 提交。

## 验证命令

```bash
bun test
bun run scripts/gen-assets.ts && git diff cli/   # 幂等
# 冒烟:jspace init 临时目录 → grep '^## Agents' AGENTS.md
```
