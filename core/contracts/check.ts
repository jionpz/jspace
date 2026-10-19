// core/contracts/check.ts — shared result vocabulary for read-only audits.

export const CHECK_STATUSES = ["ok", "attention", "partial"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const CHECK_SEVERITIES = ["error", "warning", "unknown"] as const;
export type CheckSeverity = (typeof CHECK_SEVERITIES)[number];

export interface CheckFinding {
  code: string;
  severity: CheckSeverity;
  message: string;
  slug?: string;
  path?: string;
}

export type CoverageState = "complete" | "partial" | "unknown" | "not_applicable";

export interface CheckCoverage {
  state: CoverageState;
  /** Human-readable explanation for partial/unknown coverage. */
  detail?: string;
}

export function checkStatus(findings: readonly CheckFinding[], complete: boolean): CheckStatus {
  if (!complete || findings.some((finding) => finding.severity === "unknown")) return "partial";
  return findings.length > 0 ? "attention" : "ok";
}

export function countFindings(findings: readonly CheckFinding[]): Record<CheckSeverity, number> {
  return {
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    unknown: findings.filter((f) => f.severity === "unknown").length,
  };
}
