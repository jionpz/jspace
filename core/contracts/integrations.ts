// core/contracts/integrations.ts — portable, user-owned optional integrations.
// No installation paths or executable locations belong in this contract.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";

export interface JStackIntegration {
  enabled: boolean;
  /** Fingerprint of the last JSpace-owned bridge skill, never a JStack version. */
  bridge_sha256?: string;
}

export interface IntegrationsV1 {
  schema_version: 1;
  integrations: { jstack?: JStackIntegration };
}

export function emptyIntegrations(): IntegrationsV1 {
  return { schema_version: 1, integrations: { jstack: { enabled: false } } };
}

export function decodeIntegrations(input: unknown): DecodeResult<IntegrationsV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("integrations.root.type", "integrations", "integrations.json must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "integrations"], "integrations", "integrations.unknown-field", issues);
  readVersion(issues, "integrations.version.unsupported", "integrations.schema_version", input.schema_version, [1]);
  if (!isRecord(input.integrations)) {
    issues.add("integrations.entries.type", "integrations.integrations", "integrations must be an object");
    return failure(issues.issues);
  }
  const entries = input.integrations;
  checkNoUnknownFields(entries, ["jstack"], "integrations.integrations", "integrations.entry.unknown-field", issues);
  let jstack: JStackIntegration | undefined;
  if (entries.jstack !== undefined) {
    if (!isRecord(entries.jstack)) {
      issues.add("integrations.jstack.type", "integrations.integrations.jstack", "jstack must be an object");
    } else {
      const raw = entries.jstack;
      checkNoUnknownFields(raw, ["enabled", "bridge_sha256"], "integrations.integrations.jstack", "integrations.jstack.unknown-field", issues);
      if (typeof raw.enabled !== "boolean") {
        issues.add("integrations.jstack.enabled", "integrations.integrations.jstack.enabled", "enabled must be a boolean");
      }
      if (raw.enabled === true && (typeof raw.bridge_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.bridge_sha256))) {
        issues.add("integrations.jstack.digest", "integrations.integrations.jstack.bridge_sha256", "enabled integration requires a SHA-256 bridge fingerprint");
      }
      if (raw.enabled === false && raw.bridge_sha256 !== undefined) {
        issues.add("integrations.jstack.disabled-digest", "integrations.integrations.jstack.bridge_sha256", "disabled integration must not retain a bridge fingerprint");
      }
      if (typeof raw.enabled === "boolean") {
        jstack = {
          enabled: raw.enabled,
          ...(raw.enabled === true && typeof raw.bridge_sha256 === "string" ? { bridge_sha256: raw.bridge_sha256 } : {}),
        };
      }
    }
  }
  if (!issues.ok) return failure(issues.issues);
  return success({ schema_version: 1, integrations: jstack === undefined ? {} : { jstack } });
}
