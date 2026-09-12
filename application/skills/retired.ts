// application/skills/retired.ts — official skills that no longer ship.
//
// The official skill set is FULLY owned by JSpace: a deployed machine must never
// keep a skill we deleted or renamed. Every name here is removed from the
// user-level `~/.agents/skills/` root and from the workbench projection dirs by
// `jspace skills install --refresh` / `jspace workspace upgrade` — as directory
// residue, not as user content.
//
// Maintenance rule: add the old name here IN THE SAME CHANGE that renames or
// drops an official skill, and remove it only when no deployed machine can still
// carry it (i.e. never, realistically — the list is tiny). Keeping a name that is
// also in the manifest is a bug: scripts/check-skills.ts fails on the overlap.
//
// (jspace-bootstrap was renamed to jspace-use in v1.0.9.)
export const RETIRED_SKILL_NAMES: readonly string[] = ["jspace-bootstrap"];

/** A name is retired when it was official before and is not official now. */
export function retiredSet(officialNow: readonly string[]): Set<string> {
  const live = new Set(officialNow);
  return new Set(RETIRED_SKILL_NAMES.filter((n) => !live.has(n)));
}
