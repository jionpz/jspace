// core/contracts/hub.ts — portable hub contract + pure typed decoder.
//
// Hub is the portable workbench registry: domain/resource/project logical
// identity only. Machine-local path values live in local.json (core/contracts/local.ts).
// Schema version uses the unified numeric `schema_version: number` form (same
// as every other contract); the legacy string `version: "4"` form is no longer
// accepted and decodes as damaged (M5 之后的模板已经升级,无兼容性负担).
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
import { portabilityIssues } from "./paths.ts";

export interface Domain {
  id: string;
  path: string;
  tags?: string[];
}

export interface PathEntrypoint {
  id: string;
  kind: "path";
  binding: string;
  primary?: boolean;
}

export interface UrlEntrypoint {
  id: string;
  kind: "url";
  value: string;
}

export type Entrypoint = PathEntrypoint | UrlEntrypoint;

export interface Resource {
  id: string;
  type: string;
  domain: string;
  entrypoints: Entrypoint[];
  tags?: string[];
  notes?: string;
}

export interface Project {
  id: string;
  domain: string;
  asset_rel_path: string;
  status: "active" | "archived";
}

export interface HubV4 {
  schema_version: 1;
  domains: Domain[];
  resources: Resource[];
  projects: Project[];
}

function decodeDomains(value: unknown, domainIds: Set<string>, issues: IssueCollector): Domain[] {
  const domains: Domain[] = [];
  if (!Array.isArray(value)) {
    issues.add("hub.domains.type", "hub.domains", "domains must be an array");
    return domains;
  }
  value.forEach((item, i) => {
    const prefix = `hub.domains[${i}]`;
    if (!isRecord(item)) {
      issues.add("hub.domain.type", prefix, "domain must be an object");
      return;
    }
    const before = issues.issues.length;
    checkNoUnknownFields(item, ["id", "path", "tags"], prefix, "hub.domain.unknown-field", issues);
    const id = readRequiredString(item, "id", prefix, "hub.domain.id.invalid", issues);
    const path = readRequiredString(item, "path", prefix, "hub.domain.path.invalid", issues);
    if (id !== undefined) {
      if (!isId(id)) {
        issues.add("hub.domain.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
      } else if (domainIds.has(id)) {
        issues.add("hub.domain.id.duplicate", `${prefix}.id`, `duplicate domain id: ${id}`);
      } else {
        domainIds.add(id);
      }
    }
    if (path !== undefined) {
      for (const m of portabilityIssues(path)) {
        issues.add("hub.domain.path.invalid", `${prefix}.path`, `path ${m}`);
      }
    }
    if (item.tags !== undefined) {
      const ok = Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string" && t.length > 0);
      if (!ok) issues.add("hub.domain.tags.invalid", `${prefix}.tags`, "tags must be an array of non-empty strings");
    }
    if (issues.issues.length === before) {
      domains.push({
        id: id as string,
        path: path as string,
        ...(item.tags !== undefined ? { tags: item.tags as string[] } : {}),
      });
    }
  });
  return domains;
}

function decodeEntrypoint(ep: unknown, prefix: string, seenIds: Set<string>, issues: IssueCollector): Entrypoint | null {
  if (!isRecord(ep)) {
    issues.add("hub.entrypoint.type", prefix, "entrypoint must be an object");
    return null;
  }
  const kind = ep.kind;
  if (kind !== "path" && kind !== "url") {
    issues.add("hub.entrypoint.kind.invalid", `${prefix}.kind`, "kind must be path or url");
    return null;
  }
  const epId = readRequiredString(ep, "id", prefix, "hub.entrypoint.id.invalid", issues);
  if (epId !== undefined) {
    if (!isId(epId)) {
      issues.add("hub.entrypoint.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
    } else if (seenIds.has(epId)) {
      issues.add("hub.entrypoint.id.duplicate", `${prefix}.id`, `duplicate entrypoint id within resource: ${epId}`);
    } else {
      seenIds.add(epId);
    }
  }

  if (kind === "path") {
    checkNoUnknownFields(ep, ["id", "kind", "binding", "primary", "value"], prefix, "hub.entrypoint.unknown-field", issues);
    if ("value" in ep) {
      issues.add("hub.entrypoint.path.value.invalid", `${prefix}.value`, "path entrypoint must not have a value field (binding key goes in binding)");
    }
    const binding = readRequiredString(ep, "binding", prefix, "hub.entrypoint.path.binding.invalid", issues);
    if (binding !== undefined && !isId(binding)) {
      issues.add("hub.entrypoint.path.binding.invalid", `${prefix}.binding`, `binding key must match ${ID_PATTERN}`);
    }
    let primary: boolean | undefined;
    if (ep.primary !== undefined) {
      if (typeof ep.primary === "boolean") primary = ep.primary;
      else issues.add("hub.entrypoint.path.primary.type", `${prefix}.primary`, "primary must be a strict boolean (true/false)");
    }
    return { id: epId as string, kind: "path", binding: binding as string, ...(primary !== undefined ? { primary } : {}) };
  }

  checkNoUnknownFields(ep, ["id", "kind", "value", "binding", "primary"], prefix, "hub.entrypoint.unknown-field", issues);
  if ("binding" in ep) issues.add("hub.entrypoint.url.binding.invalid", `${prefix}.binding`, "url entrypoint must not have a binding field");
  if ("primary" in ep) issues.add("hub.entrypoint.url.primary.invalid", `${prefix}.primary`, "url entrypoint must not have a primary field");
  const value = readRequiredString(ep, "value", prefix, "hub.entrypoint.url.value.invalid", issues);
  return { id: epId as string, kind: "url", value: value as string };
}

function decodeResources(value: unknown, domainIds: Set<string>, issues: IssueCollector): Resource[] {
  const resources: Resource[] = [];
  if (!Array.isArray(value)) {
    issues.add("hub.resources.type", "hub.resources", "resources must be an array");
    return resources;
  }
  const resourceIds = new Set<string>();
  value.forEach((item, i) => {
    const prefix = `hub.resources[${i}]`;
    if (!isRecord(item)) {
      issues.add("hub.resource.type", prefix, "resource must be an object");
      return;
    }
    const before = issues.issues.length;
    checkNoUnknownFields(item, ["id", "type", "domain", "entrypoints", "tags", "notes"], prefix, "hub.resource.unknown-field", issues);
    const id = readRequiredString(item, "id", prefix, "hub.resource.id.invalid", issues);
    const type = readRequiredString(item, "type", prefix, "hub.resource.type.invalid", issues);
    const domain = readRequiredString(item, "domain", prefix, "hub.resource.domain.invalid", issues);
    if (id !== undefined) {
      if (!isId(id)) {
        issues.add("hub.resource.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
      } else if (resourceIds.has(id)) {
        issues.add("hub.resource.id.duplicate", `${prefix}.id`, `duplicate resource id: ${id}`);
      } else {
        resourceIds.add(id);
      }
    }
    if (domain !== undefined && !domainIds.has(domain)) {
      issues.add("hub.resource.domain.ref", `${prefix}.domain`, `domain must reference a registered domain: ${domain}`);
    }
    if (item.tags !== undefined) {
      const ok = Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string" && t.length > 0);
      if (!ok) issues.add("hub.resource.tags.invalid", `${prefix}.tags`, "tags must be an array of non-empty strings");
    }
    if (item.notes !== undefined && typeof item.notes !== "string") {
      issues.add("hub.resource.notes.invalid", `${prefix}.notes`, "notes must be a string");
    }

    const entrypoints: Entrypoint[] = [];
    if (!Array.isArray(item.entrypoints)) {
      issues.add("hub.resource.entrypoints.type", `${prefix}.entrypoints`, "entrypoints must be an array");
    } else if (item.entrypoints.length === 0) {
      issues.add("hub.resource.entrypoints.empty", `${prefix}.entrypoints`, "entrypoints must be a non-empty array");
    } else {
      const seenEpIds = new Set<string>();
      let pathCount = 0;
      let primaryCount = 0;
      item.entrypoints.forEach((raw, j) => {
        const epBefore = issues.issues.length;
        const ep = decodeEntrypoint(raw, `${prefix}.entrypoints[${j}]`, seenEpIds, issues);
        // primary aggregation over raw fields (kept separate from typed pushes so
        // a malformed entrypoint still counts toward the exactly-one-primary rule)
        if (isRecord(raw) && raw.kind === "path") {
          pathCount += 1;
          if (raw.primary === true) primaryCount += 1;
        }
        if (ep !== null && issues.issues.length === epBefore) entrypoints.push(ep);
      });
      if (pathCount > 0 && primaryCount !== 1) {
        issues.add(
          "hub.resource.path.primary.count",
          `${prefix}.entrypoints`,
          `resource with path entrypoints must have exactly one primary path (found ${primaryCount} of ${pathCount})`,
        );
      }
    }

    if (issues.issues.length === before) {
      resources.push({
        id: id as string,
        type: type as string,
        domain: domain as string,
        entrypoints,
        ...(item.tags !== undefined ? { tags: item.tags as string[] } : {}),
        ...(item.notes !== undefined ? { notes: item.notes as string } : {}),
      });
    }
  });
  return resources;
}

function decodeProjects(value: unknown, domainIds: Set<string>, issues: IssueCollector): Project[] {
  const projects: Project[] = [];
  if (!Array.isArray(value)) {
    issues.add("hub.projects.type", "hub.projects", "projects must be an array");
    return projects;
  }
  const projectIds = new Set<string>();
  value.forEach((item, i) => {
    const prefix = `hub.projects[${i}]`;
    if (!isRecord(item)) {
      issues.add("hub.project.type", prefix, "project must be an object");
      return;
    }
    const before = issues.issues.length;
    checkNoUnknownFields(item, ["id", "domain", "asset_rel_path", "status"], prefix, "hub.project.unknown-field", issues);
    const id = readRequiredString(item, "id", prefix, "hub.project.id.invalid", issues);
    const domain = readRequiredString(item, "domain", prefix, "hub.project.domain.invalid", issues);
    const assetRelPath = readRequiredString(item, "asset_rel_path", prefix, "hub.project.asset_rel_path.invalid", issues);
    if (id !== undefined) {
      if (!isId(id)) {
        issues.add("hub.project.id.invalid", `${prefix}.id`, `id must match ${ID_PATTERN}`);
      } else if (projectIds.has(id)) {
        issues.add("hub.project.id.duplicate", `${prefix}.id`, `duplicate project id: ${id}`);
      } else {
        projectIds.add(id);
      }
    }
    if (domain !== undefined && !domainIds.has(domain)) {
      issues.add("hub.project.domain.ref", `${prefix}.domain`, `domain must reference a registered domain: ${domain}`);
    }
    if (assetRelPath !== undefined) {
      const problems = portabilityIssues(assetRelPath);
      for (const m of problems) issues.add("hub.project.asset_rel_path.invalid", `${prefix}.asset_rel_path`, `asset_rel_path ${m}`);
      if (problems.length === 0 && !(assetRelPath.startsWith("projects/") && assetRelPath.length > "projects/".length)) {
        issues.add("hub.project.asset_rel_path.invalid", `${prefix}.asset_rel_path`, "asset_rel_path must begin with projects/ and name a child path");
      }
    }
    const status = item.status;
    if (status !== "active" && status !== "archived") {
      issues.add("hub.project.status.invalid", `${prefix}.status`, 'status must be "active" or "archived"');
    }
    if (issues.issues.length === before) {
      projects.push({ id: id as string, domain: domain as string, asset_rel_path: assetRelPath as string, status: status as "active" | "archived" });
    }
  });
  return projects;
}

export function decodeHub(input: unknown): DecodeResult<HubV4> {
  const issues = new IssueCollector();
  if (!isRecord(input)) {
    issues.add("hub.root.type", "hub", "hub.json root must be an object");
    return failure(issues.issues);
  }
  checkNoUnknownFields(input, ["schema_version", "domains", "resources", "projects"], "hub", "hub.unknown-field", issues);

  // Schema version: the unified numeric `schema_version: 1` (matches every
  // other contract). The legacy string `version: "4"` form is deliberately NOT
  // accepted — unified schema (P2-2) dropped the legacy read path.
  readVersion(issues, "hub.version.unsupported", "hub.schema_version", input.schema_version, [1]);

  const domainIds = new Set<string>();
  const domains = decodeDomains(input.domains, domainIds, issues);
  const resources = decodeResources(input.resources, domainIds, issues);
  const projects = decodeProjects(input.projects, domainIds, issues);

  if (!issues.ok) return failure(issues.issues);
  return success({ schema_version: 1, domains, resources, projects });
}
