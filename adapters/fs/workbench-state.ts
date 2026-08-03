// adapters/fs/workbench-state.ts — filesystem repository for workbench state.
// Owns JSON reads, deterministic atomic writes, and paired hub/local mutation
// with best-effort compensation. CLI consumers never parse raw JSON here.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  type ContractIssue,
  type DecodeResult,
  type FileRead,
} from "../../core/contracts/diagnostics.ts";
import { HUB_FILE, LOCAL_FILE, MARKER_FILE } from "../../core/contracts/files.ts";
import { decodeHub, type HubV4 } from "../../core/contracts/hub.ts";
import { decodeLocal, type LocalStateV1 } from "../../core/contracts/local.ts";
import { decodeMarker, type WorkbenchMarkerV1 } from "../../core/contracts/workbench.ts";

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function parseJsonFile(file: string, code: string, pathLabel: string): { data: unknown } | { issue: ContractIssue } {
  try {
    return { data: JSON.parse(readFileSync(file, "utf-8")) };
  } catch (e) {
    return {
      issue: {
        code,
        path: pathLabel,
        message: `${basename(file)} is not valid JSON: ${(e as Error).message}`,
      },
    };
  }
}

function readContract<T>(
  root: string,
  file: string,
  code: string,
  pathLabel: string,
  decode: (v: unknown) => DecodeResult<T>,
): FileRead<T> {
  const p = join(root, file);
  if (!isFile(p)) return { status: "missing" };
  const parsed = parseJsonFile(p, code, pathLabel);
  if ("issue" in parsed) return { status: "invalid", issues: [parsed.issue] };
  const decoded = decode(parsed.data);
  return decoded.ok
    ? { status: "ok", value: decoded.value }
    : { status: "invalid", issues: decoded.issues };
}

export const readHub = (root: string): FileRead<HubV4> =>
  readContract(root, HUB_FILE, "hub.json.parse", "hub", decodeHub);
export const readLocal = (root: string): FileRead<LocalStateV1> =>
  readContract(root, LOCAL_FILE, "local.json.parse", "local", decodeLocal);
export const readMarker = (root: string): FileRead<WorkbenchMarkerV1> =>
  readContract(root, MARKER_FILE, "marker.json.parse", "marker", decodeMarker);

export interface WorkbenchStateReads {
  root: string;
  hub: FileRead<HubV4>;
  marker: FileRead<WorkbenchMarkerV1>;
  local: FileRead<LocalStateV1>;
}

export function readWorkbenchState(root: string): WorkbenchStateReads {
  return { root, hub: readHub(root), marker: readMarker(root), local: readLocal(root) };
}

// ---- deterministic writes ----

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

let tmpCounter = 0;
function tmpSibling(p: string): string {
  tmpCounter += 1;
  return join(dirname(p), `.${basename(p)}.tmp.${process.pid}.${tmpCounter}`);
}

function cleanupTemps(paths: string[]): void {
  for (const p of paths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort cleanup
    }
  }
}

/** Atomic single-file write: temp sibling + rename. */
export function writeBytesAtomic(p: string, content: string): void {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = tmpSibling(p);
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, p);
}

export function writeJsonAtomic(p: string, value: unknown): void {
  writeBytesAtomic(p, formatJson(value));
}

export function writeHubAtomic(root: string, hub: HubV4): void {
  writeJsonAtomic(join(root, HUB_FILE), hub);
}

export function writeLocalAtomic(root: string, local: LocalStateV1): void {
  writeJsonAtomic(join(root, LOCAL_FILE), local);
}

export function writeMarkerAtomic(root: string, marker: WorkbenchMarkerV1): void {
  writeJsonAtomic(join(root, MARKER_FILE), marker);
}

// ---- paired hub/local mutation ----

export class PairedWriteError extends Error {}

function restoreFromOriginal(p: string, original: string | null): Error | null {
  try {
    if (original === null) {
      if (existsSync(p)) unlinkSync(p);
    } else {
      writeBytesAtomic(p, original);
    }
    return null;
  } catch (e) {
    return e as Error;
  }
}

/**
 * Write hub + local together. The encoded bytes are re-decoded to assert
 * invariants before touching disk. Both temp siblings are staged before the
 * first rename; if the second rename fails the first is restored from its
 * original bytes (best-effort compensation) and the failure surfaces explicitly.
 * Power loss can still leave an orphan binding or unbound reference — doctor
 * makes both visible; no strong cross-file transaction is claimed.
 */
export function writeHubAndLocal(root: string, hub: HubV4, local: LocalStateV1): void {
  const hubPath = join(root, HUB_FILE);
  const localPath = join(root, LOCAL_FILE);
  const hubContent = formatJson(hub);
  const localContent = formatJson(local);

  const dh = decodeHub(JSON.parse(hubContent));
  const dl = decodeLocal(JSON.parse(localContent));
  if (!dh.ok || !dl.ok) {
    throw new PairedWriteError("internal invariant violation: encoded hub/local state does not decode");
  }

  mkdirSync(dirname(hubPath), { recursive: true });
  const hubOriginal = isFile(hubPath) ? readFileSync(hubPath, "utf-8") : null;
  const localOriginal = isFile(localPath) ? readFileSync(localPath, "utf-8") : null;

  const hubTmp = tmpSibling(hubPath);
  const localTmp = tmpSibling(localPath);
  writeFileSync(hubTmp, hubContent, "utf-8");
  writeFileSync(localTmp, localContent, "utf-8");

  try {
    renameSync(hubTmp, hubPath);
  } catch (e) {
    cleanupTemps([hubTmp, localTmp]);
    throw e;
  }

  try {
    renameSync(localTmp, localPath);
  } catch (e) {
    cleanupTemps([localTmp]);
    const restoreError = restoreFromOriginal(hubPath, hubOriginal);
    if (restoreError) {
      throw new PairedWriteError(
        `hub/local paired write failed and hub restore failed: ${(e as Error).message}; ${restoreError.message}`,
      );
    }
    throw new PairedWriteError(
      `hub/local paired write failed; hub restored to previous state: ${(e as Error).message}`,
    );
  }
}
