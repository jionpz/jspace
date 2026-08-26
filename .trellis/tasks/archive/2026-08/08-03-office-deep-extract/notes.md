# office 深度解析 — 任务记录

## 交付物

- `skills/asset-ingest/scripts/office-extract.py` — 零依赖抽取器(python3 stdlib:zipfile + ElementTree)。
- `skills/asset-ingest/scripts/office-extract.test.py` — 自包含测试(15 用例)。
- `skills/asset-ingest/references/deep-extract.md` — 深度抽取细则(新)。
- `SKILL.md` 第 6 步 + 参考列表、`filing.md` excel/ppt 行、`gbrain-write.md` 页内策展纪律 — 更新。
- `scripts/gen-assets.ts` — 嵌入资产 walker 增加产物过滤(`__pycache__`/`.pyc`/`.DS_Store`);`.gitignore` 增加 pyc。
- `docs/MEMORY-ACCEPTANCE.md` — 新增「office 深度抽取扩展(#4)」可复跑协议节。

## 技术要点 / 发现

- **零依赖选型依据**:本机无 libreoffice/pandoc/openpyxl 等;gbrain 仅对 office 做 MIME 存储不解析;Read 工具读不了二进制 xlsx/pptx → 必须自带 stdlib 抽取器。
- **xlsx 抽取**:sheet 顺序走 workbook + rels;值覆盖共享字符串/内联/数字/布尔;保留单元格引用(A1/B2)→「找那个数」可定位到格。
- **pptx 抽取**:页序按 `sldIdLst` 展示顺序(非文件编号 slide1.xml),逐页取 `a:t` 文本。
- **幻影行(重要发现)**:真实 52期回访登记表 `学员名单` sheet 含 **1048574 行** `<row>`(Excel 巨大 used range 幻影,实际非空仅 419 行)。修复 = 过滤全空行,并加 `ROWS_LIMIT=1000` 每 sheet 截断注记。真实样例抽取 **132MB → 265KB**。已入测试(幻影行 + 截断两用例)。
- **随技能分发**:脚本放 `skills/asset-ingest/scripts/` 经 gen-assets 嵌入二进制 → `jspace init` 物化进工作台(已冒烟验证)。

## 验收(2026-08-03)

- 自测:15/15 全绿;`bun test` 21/21;`tsc` 干净;build 后 assets.generated.ts 无 pyc。
- 端到端真实文件:用户选定 `Downloads/52期体验营同修回访登记表.xlsx` → 归位 `projects/52期体验营/2026-08-03-52期体验营同修回访登记-v1.xlsx` → 抽取出伴生 `.extract.md`(265KB,7 sheet) → 策展 Key Facts(单人正价 6988 元) → gbrain reference 页 `assets/52期体验营/52期体验营同修回访登记-v1` → index.md 登记 → 召回自检 `query`×2 + `search` 均 **top-1**。
- **gbrain 锁处置**:验收开始时 serve(PID 24440)持 PGLite 锁 + MCP 断开 → 计划走暂存;随后发现 serve 进程已退出 = **陈旧锁**,gbrain 自动清理 → CLI 可开库 → live 写入 + 召回完成(锁空闲窗口,符合纪律)。

## 遗留 / 待办

- 日期序列值(如缴费时间 45954)未转日期——已记为抽取器限制,使用中需求涌现再加深。
- `&amp;` 双编码数据(UMU 调研表)为源文件怪癖,抽取器如实保留。
- CLI 子命令(`jspace extract`)未加——分发靠技能脚本即可,有诉求再提。
- #2 文件中心选址迁移子任务未开工(按父任务顺序先 #4 后 #2)。
