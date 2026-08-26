# Implement — 升级清理旧官方 skill 残留

任务上下文优先级:本文件 → `design.md` → `prd.md`。父 design D3 已定策略;本文件到文件粒度的步骤与门禁。**依赖 C1**(`skillRel`/`skillRoot` 已就位);本任务在 C1 之后实施。

## 1 diffBundle 拆 remove/stale(manifest.ts)

1. `DiffAction` 类型加 `"remove"`。
2. stale 分支(recorded-but-not-in-bundle)改为:
   ```ts
   for (const rel of Object.keys(deps.recorded)) {
     if (!manifest.files.some((f) => materializedRel(f.path) === rel)) {
       const cur = deps.readFile(join(root, rel));
       const unmodified = cur !== null && sha256Of(cur) === deps.recorded[rel]?.sha256;
       out.push({
         rel, ownership: "managed",
         action: unmodified ? "remove" : "stale",
         reason: unmodified ? "legacy seed copy, unmodified; removed on upgrade" : "locally modified; kept",
       });
     }
   }
   ```
   - 保留 `ownership: "managed"`?见注:remove 的 ownership 用于 upgrade plan 过滤——应允许 remove 无条件执行(不受 `--accept-conflicts` 限制),因此在 plan 过滤中显式放行 `action === "remove"`。
3. 更新 `application/workspace/manifest.test.ts`:
   - 现有「recorded but no longer in bundle -> stale」用例:fixture 里 recorded hash == 磁盘内容 → 断言 `remove`;加一个「磁盘内容 ≠ recorded」→ 断言 `stale`。
   - 补 `DiffAction` 类型导出(如需)。

## 2 升级执行 remove(workspace.ts)

4. `workspaceUpgrade` plan 过滤(第 172-181 行)加入:`e.action === "remove"` 无条件进 plan(不依赖 acceptConflicts)。
5. backup 循环(238-245)已覆盖 remove:对 remove 条目,`deps.readFile(join(root, rel))` 返回旧内容 → 备份到 before/ → journal.plan 记 `{action:"remove", rel}`(现有 plan.map 已含 action)。
6. 执行循环(253-266)对 `action === "remove"`:unlink;`pathByRel.get(e.rel)` 为 undefined → 需在 content 查找前分支处理:
   ```ts
   if (e.action === "remove") { try { unlinkSync(join(root, e.rel)); } catch { /* best-effort */ } continue; }
   ```
   (与 rollbackUpgrade 的 remove 恢复对称——rollback 对 remove 条目 restore before 备份,现有 143-146 已覆盖。)
7. `writeUpdatedMaterializedJournal(root, deps.manifest, new Set(plan.map(e => e.rel)))`:remove 的 rel 不在新 manifest → journal 更新后即消失,正确(不再记录)。

**门1**:`bun test application/workspace/workspace.test.ts application/workspace/manifest.test.ts` 绿。

## 3 legacy 测试反转 + 新增用例(workspace.test.ts)

8. 反转「legacy workbench: root skills/ becomes stale...」测试:fixture 旧 `skills/` 副本内容 == materialized journal 记录 hash → 升级后断言 `!existsSync(join(root, "skills", "jspace-bootstrap", "SKILL.md"))`(被清理),`.jspace/skills/` 仍就位;dry-run 断言 `[remove]`。
9. 新增「modified legacy copy kept」:旧 `skills/` 内容 ≠ recorded → 升级后仍在,diff 报 `stale`,且 `.jspace/skills/` 副本就位。
10. 新增「remove rollback restores」:构造含 remove 的 plan(真实 upgrade 后),执行 `workspaceUpgrade rollback <id>`,断言旧 `skills/` 文件恢复。

## 4 门禁

11. `bunx tsc --noEmit`、`bun test` 全绿;现有 hub/cron 用户数据保护用例仍绿(AC5)。
12. dry-run 演示(临时目录构造旧布局):
    ```bash
    # 构造 v1.0.5 布局 + materialized journal 后:
    bun run cli/main.ts workspace diff --dir /tmp/old-wb --json   # 期望 remove 条目
    bun run cli/main.ts workspace upgrade --dry-run --dir /tmp/old-wb
    ```
