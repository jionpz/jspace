// core/contracts/ids.ts — shared identifier contract. All logical ids,
// entrypoint ids and binding keys follow the same lowercase/digit/hyphen pattern.
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isId(s: string): boolean {
  return ID_PATTERN.test(s);
}
