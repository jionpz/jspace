# memory-recall — 召回纪律细则

纪律源 = `~/.agents/skills/memory-recall/references/memory-acceptance.md`（可复跑验收协议）。本文件把协议中经基线验收（2026-08-03 通过）的纪律固化为日常读侧操作细则；协议是**回归**，本文件是**日常**。

## 1. canonical 面约束

- 召回/重跑默认走 **CLI**（`gbrain query` / `gbrain get`），在 **serve 停泊窗口**内完成（gbrain serve 是某 harness 会话的 stdio 子进程，非独立 daemon；禁 `kill` serve、禁独立重启）。
- 真实使用面（MCP）在锁恢复后补一次 `query` 冒烟对齐。
- 重跑必须**同一 canonical 面**（CLI），否则证据不可比。

## 2. 防假阳性（校验）

- **变体查询**：同一个问题换个说法（语义同、词面不同）再问一次；候选页应保持 top-1。
- **负对照**：候选页外的无关页不得排到第一。
- 代价低时做；存疑/校准场景必做。

### 2b. 周快照劫持（query top-1 路由）

`weekly` tag 只隔离 **session 注入**,不隔离 `gbrain query`。语料 ≥200 页后,`records/consolidate/*` 常劫持「最近/上周/进展」类 query。

**处置（必做）**:
1. top-1 slug 匹配 `records/consolidate/*` 或 `records/retro/*` → **不得**把快照当答案。
2. `gbrain get` 读快照正文,找 wikilink / 项目名 / 明确事实指针。
3. 跳到源页(`project/*/state`、`decisions/`、`knowledge/`、`assets/`)再作答;答案引用**源 slug**,可注明「经由周快照 `<date>` 路由」。
4. 快照无明确指针 → 换更具体 query,或 `gbrain list --tag project` / `--tag knowledge` 缩小面后重问。

## 3. 指针断言链（四连过才算命中）

| 步 | 断言 | 命令 |
|---|---|---|
| ① | 取到 Pointer | `gbrain get <slug>` → 读 Pointer 字段 |
| ② | 文件存在 | `test -f "<Pointer>"` |
| ③ | 找到那个数 | 打开 / `grep "<关键词>" "<Pointer>"` ≥1 |
| ④ | top-1 一致 | `gbrain query` 输出 top-1 slug == 目标 slug |

- Pointer 是**绝对路径**（本机真理，按机维护）；换机/导入场景按 §8 用 `rel_path` 重解析。
- 四连全过才算该用例命中；任一断 → 回步骤 5 校准。

### 3b. 取代检查（decisions / knowledge 命中后 — 主流程必做）

- `gbrain get <slug>` 后检查 tags 是否含 `status:superseded`。
- 若已 superseded → 读正文 `Supersedes: [[...]]` wikilink，跟随到现行页再作答；答案标注「该条已被 X 取代」。
- 沿链走 ≤2 跳仍无 settled 页 → 上报用户「取代链未完成」,不得猜测。
- 若含 `status:archived` 或 `status:deprecated` → 默认不作为确定依据；仅在用户明确问历史时引用。
- 含 `status:provisional` → 可返回但须标注不确定。

## 4. 稳定性与双路径

- **日常召回**：不强制 ≥3 次重跑（那是验收协议）；仅在「存疑 / 校准」时按协议重跑。
- **双路径留证**：验收/回归用（`gbrain search <query>` 与 `gbrain query <query>` 各记录一次，证明语义层是否加分）；日常非强制。
- 基线经验（2026-08-03）：小语料（2 文档）下关键词路径已能命中，语义层不劣化但差异加分未凸显——**不得据此宣称语义层「必然加分」**；差异证据随语料增长验证。

## 5. 未命中诊断（有终止）

- **五类**：slug（页不存在/命名不一致）/ tags（检索面缺失）/ embedding 配置（不可达）/ 查询措辞 / 纪律缺口（写侧没按 M2 纪律入脑）。
- **处置**：仅纪律缺口才 REPO 修正并刷 JWorkspace；配置/措辞类**只记录**（ROI 护栏，不轻易改纪律）。
- **终止**：重跑 ≤3 轮，≥2 次稳定 top-1 才算过；3 轮未过 → 显式终态二选一：接受关键词降级记入验收文档 / 上报用户（扩语料、换 embedding 配置）。

## 6. embedding 降级

- 不可达 → `gbrain search` 关键词降级，**固定提示**「embedding 不可用，当前为关键词检索，中文命中率可能偏低」（不得静默）。
- 写侧纪律（不可达时 `embed_skip: true` 保写入成功）见 `~/.agents/skills/asset-ingest/references/gbrain-write.md`。
- 每次校准/重跑前重查可达性并留痕。

## 7. 与相关文档的关系

| 文档 | 角色 |
|---|---|
| `~/.agents/skills/memory-recall/references/memory-acceptance.md` | 可复跑验收协议（回归基准，本 skill 引用） |
| `~/.agents/skills/memory-recall/SKILL.md` | 日常流程（触发面 + 步骤） |
| `~/.agents/skills/asset-ingest/` | 写侧（入库 + 归位后自检）；读侧触发时如发现「页不存在/指针断」回写侧补 |

## 8. 换机解析（M5：指针可移植）

- **触发**：导入/换机后（如 `gbrain export` → 新机 `import`），reference 页的 `Pointer` 绝对路径指向旧机，不可直接 `test -f`。
- **解析规则**：读**当前机** `hub.json` 中 `type: filehub` resource 的 `primary: true` path entrypoint（= 本机 filehub 根）→ 根 + 页 frontmatter `rel_path`（相对 filehub 根的全相对路径）→ 得到本机 Pointer → 再走 §3 指针断言链。
- **字段**：`rel_path` 由写侧（asset-ingest）写页时产出；`Pointer`（绝对路径）保留为本机真理。
- **断言失败处置**：rel_path 解析失败（根读不到 / 文件缺失）→ 按 §5 诊断（纪律缺口? 资产未同步?）→ 报告用户（资产需同步到本机 filehub / 补 rel_path）。
- **回归**：换机解析作为新增断言入 `~/.agents/skills/memory-recall/references/memory-acceptance.md`（「换机解析扩展(M5)」节）；原四用例断言不变。
