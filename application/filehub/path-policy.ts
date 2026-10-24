// application/filehub/path-policy.ts — shared path policy for the filehub
// scanner, bundle preflight and bundle traversal. Keep this heuristic in one
// place so staging cannot copy a path that check refuses to read.

/** Heuristic restricted path, not a content DLP. It names locations that bundle
 *  staging must refuse and check must never read on a page/manifest's demand. */
export function isRestrictedPath(relPath: string): boolean {
  const segments = relPath.toLowerCase().split("/");
  if (segments.some((segment) => segment === "secrets" || segment === "credentials")) return true;
  const base = segments.at(-1) ?? "";
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    /\.(pem|key|p12|pfx)$/.test(base) ||
    /^id_(rsa|ed25519)/.test(base) ||
    base.includes("credential") ||
    base.includes("secret")
  );
}

/** Paths inside the managed bundle metadata directory are program-owned and
 *  never bundle members. */
export function isBundleMetadataPath(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, "/").split("/");
  for (let index = 0; index + 1 < segments.length; index++) {
    if (segments[index] === ".jspace" && segments[index + 1] === "bundles") return true;
  }
  return false;
}
