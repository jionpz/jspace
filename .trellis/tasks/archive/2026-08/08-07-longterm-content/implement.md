# Implement — 内容对齐长期使用

> 子任务 C of `08-06-workbench-context-wiring`。设计见 `design.md`，需求见 `prd.md`。
>
> **启动前置（硬性）**：子任务 A 与 B 均已验收。
> - A 未完成就删 `Skill Governance` 渲染块 → skill 彻底失联
> - B 未定稿就写第 3 章 → 措辞指向不存在的块名
>
> 启动时先核对：`.claude/skills/` 已物化（A）、`jspace context` 已可用（B）。

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun run scripts/check-skills.ts                        # C1-C4 契约
bun run scripts/gen-assets.ts && git diff --exit-code
bun run cli/main.ts doctor --dir ~/jspace-work
```

## 步骤

### S1 · gbrain 依赖验证（**阻断性，先做**）

- [x] S1.1 确认 gbrain 解析的是哪个文件（工作台 `AGENTS.md` / `~/.agents/agents.md` / 其它）
- [x] S1.2 确认它解析的是 `<!-- TRELLIS-BRAIN-OPS -->` 标记块还是 `## Brain operations` 标题段
- [x] S1.3 确认 gbrain 能否改从 `.claude/skills/*/SKILL.md` frontmatter 读取（`design.md` O1）
- [x] S1.4 结论写进 `design.md` §2

> **Review gate 1**：S1.1-S1.3 任一未确认 → `Brain operations` 段**维持原样**，
> 只在本文件记录待办。**不允许"应该没问题"式的删除**——它是外部工具的依赖。

### S2 · AGENTS.md 瘦身

- [x] S2.1 按 `design.md` §1 表格逐段处理 `templates/workbench/AGENTS.md` 的 JSPACE 块
- [x] S2.2 移除 `Skill Governance` 渲染块；`scripts/skill-frontmatter.ts` 的渲染函数同步调整
      （它同时渲染两个块，只改一个会破坏另一个）
- [x] S2.3 `scripts/check-skills.ts` 的 **C3 契约同步修改**——
      现契约是"Brain operations / Skill Governance 的 skill 集合 == skills-manifest"，
      移除一个块后需改为只校验剩下的那个，否则 CI 红
- [x] S2.4 下沉的内容（Development Mode、Registry Access 的 jq 用法）
      写进 `skills/jspace-use/SKILL.md` 第 8 章 / `references/registry.md`，
      **确认信息没有丢失**，只是换了位置
- [x] S2.5 `bun run scripts/gen-assets.ts && bun run scripts/check-skills.ts`
- [x] S2.6 记录瘦身前后行数（当前 111 行）

**回滚点 R-S2**：内容改动全在 git 里，`git checkout` 单文件即可回退。

### S3 · jspace-use 第 3 章重写

- [x] S3.1 按 `design.md` §3 重写「日常会话路由」，四个场景各一小段
- [x] S3.2 **块名与子任务 B 的实际实现核对**——跑
      `bun run cli/main.ts context session-start --plain --dir ~/jspace-work`
      看真实输出，措辞照实写，不照设计稿写
- [x] S3.3 保持"不复制、只指引"纪律（第 7 章既有约定），不把 AGENTS.md 的规则搬过来
- [x] S3.4 评估 skill 正文内部引用的导航质量：skill 正文用 CWD 相对引用
      `` `references/x.md` ``（`skills/jspace-use/SKILL.md:51,63,136` 等），
      从子目录调用时 Claude 按 CWD 解析会找不到。**已实测确认**：从 `workspace/acme/` 启动，
      CWD 解析到 `workspace/acme/references/gbrain.md`（不存在）。官方最佳实践是
      `${CLAUDE_SKILL_DIR}/references/...`。**决策：改造记独立任务**——涉及 76 处反引号引用
      （jspace-use 24 + 其余 3 skill 52）+ 跨 skill 引用策略 + C1 正则更新，与 C 核心交付正交，
      不塞进本任务。跨 skill 引用（`../<skill>/references/x.md`）用 `${CLAUDE_SKILL_DIR}`
      无法表达，需先定策略（独立任务的前置调研）。
- [x] S3.4 `bun run scripts/check-skills.ts`（C1 references 检查相对引用可解析）

### S4 · 退役与回收小节

- [x] S4.1 `skills/jspace-use/SKILL.md` 新增 8.6「退役与回收」，
      结构与 8.1 建域规则对称（信号 / 禁区 / 确定度 / 动作）
- [x] S4.2 四类对象按 `design.md` §4 表格写；**每条动作都标注需用户确认**
- [x] S4.3 补 filehub 结项归档动线（`archive/<年>/`），并在
      `templates/filehub/README.md` 或 `asset-ingest` 侧确认动线不冲突
- [x] S4.4 第 3 章「每周体检」与本节互相引用（入口 → 规则）

### S5 · doctor 体检诊断

- [x] S5.1 **先确认 `resource.primary_missing` 是否已有实现**（`design.md` §5），
      已有则不重复造，只补另外两条
- [x] S5.2 实现 `domain.dormant`（90 天）、`filehub.project_stale`（120 天），
      severity 一律 `info`
- [x] S5.3 阈值定义为具名常量，便于日后调整；注释说明为何取保守值
      （mtime 会被 git clone / 网盘同步重写）
- [x] S5.4 `application/workspace/doctor.test.ts` 补用例：命中 / 未命中 / 边界
- [x] S5.5 `bun test`

> **Review gate 2**：在**干净的**新建工作台上跑 `doctor`，
> 确认三条 info 诊断**一条都不报**。日常噪音是这类诊断最大的失败模式。

### S6 · 收尾

- [x] S6.1 全套验证命令跑通
- [x] S6.2 `bun run cli/main.ts doctor --dir ~/jspace-work` 人眼确认输出可读、无噪音
- [x] S6.3 检查新增内容无真实个人/项目数据（仓库 PUBLIC，AC-C8）
- [x] S6.4 父任务 AC8 复核：JSPACE 块行数下降 **且** gbrain 路由实测仍正常
- [x] S6.5 回填父任务 `prd.md` 的 AC 勾选状态，交还父任务做集成审查

## 不做

- 不做自动写回（子任务 B 的 D3 已定，本轮不虚报该能力）
- 不给 doctor 引入 gbrain 依赖（`project/<id>/state` 陈旧检测因此不做，见 `design.md` O2）
- 不自动执行任何退役动作（只给规则与诊断）
- 不改物化路径与 hook 机制（A/B 范围）

## 完成判据

`prd.md` 的 AC-C1 ~ AC-C8 全部勾选。其中 AC-C2（gbrain 路由实测仍正常）
必须有实际验证记录，不接受推断。
