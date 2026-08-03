// core/contracts/files.ts — state file paths within a workbench. Shared by the
// filesystem repository (adapters) and runtime inspection (core/registry).
export const HUB_FILE = ".jspace/hub.json";
/** Legacy alias for the hub registry file path (v3-era naming). */
export const REGISTRY_FILE = HUB_FILE;
export const LOCAL_FILE = ".jspace/local.json";
export const MARKER_FILE = ".jspace/marker.json";
