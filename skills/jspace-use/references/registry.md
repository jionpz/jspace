# Registry reference

## Portable state (.jspace/hub.json, version 4)

Hub is the **portable** registry — logical identity only, safe to sync via git:

- `domains[]`: `{ id, path, tags? }` - `path` is relative to the workbench root (`workspace/<id>`), never absolute.
- `resources[]`: `{ id, type, domain, entrypoints[], tags?, notes? }`.
- Entrypoint (path): `{ id, kind: "path", binding, primary? }` — `binding` is a **key** that resolves to a machine path in `local.json`, never an absolute path.
- Entrypoint (url): `{ id, kind: "url", value }` — `value` stays in hub (portable URL).
- `primary: true` is a strict boolean, only valid on path entrypoints, exactly one per resource that has path entrypoints.
- `projects[]`: `{ id, domain, asset_rel_path, status: "active"|"archived" }` — `asset_rel_path` is `/`-separated, starts with `projects/`, resolves below the filehub root.
- Resource `domain` and project `domain` must reference a registered domain.
- `version` must be `"4"`; v3 is rejected (workspace upgrade lands separately).

## Machine-local state (.jspace/local.json, version 1)

`local.json` is **gitignored** and holds only this machine's facts:

- `{ version: 1, installation_id, bindings: { <binding-key>: <absolute-path> } }`.
- `binding` keys follow the same id pattern (`<resource-id>-<entrypoint-id>` by default).
- Values are absolute paths on the current machine. Missing local state (e.g. a fresh clone) means path resources are *unbound* until a binding is created; it does not invalidate hub.

## Marker (.jspace/marker.json, version 1)

- `{ schema_version: 1, product: "JSpace", workbench_id, template_version, created_at }`.
- Portable and stable across syncs; `workbench_id` is generated once by `jspace init`. The legacy `source` (dev-repo absolute path) is rejected.

## Drift rules

- Fix drift between `.jspace/hub.json` and `workspace/<domain>/` with explanation; never invent domains/resources.
- Do not put executable start/stop/deploy commands in resources; operations belong in the owning domain README/runbook.
- `.jspace/hub.json` notes stay concise; detail lives in `workspace/<domain>/domain.json` and markdown files.
- Never edit `local.json` by hand except to re-point a binding; `jspace resource add --path` / `jspace filehub init --register` maintain hub + local together.

## Validation

The workbench ships no registry CLI inside itself; run the JSpace CLI:

```bash
jspace doctor --dir .      # 编译二进制在 PATH;源码检出则 bun run cli/main.ts
```

Missing external resource paths are warnings, not blocking errors. Beyond `jspace doctor`, any future registry tooling must be described as future behavior until implemented.

Manual fallback(POSIX;Windows 用 PowerShell `ConvertFrom-Json` 替代 `jq`):

```bash
jq .jspace/hub.json >/dev/null
for d in $(jq -r '.domains[].id' .jspace/hub.json); do
  test -f "workspace/$d/README.md" && test -f "workspace/$d/domain.json"
done
# every resource with path entrypoints has exactly one primary path
jq -e '[.resources[] | select(any(.entrypoints[]; .kind == "path")) | [.entrypoints[] | select(.kind == "path" and .primary == true)] | length == 1] | all' .jspace/hub.json >/dev/null
# path entrypoints carry binding keys, not absolute paths
jq -e '[.resources[].entrypoints[] | select(.kind == "path") | (.binding | type == "string")] | all' .jspace/hub.json >/dev/null
```
