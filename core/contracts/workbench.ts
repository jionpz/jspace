// core/contracts/workbench.ts — portable workbench marker v1 contract + decoder.
//
// marker.json carries the logical workbench identity and template provenance.
// It is portable and must never contain a development-repo or executable path
// (the old `source` field is deliberately rejected as an unknown field).
import {
  checkNoUnknownFields,
  failure,
  isRecord,
  IssueCollector,
  readRequiredString,
  success,
  type DecodeResult,
} from "./diagnostics.ts";
import { ID_PATTERN, isId } from "./ids.ts";

export interface WorkbenchMarkerV1 {
  schema_version: 1;
  product: "JSpace";
  workbench_id: string;
  template_version: string;
  created_at: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function decodeMarker(input: unknown): DecodeResult<WorkbenchMarkerV1> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("marker.root.type", "marker", "marker.json root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "product", "workbench_id", "template_version", "created_at"], "marker", "marker.unknown-field", issues);

  if (input.schema_version !== 1) {
    issues.add("marker.version.unsupported", "marker.schema_version", "schema_version must be 1");
  }
  if (input.product !== "JSpace") {
    issues.add("marker.product.invalid", "marker.product", 'product must be "JSpace"');
  }
  const workbenchId = readRequiredString(input, "workbench_id", "marker", "marker.workbench_id.invalid", issues);
  if (workbenchId !== undefined && !isId(workbenchId)) {
    issues.add("marker.workbench_id.invalid", "marker.workbench_id", `workbench_id must match ${ID_PATTERN}`);
  }
  readRequiredString(input, "template_version", "marker", "marker.template_version.invalid", issues);
  const createdAt = readRequiredString(input, "created_at", "marker", "marker.created_at.invalid", issues);
  if (createdAt !== undefined && !DATE_PATTERN.test(createdAt)) {
    issues.add("marker.created_at.invalid", "marker.created_at", "created_at must be a YYYY-MM-DD date");
  }

  if (!issues.ok) return failure(issues.issues);
  return success({
    schema_version: 1,
    product: "JSpace",
    workbench_id: workbenchId as string,
    template_version: input.template_version as string,
    created_at: input.created_at as string,
  });
}
