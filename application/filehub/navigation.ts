// application/filehub/navigation.ts — derived filehub navigation blocks.
//
// Navigation is a VIEW of registry + owner entries, never a second source of
// truth: active/archived come only from hub `projects[].status`, areas only
// from direct `areas/*` directories, and nothing reads project plans or writes
// gbrain. The two blocks live in their own managed markers so the static
// `filehub upgrade` contract block can never overwrite them.

import { posix } from "node:path";

export const NAV_BLOCK_START = "<!-- JSPACE:FILEHUB:NAV:START -->";
export const NAV_BLOCK_END = "<!-- JSPACE:FILEHUB:NAV:END -->";
export const NAV_PROJECTS_BLOCK_START = "<!-- JSPACE:FILEHUB:NAV:PROJECTS:START -->";
export const NAV_PROJECTS_BLOCK_END = "<!-- JSPACE:FILEHUB:NAV:PROJECTS:END -->";

export const NAV_VERSION = 1;

export interface NavProject {
  id: string;
  status: string;
  /** Filehub-relative owner root, e.g. `projects/acme`. */
  assetRelPath: string;
  /** Whether `<owner root>/index.md` exists as a readable regular file. */
  hasIndex: boolean;
}

export interface NavArea {
  id: string;
  hasIndex: boolean;
}

export interface NavInput {
  projects: readonly NavProject[];
  areas: readonly NavArea[];
  /** Direct `projects/*` directories that no registered project owns. */
  unregistered: readonly string[];
}

function cmpBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Escape a name for Markdown link text. */
function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

/** Percent-encode a relative target so spaces, parentheses and angle brackets
 *  can never end the link early or inject markup. Keeps `/` and `:` intact. */
function encodeTarget(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[()<>"'`]/g, (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join("/");
}

function entryLink(target: string, text: string): string {
  return `- [${escapeText(text)}](${encodeTarget(target)})`;
}

/** Root README view: active projects + areas + the full-directory entry.
 *  Archived projects stay out of the daily entry; one link reaches all of them. */
export function renderRootNavBlock(input: NavInput): string {
  const active = [...input.projects]
    .filter((project) => project.status === "active")
    .sort((a, b) => cmpBytes(a.assetRelPath, b.assetRelPath));
  const areas = [...input.areas].sort((a, b) => cmpBytes(a.id, b.id));

  const lines = [NAV_BLOCK_START, `> filehub-nav-version: ${NAV_VERSION}`, "", "## 活跃项目"];
  if (active.length === 0) {
    lines.push("- （无）");
  } else {
    for (const project of active) {
      const indexPath = `${project.assetRelPath}/index.md`;
      lines.push(
        project.hasIndex
          ? `${entryLink(indexPath, project.id)} — \`project:${project.id}\``
          : `- ${escapeText(project.id)} — 待补 \`${indexPath}\``,
      );
    }
  }

  lines.push("", "## 长期主题");
  if (areas.length === 0) {
    lines.push("- （无）");
  } else {
    for (const area of areas) {
      const indexPath = `areas/${area.id}/index.md`;
      lines.push(
        area.hasIndex
          ? `${entryLink(indexPath, area.id)} — \`area:${area.id}\``
          : `- ${escapeText(area.id)} — 待补 \`${indexPath}\``,
      );
    }
  }

  lines.push(
    "",
    "## 完整项目目录",
    entryLink("projects/README.md", "全部项目（活跃 / 已结束）"),
    NAV_BLOCK_END,
  );
  return lines.join("\n");
}

/** `projects/README.md` view: every registered project, split by status, plus
 *  physical directories nobody registered (a gap, never a guessed status). */
export function renderProjectsNavBlock(input: NavInput): string {
  const sorted = [...input.projects].sort((a, b) => cmpBytes(a.assetRelPath, b.assetRelPath));
  const section = (title: string, projects: readonly NavProject[]): string[] => {
    const out = ["", `## ${title}`];
    if (projects.length === 0) {
      out.push("- （无）");
      return out;
    }
    for (const project of projects) {
      const indexPath = `${project.assetRelPath}/index.md`;
      const target = posix.relative("projects", indexPath);
      out.push(
        project.hasIndex
          ? `${entryLink(target, project.id)} — \`project:${project.id}\``
          : `- ${escapeText(project.id)} — 待补 \`${indexPath}\``,
      );
    }
    return out;
  };

  const lines = [
    NAV_PROJECTS_BLOCK_START,
    `> filehub-nav-projects-version: ${NAV_VERSION}`,
    ...section(
      "活跃项目",
      sorted.filter((project) => project.status === "active"),
    ),
    ...section(
      "已结束项目",
      sorted.filter((project) => project.status !== "active"),
    ),
  ];
  if (input.unregistered.length > 0) {
    lines.push("", "## 待补归属");
    for (const rel of [...input.unregistered].sort(cmpBytes)) {
      lines.push(`- \`${escapeText(rel)}/\` — 未登记为项目`);
    }
  }
  lines.push(NAV_PROJECTS_BLOCK_END);
  return lines.join("\n");
}
