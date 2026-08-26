# 执行：cron 子系统收敛

## 前置

- [x] prd.md（含 Req 10 层环修复）
- [x] design.md（C1–C9）
- [ ] **G0：用户审阅 prd/design 通过 → `task.py start`** ← 门禁

## Checklist（按依赖顺序）

### 阶段 1：层环（C1）— 纯移动，先做，单独验证
- [ ] 新建 `adapters/scheduler/schedule.ts`（ScheduleDict + parseSchedule 逐字搬移）
- [ ] types.ts / linux.ts / win32.ts 改 import `./schedule.ts`
- [ ] definitions.ts 删本地定义 → 从 `../../adapters/scheduler/schedule.ts` 导入 + re-export
- [ ] `grep -rn 'from "../../application' adapters/scheduler/` → 空
- [ ] `bunx tsc --noEmit` + `bun test` 绿（此步即验证移动无回归）

### 阶段 2：win32 argv（C2）+ linux inspect（C3）+ win32 XML（C4）
- [ ] C2：registry.ts contentFor win32 `JSON.stringify(args)`；win32.apply `parseOpContent`（JSON.parse）
- [ ] C3：`parseManagedLine` 纯函数 + linux.inspect 接入；修 tag 下标
- [ ] C4：`parseSchtasksXml` 纯函数 + win32.inspect 接入（`/query /xml`）
- [ ] 补 fixture 测试（含空格路径往返、DAILY/WEEKLY、tag 匹配/不匹配、坏输入）
- [ ] tsc + bun test 绿

### 阶段 3：delete-only / 全禁用（C5）
- [ ] registry.ts linux apply：enabled 改 `data.crons.filter(c => c.enabled)`
- [ ] use-cases.ts：删 `enabled.length === 0` early-return
- [ ] 补测试：全禁用 + stub inspect 有已装任务 → 产出 delete ops 且 apply 被调
- [ ] tsc + bun test 绿

### 阶段 4：doctor/提示 tag-scoped + 删 legacy（C6）
- [ ] 新建 `cli/scheduler.ts`（schedulerEnv/workbenchTagFor/installedCronIdsForRoot/cronIsInstalledForRoot）
- [ ] registry.ts：cronDeps.installedCronIds → installedCronIdsForRoot；install/uninstall 用 workbenchTagFor + schedulerEnv；add/remove 提示用 cronIsInstalledForRoot
- [ ] 删 cli/cron.ts legacy helpers（plistPath/plistExists/installedPlists/shortHash/installedCronIds）
- [ ] doctor.ts stale 消息去硬编码
- [ ] tsc + bun test 绿（确认 cli/cron.test.ts 未破）

### 阶段 5：darwin env.home（C7）+ cron.json 原子写（C8）+ unknown tag（C9 已并入 C6 workbenchTagFor）
- [ ] C7：darwin plistPath/listPlists/plistSchedule/plistArgv 穿 env.home
- [ ] C8：saveCrons → writeBytesAtomic
- [ ] 补 darwin plistPath/parsePlistName 测试
- [ ] tsc + bun test 绿

### 阶段 6：收尾验证（门禁 G1–G3）
- [ ] `bunx tsc --noEmit` 绿
- [ ] `bun test` 全绿
- [ ] `grep -rn 'from "../../application' adapters/scheduler/` 空（层环）
- [ ] `git status` 变更仅限预期文件；review diff
- [ ] 提交（commit 信息按 repo 惯例）
- [ ] 更新任务 notes；用户审阅后 `task.py finish`

## 验证命令

```bash
bunx tsc --noEmit
bun test
grep -rn 'from "../../application' adapters/scheduler/   # 应无输出
bun run cli/main.ts cron install --dry-run --dir <tmp-wb> # 冒烟（darwin 本机）
```

## 门禁

- **G0**：prd/design 用户审阅通过才 start。
- **G1**：阶段 1（层环）单独 tsc+test 绿后才进入阶段 2。
- **G2**：全部阶段完成，tsc + bun test 全绿，无 adapters→application 反向 import。
- **G3**：变更仅限预期文件（scheduler 相关），diff review 后提交。

## 风险

- win32 XML 解析无法本机真机验证 → 纯函数 fixture 兜底 + 标注需 Windows 真机回归；解析失败保守回退 update op（不破坏安装）。
- 删除 legacy helper 若被未 grep 到的消费方引用 → tsc 立即暴露，回滚单文件。
- 全禁用改行为（install 现在会卸载已装任务）→ 属 prd 明确要求；变更在 release notes / notes 标注。
