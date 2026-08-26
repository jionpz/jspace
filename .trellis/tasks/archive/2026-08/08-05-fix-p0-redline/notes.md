# Notes · P0 红线中性化

## 已完成（2026-08-05）

**内容中性化**（已提交 `2260aac`，9 文件 23+/23-）：

- `GOAL.md`：M4 验收「30GB / 梯度公式 / 2 份真实资料 / 真实验收」→「12800 / 示例值 / 2 份示例资料 / 示例验收」；M2 ①「真实资料」→「示例资料」；office 扩展「真实验收」→「示例验收」。
- `skills/memory-recall/references/example-recall.md`：「那 30 个 G 的数据怎么搬?」→「那 12.8T…」；grep 值 30→12.8；「约 30GB 存量」→「约 12.8T 存量」。
- `skills/memory-recall/references/memory-acceptance.md`：canonical 查询 Q1'「那 30 个 G…」→「那 12.8T…」；「2 份真实资料」→「2 份示例资料」。
- `skills/jspace-bootstrap/references/example-bootstrap.md`：「放一份真实文件」→「放一份示例文件」；「某份真实资料.md」→「某份示例资料.md」。
- `skills/jspace-bootstrap/references/gbrain.md`：「真实验收通过」→「端到端验收通过」。
- 重跑 `gen-assets` 同步 `cli/assets.generated.ts` + `cli/manifest.generated.ts`。

**顺手修复新发现 P1**（用户批准，随 P0 提交）：
- `bunx tsc --noEmit` 主分支红（自 `d099422` 起，CI Type check 应为红）——评审遗漏（维度 4 只跑 bun test）。
- 修复：`application/workspace/manifest.ts:46` `DiffAction` 补 `"migrate"`；`workspace.ts:197` migrate 条目补 `reason`。
- 门禁恢复绿：`TSC_OK` + 267 测试全过 + gen-assets 确定性 gate 过。

## 验收核对

- [x] 工作区真实数据残留清零（grep `30GB|30 个 G|梯度公式|2 份真实资料|真实验收` 无命中；`example-ingest.md:4` 免责声明「不引用任何真实资料」属正向陈述，保留）
- [x] `cli/*.generated.ts` 与模板/示例同步
- [x] `bun test` 267 绿 + `tsc --noEmit` 绿
- [ ] 历史改写（见下）——**待全批 commit 后用户终端执行**

## 历史改写 runbook（延期执行，用户终端确认）

> ✅ **已完成（2026-08-05）**：filter-repo 重写 107→106 commits（fixture commit 因替换而吸收）+ force push origin/main + 8 tags 重指向。**补充发现**：历史中还有更早的「52期体验营 / 6988 元缴费」真实学员数据泄漏（2026-08-04 只改文件未改历史），已一并清除（新增 5 条替换规则：52期→某期 / 6988→12800 / 体验营→训练营 / 回访→跟进 / 缴费→费用）。重写后复扫 14 个敏感串全为 0，blob + commit message 均干净。**另发现**：P0/fix 任务漏网的 `skills/jspace-bootstrap/SKILL.md`「放一份真实文件」由替换规则顺带清除；重写后同步了 `cli/manifest.generated.ts` 的 SKILL.md hash（commit c11c53e，已 push）。
>
> **安全网**：本地镜像备份在 `/tmp/jspace-local-backup.git`（含改写前完整历史），确认远端无误后可删。

**原执行流程（已走完）**：
```bash
# 1. 备份（必做）
git clone --mirror /Users/jionpz/mycode/jspace /tmp/jspace-local-backup.git   # 从本地（含全部修复 commit）

# 2. 在全新克隆上重写（filter-repo 拒绝在有 origin 的仓库跑，故先 clone）
git clone --no-local /tmp/jspace-local-backup.git /tmp/jspace-rewrite2        # --no-local 避免硬链接被 filter-repo 拒绝

# 3. 替换规则（字面量替换，覆盖全部旧提交）
cat > /tmp/replace.txt <<'EOF'
30GB==>12.8T
那 30 个 G 的数据怎么搬?==>那 12.8T 的数据怎么搬?
梯度公式==>示例值
2 份真实资料==>2 份示例资料
某份真实资料.md==>某份示例资料.md
放一份真实文件==>放一份示例文件
真实验收==>端到端验收
jspace-work==>jworkspace
jspace-wb==>jworkspace
52期==>某期
6988==>12800
体验营==>训练营
回访==>跟进
缴费==>费用
EOF

# 4. 执行重写
git filter-repo --replace-text /tmp/replace.txt

# 5. 验证：以下应全部为空（无残留）
git log --all --oneline -S '30GB' | head  # ...14 个敏感串逐个 -S 扫描均为 0

# 6. 重新关联 origin 并 force push（红线：用户逐条确认后执行——已确认）
git remote add origin https://github.com/jionpz/jspace.git
git push --force origin main
git push --force --tags

# 7. 本地同步（force push 后 SHA 全变）
git fetch origin && git reset --hard origin/main
```
