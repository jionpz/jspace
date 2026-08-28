# FEBEL 父任务设计：推进策略与关闭口径

配套 `prd.md`（任务地图与交叉验收）。父任务不写业务代码；本文件裁决三件事：推进策略、什么算「关闭」、下一个 start 谁。

## 1. 推进策略

- **一次只 start 一个工程子任务**：F（PR #26 落地）→ E（doctor 习惯门禁）→ B 的 E 型交付（runbook / `/it` 合同单测 / linux adapter 审计）。每轮走完 gen-assets + 三 check 再进下一轮，避免 skills / 文档面互相踩。
- **协议类不占工程序列**：L / Eco 的 PRD 即协议终态，B 的 H/A 关闭同理；真机与真实使用窗口由用户触发，到期按各自回写槽回写，不阻塞工程推进。
- **父任务只有两个动作时点**：① 全部子任务终态后按 `implement.md` checklist 做集成审视；② 确认 L 持有的 M7 草案写入 `GOAL.md` 并归档全树。

## 2. 工程关闭 vs 使用关闭（本树统一口径）

| | 工程关闭（E 型） | 使用关闭（H / usage 型) |
|---|---|---|
| 凭据 | 代码 / 单测 / 文档 / CI 断言，可在本仓库复验 | 真实工作台或真机的命令输出、runs/logs、gbrain 页 |
| 谁能给出 | 任何代理 / CI | 只有真实使用者与真机 |
| 例 | doctor info 码 + 测试矩阵；`/it` 合同单测；真机触发 runbook 文档 | 连续两周 `source:session` > 0；crond/schtasks 钟点拉起；物理第二机 P0–P7 |
| 假绿红线 | 不得声称覆盖使用面（「已注册」≠「会被拉起」；「机制已建」≠「使用已发生」） | 不得用 CI / 模拟 / 伪造数据顶替；未达标就诚实挂账 |
| 中间态 | — | **替代关闭（A）**：允许写进 GOAL / PLATFORMS，但必须带效力边界句 + 「真机复核待…」脚注（B 的 Closing Taxonomy 是全树权威格式） |

推论：FEBEL 树的「完成」分两层——**工程层**（F、E、B 的 E 型）由代理闭环、检查全绿即完成；**使用层**（L 两周窗口、B ① 真实触发、Eco 真机演练）只等真实使用。父任务归档允许使用层以「协议就位 + 诚实挂账进 M7/GOAL」形态收口，这是设计内路径，不是失败。

## 3. 下一个 start：F（`08-27-febel-f-pr26-land`）

理由：

1. 唯一在途 PR（[#26](https://github.com/jionpz/jspace/pull/26)，OPEN / MERGEABLE），拖越久与 main 漂移、冲突成本越高。
2. 「技能列表硬编码 4 个」是当前用户可感知的错误陈述（实际 workbench 技能 7 个），修正优先级高于新增可见性。
3. F 与 E 都触碰 jspace-use / skill 投影面；F 先合，E 的口径改动（§6 登记新码、retro 检查 1 交叉引用）才有稳定基线。

前置：F 代理补全 `prd.md`（Requirements / AC 从 PR #26 diff 反推），随后 `task.py start` F。

## 4. 风险备忘

- F PRD 缺席不阻塞本轮交叉验收结论，但父任务**不得**在 F PRD 仍为 TBD 时进入集成审视。
- E 的码名 `memory.writeback_habit_unverified` 合入后即视为对 L 协议的稳定接口，改名需过父任务。
- B / Eco 长期无真机窗口时，父归档采用「A / 挂账」终态并在 M7 保留开放子项；禁止为归档赶工伪造证据。
