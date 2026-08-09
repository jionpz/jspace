// core/contracts/local.ts — machine-local state v1 contract + typed decoder.
//
// local.json is gitignored and holds only this machine's installation identity
// and path bindings. Secrets, tokens and provider credentials are not permitted.
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  readVersion,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { ID_PATTERN, isId } from "./ids.ts";
import { isAbsolutePath } from "./paths.ts";

export interface LocalStateV1 {
  schema_version: 1;
  installation_id: string;
  bindings: Record<string, string>;
}

export function decodeLocal(input: unknown): DecodeResult<LocalStateV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("local.root.type", "local", "local.json root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "installation_id", "bindings"], "local", "local.unknown-field", issues);

  readVersion(issues, "local.version.unsupported", "local.version", input.schema_version, [1]);
  const installationId = readRequiredString(input, "installation_id", "local", "local.installation_id.invalid", issues);
  if (installationId !== undefined && !isId(installationId)) {
    issues.add("local.installation_id.invalid", "local.installation_id", `installation_id must match ${ID_PATTERN}`);
  }

  const bindings: Record<string, string> = {};
  if (!isRecord(input.bindings)) {
    issues.add("local.bindings.type", "local.bindings", "bindings must be an object");
  } else {
    for (const [key, value] of Object.entries(input.bindings)) {
      if (!isId(key)) {
        issues.add("local.binding.key.invalid", `local.bindings.${key}`, `binding key must match ${ID_PATTERN}`);
      }
      if (typeof value !== "string" || value.length === 0 || !isAbsolutePath(value)) {
        issues.add("local.binding.value.invalid", `local.bindings.${key}`, "binding value must be a non-empty absolute path");
      }
      bindings[key] = value as string;
    }
  }

  if (!issues.ok) return failure(issues.issues);
  return success({ schema_version: 1, installation_id: installationId as string, bindings });
}
