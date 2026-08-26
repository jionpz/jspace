# M5 任务记录(真实证据,不入 git)

## 环境证据(2026-08-03 实测)

- REPO 源:`/Users/jionpz/mycode/jspace`。机器 A(真实):JWorkspace `~/jspace-work`、gbrain `~/.gbrain`(openrouter BAAI/bge-m3 可达)、filehub `~/filehub`(M4 已归位 2 份资料 + index)。
- 锁状态:无 `gbrain serve` 进程(86973 已结束),演练全程 CLI、serve 停泊窗口内。

## 阶段 A:前置 probe ✅

1. **gbrain 多 brain 机制**:`GBRAIN_HOME` env 受支持(gbrain 源码 `core/self-upgrade.ts` 注明「~/.gbrain/ honors GBRAIN_HOME」)→ 机器 B brain 用 `GBRAIN_HOME=~/.gbrain-b` 完全隔离。`gbrain init --path <DIR>` 亦可(PGLite)。
2. **export 产物 probe**:`gbrain export --dir ~/.gbrain-export` → 2 页导出为纯 md(slug 派生路径 `assets/<域>/<语义名>.md`),frontmatter(type/title/source/project/tags)完整保留,正文含 `**Source:**`/`**Pointer:**` 绝对路径。**无独立边/backlink 导出物**——边只能以正文 wikilink 承载;本 2 页语料无互链,「边回灌」验证对该语料为空操作(如实记录)。
3. **embedding 快照**:`gbrain models doctor --json` → embedding_config ok / embedding_reachability ok(openrouter:BAAI/bge-m3,1024 维)。chat=litellm 超时(不阻塞检索)。

## 阶段进度

### 阶段 B ✅ 指针方案落地(REPO 源)
- 已改:`skills/asset-ingest/references/gbrain-write.md`(写页模板加 `rel_path` + 定义/计算/换机解析说明)、`skills/asset-ingest/SKILL.md`(步骤 3 加 rel_path 计算)、`skills/memory-recall/references/discipline.md`(§3 适配 + §8 换机解析)、`docs/MEMORY-ACCEPTANCE.md`(「换机解析扩展(M5)」节)。
- JWorkspace skills 同步(备份 `~/.jspace-backup/m5-20260803-152056/`;diff 无差异)。
- A 侧 2 个 reference 页补 rel_path:会议 `projects/报表模块/2026-07-会议沟通记录.txt`、ML `areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md`。

### 阶段 C ✅ 机器 B 环境
- `~/jspace-work-b`(init;hub 注册 filehub primary=`/Users/jionpz/filehub-b`);`~/filehub-b`(复制 A,2 份资料 + index 在)。
- B brain:`GBRAIN_HOME=~/.gbrain-b`(实际数据在 `~/.gbrain-b/.gbrain/`,GBRAIN_HOME 覆盖 home);import 成功。
- ⚠️ embedding 波折:首次 init 用 `--no-embedding` → schema vector(1280)默认;改 openrouter bge-m3(1024)需 wipe-and-reinit(PGLite 不能 ALTER vector)→ `gbrain reinit-pglite --yes` + 复制 openrouter_api_key → 重导入(embedded)。**教训:新机应从 init 就带正确 embedding 配置**。

### 阶段 D ✅ 双机演练(闭环全通)
- **B 侧四条查询 top-1 与 A 一致**:Q1 会议页 0.8749 / Q1' 0.8528 / Q2 ML 页 0.8953 / Q2' 0.8774(A 侧对照 0.8751/0.8528/0.8953/0.8774,同页,微差=put 后重嵌)。
- **指针换机解析成立**:B 读 hub.json filehub 根(`/Users/jionpz/filehub-b`)+ rel_path → 重解析成功:`projects/报表模块/2026-07-会议沟通记录.txt` → test -f ✓ / grep 30GB=1;`areas/机器学习/2026-08-03-机器学习基础-第二章笔记.md` → test -f ✓ / grep ∂L/∂w=2。
- **问一句闭环(B)**:「历史数据迁移涉及多少存量?」→ top-1 会议页 → 指针换机解析 → 找数 → 答案引用 `~/filehub-b/projects/报表模块/2026-07-会议沟通记录.txt`。
- **A 侧无回归**:A query 仍 top-1 会议页(rel_path 不影响召回)。

## 结论(开放问题 #1 裁决)

- **记忆层可移植假设:成立**。A export → B import(页 + rel_path + 文本)→ embedding 重建 → B 侧中文召回与 A 一致,「换一台机器继续工作」闭环本机模拟全通。
- **指针方案:双字段采用**。Pointer(绝对路径,本机真理)+ rel_path(相对 filehub 根,机器无关);换机解析 = 目标机 hub.json 根 + rel_path。
- **图谱边/backlink:本语料无互链,边为空**——未验证边保留(诚实标注);需互链语料另行验证,机制上边以正文 wikilink 承载。
- **效力有限**:本机模拟(同机/同 OS/同 embedding 可达);真实第二机待实际使用。新机 setup 教训:init 即配 embedding。

## 收尾确认

- [x] 阶段 B 纪律修订 + JWorkspace 同步 + A 侧 2 页补 rel_path。
- [x] 阶段 C/D 演练闭环(四条查询一致 + 指针换机解析 + 问一句闭环)。
- [ ] 结论落档(GOAL 开放问题 #1 关闭)+ 提交。
