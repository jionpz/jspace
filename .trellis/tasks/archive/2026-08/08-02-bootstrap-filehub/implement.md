# bootstrap 文件中心引导步骤 — 执行计划

## 实施清单

1. `skills/jspace-bootstrap/SKILL.md`:
   - 新增 `## Phase 3 - File center(文件中心/资产层)`(置于原 Phase 2 之后);原 Phase 3(harness)→ Phase 4、原 Phase 4(最终冒烟)→ Phase 5。
   - Phase 1 embedding 默认改为本地 Ollama bge-m3(SiliconFlow 降为可选提升)。
   - 新 Phase 内含「首配验收」注:放真实文件进 `_inbox/` 跑通 入库→gbrain→中文召回。
2. `skills/jspace-bootstrap/references/gbrain.md`:
   - 默认 embedding = 本地 Ollama bge-m3(含 `ollama pull bge-m3` + `gbrain init --embedding-model ollama:bge-m3 --embedding-dimensions 1024` + `gbrain providers test` + `models doctor` 验证);SiliconFlow 降为 Option B(可选提升);chat parity 顺延为 Option C;offline 注更新。
3. `bun run scripts/gen-assets.ts` 重新生成内嵌资产。

## 校验命令

- `bunx tsc --noEmit`(资产重生成后仍通过)
- `bun run scripts/gen-assets.ts`
- `bun run cli/main.ts init /tmp/smoke` + `doctor --dir /tmp/smoke`(确认 bootstrap skill 正确物化)
- `grep Phase <生成工作台>/skills/jspace-bootstrap/SKILL.md`(确认含 Phase 3 文件中心 + Phase 5 最终冒烟)

## 关键风险 / 回滚点

- 本地 Ollama 配置格式以 gbrain 官方 `docs/integrations/embedding-providers.md` 为准(已核对),不臆造 config.json key。
- 不改 harness 接线、不改 registry 逻辑;bootstrap 其余 Phase 文案最小扰动。
- 回滚:撤销 SKILL.md / gbrain.md diff + `gen-assets` 重生成。
