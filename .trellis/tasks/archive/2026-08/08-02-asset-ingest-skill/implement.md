# 资料转知识资产学习 skill — Implementation Plan

## Review gate

PRD + design + implement 已按四位专家 review 修订定稿。经用户确认后 `task.py start`。

## Ordered checklist

### S1 建 skill 目录与内容
- [ ] S1.1 建 `skills/asset-ingest/`(`SKILL.md` + `references/filing.md` + `references/gbrain-write.md`)
- [ ] S1.2 `SKILL.md`:frontmatter(name/description/**triggers**)+ 执行步骤(识别→查重→归位→入脑→登记→可选深入→召回)
  - 触发词限定:"把这份资料入库 / 整理 inbox / 归位资料";"学习这本书"标注为可选深入路径
  - 执行步骤含:**查重**(入库前检查同名/同语义)、**失败纪律**(任一步失败即停、不留半成品页)、**召回自检**(写页后 `gbrain query` 确认命中)
- [ ] S1.3 `references/filing.md`:归位规则——命名 `YYYY-MM-DD-语义名-vN.ext`(含 -vN)、类型策略表(含 excel)、文件中心定位(hub.json `type=filehub` resource,读 primary path)、**降级暂存区在工作台外**(`../<workbench>-inbox/` 或用户指定,不进 git)、areas index.md 约定(建议 area 级 index 或延迟涌现)

### S2 references/gbrain-write.md
- [ ] S2.1 reference 页模板(frontmatter: type=reference / source / project / tags + Summary + Key Facts + Pointer 绝对路径)
- [ ] S2.2 **slug 派生规则**:`assets/<project|area>/<语义名>`(与文件语义名绑定);写页前 `gbrain get <slug>` 查重
- [ ] S2.3 版本/删除生命周期:新 `-vN` 更新指针/新页并注 supersedes;归档/删除可选失效提示
- [ ] S2.4 **embedding 降级序列**:写失败(报 embedding 错)→ `embed_skip: true` 重写 → `gbrain query`/`search` 降级 → 固定提示文本(`embedding 不可用,当前为关键词检索,中文命中率可能偏低`)
- [ ] S2.5 upload-raw 口径:小文件 no-op,不依赖;指针靠 Source 字段(注释说明,防误用)

### S3 接入 init 复制(`bin/jspace`)
- [ ] S3.1 新增 `ASSET_INGEST_SOURCE = DEV_ROOT / "skills" / "asset-ingest"`(L16 `SKILL_SOURCE` 旁)
- [ ] S3.2 新增同源 `is_dir` fail 检查(对齐 L164-165)
- [ ] S3.3 新增 `shutil.copytree(ASSET_INGEST_SOURCE, target / "skills" / "asset-ingest", dirs_exist_ok=True)`(对齐 L168-172)
- [ ] S3.4 确认 `_materialize_placeholders` 无需改动(递归遍历自动覆盖 `__DEV_ROOT__`)

### S4 工作台模板
- [ ] S4.1 `templates/workbench/AGENTS.md` Brain operations 段加 `- **asset-ingest**: 资料入库 | 整理 inbox | 归位资料`(保持格式 intact)
- [ ] S4.2 Skill Governance L109 "First approved workbench skill: jspace-bootstrap"改为并列两句("approved workbench skills: jspace-bootstrap(首次配置)+ asset-ingest(资料摄入)")
- [ ] S4.3 `templates/workbench/README.md` 结构清单补 `skills/asset-ingest/`
- [ ] S4.4 `skills/jspace-bootstrap/SKILL.md` 补 `triggers:` frontmatter(gbrain doctor 现报 mece_gap;保持两 skill 契约一致)

### S5 文档同步
- [ ] S5.1 `GOAL.md`:gbrain 定位澄清(检索层 + 自带摄入能力;本体仍存文件中心);更新"最后更新"日期
- [ ] S5.2 `AGENTS.md`(开发仓库)Product Vision L20:gbrain 表述补"检索层 + 现成摄入"
- [ ] S5.3 `skills/jspace-bootstrap/references/gbrain.md` + `SKILL.md` Phase 1:embedding 改"默认必需、不可用降级不阻塞";补 asset-ingest 衔接。注明现有 live 工作台不回填(等下次重建/init --force)

## Validation commands

- [ ] V1 `python3 -m py_compile bin/jspace`
- [ ] V2 `bin/jspace init /tmp/jspace-smoke --force` → 工作台含 `skills/asset-ingest/`;`rg -l "__DEV_ROOT__" /tmp/jspace-smoke` 无残留(占位符全部物化)
- [ ] V3 `bin/jspace doctor --dir /tmp/jspace-smoke` 通过(开发工作流强制回归项)
- [ ] V4 隔离 brain 实证:一份真实中文资料走通 识别→查重→归位→入脑→登记→召回
  - `HOME=/tmp/ai-test gbrain init --pglite --no-embedding`(验证降级路径 + AC4 固定提示)
  - 二次入库触发查重提示(AC8)
- [ ] V5 embedding 语义命中(AC2b):隔离验收 brain 配 SiliconFlow bge-m3,`gbrain query` 命中(或 live brain 验证)
- [ ] V6 bootstrap 冒烟:init 新目录按新口径跑 Phase 1,确认 embedding 缺失**不阻塞**、写入仍成功
- [ ] V7 `gbrain doctor --json`(含 resolver 注册的工作台)不再报 asset-ingest 缺失;jspace-bootstrap mece_gap 消除
- [ ] V8 回归:全文无 `myhub` 陈旧引用;现有工作台模板/jspace-bootstrap 未破坏

## Rollback

- **已跟踪文件**(bin/jspace、templates/workbench/AGENTS.md、templates/workbench/README.md、skills/jspace-bootstrap/*、GOAL.md、AGENTS.md):`git checkout -- <file>`
- **新增未跟踪文件**(`skills/asset-ingest/` 全部):`rm -rf skills/asset-ingest`(`git checkout --` 对 untracked 无效)
- S3 回滚:还原 `bin/jspace` 三处(常量/检查/copytree)
- 不动 gbrain 本体,无 schema/数据风险

## Out of scope(留给后续任务)

- 文件中心本体实现、_inbox 自动化、批量自动化(M2)
- cron 定时入库(M3)
- book-mirror/media-ingest 深度集成(MVP 标为可选/范围外;book-mirror 需 Anthropic 子代理与成本确认)
