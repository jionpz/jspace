// core/contracts/incident.ts — typed cron incident contract.
// A failed/suspect run opens or updates an incident keyed by cron + failure
// class; a successful retry resolves it; `cron ack` records acknowledgment.
// Historical collection: a corrupt record surfaces a diagnostic without
// blocking the rest.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export const FAILURE_CLASSES = ["failed", "suspect", "batch-stale"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export const INCIDENT_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export interface IncidentV1 {
  version: 1;
  id: string; // uuid
  cronId: string;
  failureClass: FailureClass;
  status: IncidentStatus;
  openedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  evidence: string[]; // run ids / log paths
}

export function decodeIncident(input: unknown): DecodeResult<IncidentV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("incident.root.type", "incident", "incident must be an object");
    return failure(issues.issues);
  }
  const FIELDS = [
    "version", "id", "cronId", "failureClass", "status", "openedAt",
    "resolvedAt", "acknowledgedAt", "evidence",
  ] as const;
  checkNoUnknownFields(input, FIELDS, "incident", "incident.unknown-field", issues);
  if (input.version !== 1) {
    issues.add("incident.version.unsupported", "incident.version", "version must be 1");
  }
  readRequiredString(input, "id", "incident", "incident.id.invalid", issues);
  readRequiredString(input, "cronId", "incident", "incident.cronId.invalid", issues);
  readRequiredString(input, "openedAt", "incident", "incident.openedAt.invalid", issues);
  const failureClass = readRequiredString(input, "failureClass", "incident", "incident.failureClass.invalid", issues);
  if (failureClass !== undefined && !(FAILURE_CLASSES as readonly string[]).includes(failureClass)) {
    issues.add("incident.failureClass.invalid", "incident.failureClass", `failureClass must be one of ${FAILURE_CLASSES.join(", ")}`);
  }
  const status = readRequiredString(input, "status", "incident", "incident.status.invalid", issues);
  if (status !== undefined && !(INCIDENT_STATUSES as readonly string[]).includes(status)) {
    issues.add("incident.status.invalid", "incident.status", `status must be one of ${INCIDENT_STATUSES.join(", ")}`);
  }
  if (input.resolvedAt !== undefined && typeof input.resolvedAt !== "string") {
    issues.add("incident.resolvedAt.invalid", "incident.resolvedAt", "resolvedAt must be a string");
  }
  if (input.acknowledgedAt !== undefined && typeof input.acknowledgedAt !== "string") {
    issues.add("incident.acknowledgedAt.invalid", "incident.acknowledgedAt", "acknowledgedAt must be a string");
  }
  if (!Array.isArray(input.evidence) || !input.evidence.every((e) => typeof e === "string")) {
    issues.add("incident.evidence.invalid", "incident.evidence", "evidence must be an array of strings");
  }
  if (!issues.ok) return failure(issues.issues);
  return success({
    version: 1,
    id: input.id as string,
    cronId: input.cronId as string,
    failureClass: failureClass as FailureClass,
    status: status as IncidentStatus,
    openedAt: input.openedAt as string,
    ...(input.resolvedAt !== undefined ? { resolvedAt: input.resolvedAt as string } : {}),
    ...(input.acknowledgedAt !== undefined ? { acknowledgedAt: input.acknowledgedAt as string } : {}),
    evidence: input.evidence as string[],
  });
}
