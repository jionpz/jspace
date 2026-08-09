// core/contracts/upgrade.ts — typed workspace upgrade journal contract
// (.jspace/state/upgrades/<id>/journal.json). Recovery-critical: drives
// `workspace upgrade --rollback <id>`. An invalid/missing journal must fail
// loud, never read as a no-op rollback.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readEnum,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export const UPGRADE_STATUSES = ["pending", "applied", "failed", "rolled_back"] as const;
export type UpgradeStatus = (typeof UPGRADE_STATUSES)[number];

/** Plan actions recorded in the journal (subset of diffBundle actions).
 *  `remove` = recorded copy no longer in the bundle, unmodified, cleaned up by
 *  upgrade (backed up, rollback restores);
 *  `block-update` = AGENTS.md JSPACE block refreshed, user content outside preserved;
 *  `delete` = legacy alias, kept for decode compatibility. */
export const UPGRADE_ACTIONS = ["create", "update", "delete", "remove", "block-update", "migrate", "conflict"] as const;

export interface UpgradePlanStep {
  action: string;
  rel: string;
}

export interface UpgradeJournalV1 {
  version: 1;
  id: string;
  from_version: string;
  to_version: string;
  plan: UpgradePlanStep[];
  status: UpgradeStatus;
}

export function decodeUpgradeJournal(input: unknown): DecodeResult<UpgradeJournalV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("upgrade.root.type", "upgrade", "upgrade journal must be an object");
    return failure(issues.issues);
  }
  const FIELDS = ["version", "id", "from_version", "to_version", "plan", "status"] as const;
  checkNoUnknownFields(input, FIELDS, "upgrade", "upgrade.unknown-field", issues);
  readVersion(issues, "upgrade.version.unsupported", "upgrade.version", input.version, [1]);
  readRequiredString(input, "id", "upgrade", "upgrade.id.invalid", issues);
  readRequiredString(input, "from_version", "upgrade", "upgrade.from_version.invalid", issues);
  readRequiredString(input, "to_version", "upgrade", "upgrade.to_version.invalid", issues);
  const status = readRequiredString(input, "status", "upgrade", "upgrade.status.invalid", issues);
  if (status !== undefined) {
    readEnum(issues, "upgrade.status.invalid", "upgrade.status", status, UPGRADE_STATUSES);
  }
  if (!Array.isArray(input.plan)) {
    issues.add("upgrade.plan.invalid", "upgrade.plan", "plan must be an array of {action, rel}");
  } else {
    for (let i = 0; i < input.plan.length; i++) {
      const step = input.plan[i];
      if (!isRecord(step) || typeof step.rel !== "string" || typeof step.action !== "string") {
        issues.add("upgrade.plan.invalid", `upgrade.plan.${i}`, `plan[${i}] must be { action: string; rel: string }`);
        continue;
      }
      readEnum(issues, "upgrade.plan.invalid", `upgrade.plan.${i}.action`, step.action, UPGRADE_ACTIONS);
    }
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    version: 1,
    id: input.id as string,
    from_version: input.from_version as string,
    to_version: input.to_version as string,
    plan: input.plan as UpgradePlanStep[],
    status: status as UpgradeStatus,
  });
}
