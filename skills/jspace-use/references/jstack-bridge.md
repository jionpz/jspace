---
name: jspace-jstack
description: "Work inside a registered software Git repository using its project-scoped JStack workflow. Do not run full JStack in the JSpace workbench root."
---

# JSpace ↔ JStack — optional engineering bridge

This skill is installed into a JWorkspace **only when the user enables the JStack integration**. It is an entrypoint and delegation contract, **not** a bundled copy of JStack's flow/spec/pstack plugins. The actual plugins and gates are owned by the target Git repository's JStack project installation.

## When to use

Use for implementation, refactoring, repository CI repair, code reviews and other software engineering tasks in a Git repository registered as a JSpace resource. Do not invoke JStack for unrelated research, inbox processing, reports, or asset filing.

## Routing and safety

1. Resolve the domain and resource in the workbench `.jspace/hub.json`; resolve its machine-local primary path using `.jspace/local.json`. Read the domain's README and the target repository's `AGENTS.md` before editing.
2. Confirm `jspace integration status jstack --dir <workbench>` reports enabled. The workflow is applied **inside the target repository**, never at the JWorkspace root.
3. In a repository not yet installed, ask for the location of a trusted JStack checkout; after authorization, run `jspace integration attach jstack --dir <workbench> --repo <repository> --source <jstack-checkout> --dry-run`, inspect the plan, then run without `--dry-run`. This invokes JStack's own project-scoped installer and doctor. It does **not** download remote code or install JStack globally.
4. In the repository, follow the **actual installed** JStack `route` skill and its prescribed spec / pstack / flow stages. Use repository tracker and tests as sources of truth; report gate evidence, failures and review status. A skill being installed is not proof that runtime hooks enforced every gate.
5. Return concrete artifacts (changes, test commands/results, branch, PR and CI evidence) to the workbench context. Do not merge or deploy unless the user explicitly authorized it.
6. For lasting memory, use JSpace's `memory-writeback` as the **sole authoritative gbrain writer**. JStack's archive/review may propose facts and pointers; do not write a second independent set of memory pages.

## Lifecycle

- `jspace integration enable jstack --dir <workbench>` enables this bridge on an existing workbench.
- `jspace integration disable jstack --dir <workbench>` removes the workbench bridge; it does **not** uninstall JStack from any Git repository.
- `jspace workspace upgrade` preserves the integration choice and bridge bytes so its own rollback remains consistent. It reports whether a bridge refresh/repair is available, but does not silently update optional bridge files. Refresh explicitly with `jspace integration enable jstack`; verify with `jspace integration status jstack`.
- JStack projects own their own `.jstack/lock.json`, installer, hooks, migrations and uninstallation. Do not duplicate these in JSpace's registry or state.
