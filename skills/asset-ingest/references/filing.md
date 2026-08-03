# asset-ingest — 归位规则(filing)

## 文件中心定位

- 文件中心 = `.jspace/hub.json` 中 `type: filehub` 的 resource;取 `primary: true` 的 path entrypoint 作为根(`filehub/`)。
- 未注册该约定 type/id → 走降级暂存区(见下)。
- 该约定直接服务 M2(M2 按此注册文件中心)。

## 命名

`YYYY-MM-DD-语义名-vN.ext`(GOAL.md 规范)

- `YYYY-MM-DD`:入库日期(机器可排序)
- `语义名`:可扫读短名(中文或 kebab-case)
- `-vN`:版本号,同语义资料二版起递增(重名去重的机制)

## 类型策略

| 类型 | 归位目标 | 说明 |
|---|---|---|
| pdf/txt/md 书籍、资料 | `areas/<领域>/` | 先摘要+指针,按需加深 |
| excel / ppt | `projects/<项目>/` 或 `areas/<领域>/` | 常规:摘要+指针;用户要求时深度抽取(逐表/逐页 → 伴生 `.extract.md` + 页内 Key Facts 含关键数字),见 `references/deep-extract.md` |
| 项目产出(报告/文档/资料) | `projects/<项目>/<子目录>/` | `-vN` 管理版本 |
| 视频/音频/截图 | — | 路由到 gbrain `media-ingest` 深入路径;MVP 范围外 |

## 目录结构(GOAL.md 资产协议)

```
filehub/
  _inbox/           # 新资料先落这里(M2 后)
  projects/<项目>/  # index.md + 子目录
  areas/<领域>/     # 长期领域资料
  archive/<年>/     # 结项/冷资料
```

## 降级暂存区(文件中心未注册时)

- **位置**:工作台同级、不进 git 的 `../<workbench>-inbox/`,或用户指定目录。
- **不得**在工作台 git 目录内建 `_inbox/`(工作台是 git 同步的控制平面,重资产不入 git)。
- 首次使用自动创建,并提示"待文件中心注册为 type=filehub 后正式归位"。
- `filehub/_inbox/`(M2 后)与降级暂存区是同一职责的两处实现。
- **迁移(M2 起)**:注册 filehub(`jspace filehub init <根> --register` 或 `resource add --type filehub`)后,把暂存区文件并入正式 `_inbox/`:
  1. 人工把暂存区文件移动到 `<filehub>/_inbox/`(或用户指定目录);
  2. 再走 asset-ingest 归位(会话内「整理一下 inbox」)。
  - 不自动批量迁移(存量收编增量策略);M2 之后新资料一律先落 `filehub/_inbox/`。

## 查重

- 入库前检查:目标目录同名/同语义文件、`gbrain get assets/<项目|领域>/<语义名>` 是否已存在。
- 已存在 → 询问用户:跳过 / **修复**(同名同内容重入,允许覆盖错页)/ 升版本(`-vN`,写新页、旧页保留并注 supersedes)。

## 项目 index.md

- `projects/<项目>/index.md` 登记一行:文件名 + 日期 + gbrain slug(人机共用的 dashboard)。
- `areas/` 是否维护 index 由真实使用涌现,不预先设计。
