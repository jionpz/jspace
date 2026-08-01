# Registry reference

## Schema (hub.json, version 3)

- `domains[]`: `{ id, path, tags? }` - path is `workspace/<id>`.
- `resources[]`: `{ id, type, domain, entrypoints[], tags?, notes? }`.
- Entrypoint: `{ id, kind: "path"|"url", value, primary? }`. `primary: true` is only valid on path entrypoints, exactly one per resource.
- Resource `domain` must be a registered domain.

## Drift rules

- Fix drift between `hub.json` and `workspace/<domain>/` with explanation; never invent domains/resources.
- Do not put executable start/stop/deploy commands in resources; operations belong in the owning domain README/runbook.
- `hub.json` notes stay concise; detail lives in `workspace/<domain>/domain.json` and markdown files.

## Validation

The workbench ships no registry CLI inside itself; run the JSpace dev CLI:

```bash
__DEV_ROOT__/bin/jspace doctor --dir .
```

Missing external resource paths are warnings, not blocking errors. Beyond `jspace doctor`, any future registry tooling must be described as future behavior until implemented.

Manual fallback:

```bash
jq . hub.json >/dev/null
for d in $(jq -r '.domains[].id' hub.json); do
  test -f "workspace/$d/README.md" && test -f "workspace/$d/domain.json"
done
# every resource with path entrypoints has exactly one primary path
jq -e '[.resources[] | select(any(.entrypoints[]; .kind == "path")) | [.entrypoints[] | select(.kind == "path" and .primary == true)] | length == 1] | all' hub.json >/dev/null
```
