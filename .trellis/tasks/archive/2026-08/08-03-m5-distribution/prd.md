# M5 分发

## Goal

完成分发(R7):**模板去个人化 + 打包安装已提前落地**(v1.0.1 去个人化 / v1.0.0·v1.0.2 一键安装 + `jspace update` 自更新 / CI 6 平台构建全绿),本任务收敛为**多机演练**——验证「换一台机器:git 拉工作台、资产同步、记忆重建索引、继续工作」完整闭环,关闭 GOAL 开放问题 #1(双机重建冒烟),产出「指针是否改机器无关表示」的结论并落地。

## Confirmed Facts(证据)

- **已拉前的 M5 项**:模板去个人化(`c0a5a7e`,v1.0.1)、一键安装 `install/install.sh` + `install.ps1`(`478025e`+fix,v1.0.0)、`jspace update` 自更新(`635fa43`,v1.0.2)、GitHub Actions 6 平台构建全绿。
- **gbrain 原生支持文本规范源**(开放问题 #1 的机制前提已具备):
  - `gbrain export [--dir]` 导出 markdown 文本页;
  - `gbrain import <dir> [--no-embed]` 导入文本页;
  - `gbrain sync [--repo]` 仓库增量同步,`--missing-path skip` 把「本机缺失 local_path 的来源」分类为 skipped 而非 failed;
  - `gbrain embed --all|--stale` 重建/刷新 embedding;
  - `gbrain migrate --to <engine>` 引擎迁移。
  - ⚠️ **图谱边/backlink 是否随 export/import 保留待演练验证**(机制前提的关键未知项)。
- **指针现状**:reference 页 `**Pointer:**` = 文件**绝对路径**(如 `/Users/jionpz/filehub/...`);换机时该路径不可解析。
- **记忆层假设**(gbrain 以文本页为规范源,DB/embedding 为派生、每机可重建)尚未做双机验证——即本任务核心。
- **本机状态(M4 后)**:真实 JWorkspace `/Users/jionpz/jspace-work`(hub 含 owner 域 + filehub 注册)、filehub `/Users/jionpz/filehub`(已含 M4 归位的 2 份资料 + index)、gbrain `~/.gbrain`(embedding=SiliconFlow bge-m3 曾用,现为 openrouter BAAI/bge-m3 可达)、M4 已锁纪律(asset-ingest 写页模板 / memory-recall discipline)。

## Requirements

- **R1 双机重建冒烟(开放问题 #1)**:本机模拟机器 B(独立 JWorkspace + 独立 gbrain brain `~/.gbrain-b` + 复制 filehub),验证完整闭环:
  1. 机器 A `gbrain export` 导出文本页(规范源);
  2. 机器 B `gbrain init` → `import` 导入文本页 → **验证图谱边/backlink 回灌**;
  3. `gbrain embed --all` 重建 embedding(可达 provider);
  4. **指针换机解析**:B 按「机器 B filehub 根 + rel_path」重解析 Pointer;
  5. 中文召回冒烟:B 上 `gbrain query` 四条规范查询 top-1 与 A 一致;
  6. 继续工作闭环:B 上经 workbench + memory-recall skill「问一句」,答案引用**机器 B 路径**。
- **R2 指针方案落地**:reference 页新增 frontmatter `rel_path`(相对 filehub 根的机器无关路径),保留 `Pointer` 绝对路径;换机解析规则 = 读目标机 `hub.json` 的 `type: filehub` primary path + `rel_path` 拼接。更新:
  - `skills/asset-ingest/references/gbrain-write.md`(写页模板加 rel_path 字段);
  - `skills/asset-ingest/SKILL.md`(写页步骤计算 rel_path);
  - `skills/memory-recall/references/discipline.md`(指针断言适配换机重解析;日常仍用 Pointer)。
  - **授权纪律修订**(M4 同款):以上为 M2/M4 已锁纪律的扩展,授权落 REPO 源 + 刷 JWorkspace。
- **R3 演练环境 = 本机模拟双机(用户已定)**:机器 A = 真实;机器 B = `~/jspace-work-b`(init 新工作台)+ `~/.gbrain-b`(独立 brain)+ `~/filehub-b`(复制 A 的 filehub,路径前缀不同以验证指针)。真实第二机留待实际使用。
- **R4(可选,不阻塞)CI Linux cron 冒烟**:CI Linux 容器跑一次 `jspace cron install` + `run` 冒烟,补「cron 调度后端可运行」证据(仅当 CI 改动成本低)。真机验证不纳入 M5 主任务(Q2 已决)。
- **R5 不回归**:A 侧 `Pointer` 绝对路径保留、日常召回可用;M4 验收协议 `docs/MEMORY-ACCEPTANCE.md` 不因 rel_path 破坏(换机解析作为新增断言,原断言不变)。

## Acceptance Criteria

- [ ] 双机演练闭环跑通:B 侧 import 后图谱边/backlink 保留(或明确记录丢失并给结论);embedding 重建后可中文召回。
- [ ] B 侧四条规范查询(Q1/Q1'/Q2/Q2')top-1 与 A 侧一致;「问一句」经 skill 引用机器 B 路径。
- [ ] 指针方案:reference 页含 `rel_path`;B 侧按「hub.json filehub 根 + rel_path」重解析成功;A 侧 Pointer 绝对路径仍有效。
- [ ] 纪律修订落 REPO(asset-ingest 写页模板 + memory-recall discipline)+ JWorkspace 同步(diff 无差异 + doctor 通过)。
- [ ] 结论落档:GOAL 开放问题 #1 关闭(结论 = 记忆层可移植假设成立/不成立 + 指针方案采用/回退),真实证据在任务 notes + JWorkspace(REPO 侧中性)。
- [ ] 演练全程 gbrain 锁时序遵守(A 侧 serve 停泊窗口内导出/对照;禁 kill serve / 禁独立重启);embedding 可达快照留痕。
- [ ] (R4 若做)CI Linux cron 冒烟通过。
- [ ] 无回归:`bunx tsc --noEmit`、CLI 回归、M4 验收不回归。

## Out of Scope

- 机器端 cron install / 已解锁任务的实跑(rehearsal gate)——M4 遗留,不属分发。
- 真实第二机验证——本机模拟为裁决依据,结论诚实标注效力有限;真实换机待实际使用(开放问题 #1 关闭后跟踪)。
- office 文件逐表抽取、媒体深入路径;gbrain 内部实现改动(只消费其 CLI/MCP 能力)。
- Linux/Windows 真机验证——Q2 已决:不纳入;R4 仅 CI Linux 冒烟。

## Key Decisions

- **Q2 已决**:真机验证不纳入 M5 主任务(记忆层可移植是数据面、与平台正交);CI Linux cron 冒烟为 R4 可选验证,不阻塞。
- **Q3 已决(预设假设,演练裁决)**:指针「双字段」方案——`Pointer` 绝对路径(本机真理)+ frontmatter `rel_path`(相对 filehub 根,机器无关)。演练验证;若演练证伪(rel_path 不足以换机解析)则回退为「保持绝对路径 + 换机重录」或「Pointer 只读相对 + resolver」,并留痕。
- **纪律修订授权**:M5 授权扩展 asset-ingest 写页模板(rel_path)与 memory-recall discipline(换机解析),与 M4 同款授权机制,落 REPO + 刷 JWorkspace。
- **演练环境 = 本机模拟双机**(用户已定);模拟效力有限(同一机、同 OS、同 embedding 可达),结论如实标注,真实第二机待实际使用。
- **不拆子任务**:M5 范围集中、顺序依赖强(先指针落地再演练),单任务 + 分阶段实施。

## Risks / Deferred

- **图谱边/backlink 是否随 export/import 保留**:未知——演练首要验证点;不保留则记录丢失范围并给「边重建」结论,可能触发 gbrain 上游问题上报(不封装的边界)。
- **B 侧 embedding 可达性**:演练时刻不可达 = 环境故障,embedding 重建步降级为记录 + 关键词检索冒烟,结论如实标注。
- **锁时序**:导出/对照需 A 侧 serve 停泊窗口;演练设计避开 serve 常驻(全部 CLI)。
- **真实第二机验证**:本机模拟不能替代;GOAL 开放问题 #1 关闭时明确「结论基于本机模拟,真实换机待跟踪」。
