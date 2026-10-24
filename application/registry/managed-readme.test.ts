import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkWritable,
  decodeUtf8Strict,
  inspectManagedBlock,
  markerLineStarts,
  planManagedBlock,
  replaceManagedBlock,
} from "./managed-readme.ts";

const START = "<!-- T:START -->";
const END = "<!-- T:END -->";
const BLOCK = `${START}\nnew\n${END}`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jspace-managed-readme-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("markerLineStarts and inspectManagedBlock", () => {
  test("ignores markers inside fences and only accepts whole trimmed lines", () => {
    const content = ["# Doc", "```md", START, END, "```", `  ${START}`, ` ${END} `].join("\n");
    expect(markerLineStarts(content, START)).toHaveLength(1);
    const state = inspectManagedBlock(content, START, END);
    expect(state.kind).toBe("ok");
  });

  test("distinguishes none from each malformed shape", () => {
    expect(inspectManagedBlock("# Doc\n", START, END).kind).toBe("none");
    expect(inspectManagedBlock(`${START}\n`, START, END)).toMatchObject({
      kind: "malformed",
      reason: "only one marker present",
    });
    expect(inspectManagedBlock(`${END}\n${START}\n`, START, END)).toMatchObject({
      kind: "malformed",
      reason: "end marker appears before start marker",
    });
    expect(inspectManagedBlock(`${START}\n${START}\n${END}\n`, START, END)).toMatchObject({
      kind: "malformed",
      reason: "duplicate markers",
    });
  });

  test("the returned block includes both markers and nothing else", () => {
    const state = inspectManagedBlock(`before\n${BLOCK}\nafter\n`, START, END);
    expect(state).toEqual({ kind: "ok", block: BLOCK });
  });
});

describe("replaceManagedBlock", () => {
  test("inserts after a BOM and YAML frontmatter, preserving every other byte", () => {
    const original = "﻿---\ntitle: Doc\n---\n# Doc\nbody\n";
    const next = replaceManagedBlock(original, START, END, BLOCK);
    expect(next.startsWith("﻿---\ntitle: Doc\n---\n")).toBe(true);
    expect(next).toContain(`${BLOCK}\n\n# Doc\nbody\n`);
    expect(next.slice(next.indexOf("# Doc"))).toBe("# Doc\nbody\n");
  });

  test("replaces only the managed region and keeps user text on both sides", () => {
    const original = `before\n${START}\nold\n${END}\nafter\n`;
    const next = replaceManagedBlock(original, START, END, BLOCK);
    expect(next).toBe(`before\n${BLOCK}\nafter\n`);
  });

  test("keeps CRLF outside the block", () => {
    const original = `before\r\n${START}\r\nold\r\n${END}\r\nafter\r\n`;
    const next = replaceManagedBlock(original, START, END, BLOCK);
    expect(next).toBe(`before\r\n${BLOCK}\r\nafter\r\n`);
  });

  test("refuses a malformed marker pair", () => {
    expect(() => replaceManagedBlock(`${START}\n`, START, END, BLOCK)).toThrow(/malformed managed block/);
  });
});

describe("decodeUtf8Strict", () => {
  test("accepts valid UTF-8 and rejects invalid bytes instead of substituting", () => {
    expect(decodeUtf8Strict(Buffer.from("中文", "utf-8"))).toBe("中文");
    expect(decodeUtf8Strict(Buffer.from([0xff, 0xfe]))).toBeNull();
  });
});

describe("planManagedBlock", () => {
  test("creates a missing file", () => {
    const path = join(dir, "README.md");
    const plan = planManagedBlock(path, START, END, BLOCK);
    expect(plan.action).toBe("create");
    expect(plan.next).toBe(`${BLOCK}\n`);
    expect(plan.identity).toBeNull();
  });

  test("distinguishes insert, update and no-op", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, "# Doc\n");
    expect(planManagedBlock(path, START, END, BLOCK).action).toBe("insert");

    writeFileSync(path, `before\n${START}\nold\n${END}\nafter\n`);
    const update = planManagedBlock(path, START, END, BLOCK);
    expect(update.action).toBe("update");
    expect(update.next).toBe(`before\n${BLOCK}\nafter\n`);

    writeFileSync(path, `${BLOCK}\n`);
    expect(planManagedBlock(path, START, END, BLOCK).action).toBe("no-op");
  });

  test("a malformed block is a conflict, not a guess", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, `${START}\n`);
    const plan = planManagedBlock(path, START, END, BLOCK);
    expect(plan.action).toBe("conflict");
    expect(plan.conflict).toContain("malformed markers");
    expect(plan.next).toBeNull();
  });

  test("refuses symlinks, directories and invalid UTF-8", () => {
    const target = join(dir, "target.md");
    writeFileSync(target, "# Doc\n");
    const link = join(dir, "link.md");
    symlinkSync(target, link);
    expect(planManagedBlock(link, START, END, BLOCK).action).toBe("conflict");

    expect(planManagedBlock(dir, START, END, BLOCK).action).toBe("conflict");

    const binary = join(dir, "binary.md");
    writeFileSync(binary, Buffer.from([0xff, 0xfe]));
    const plan = planManagedBlock(binary, START, END, BLOCK);
    expect(plan.action).toBe("conflict");
    expect(plan.conflict).toContain("not valid UTF-8");
  });
});

describe("checkWritable", () => {
  test("passes for an unchanged regular file", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, "# Doc\n");
    expect(checkWritable(planManagedBlock(path, START, END, BLOCK))).toBeNull();
  });

  test("detects a concurrent edit between planning and writing", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, "# Doc\n");
    const plan = planManagedBlock(path, START, END, BLOCK);
    writeFileSync(path, "# Doc\nmore\n");
    expect(checkWritable(plan)).toContain("changed while planning");
  });

  test("a no-op plan is writable but needs no identity", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, `${BLOCK}\n`);
    expect(checkWritable(planManagedBlock(path, START, END, BLOCK))).toBeNull();
  });

  test("reports a conflict plan without throwing", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, `${START}\n`);
    expect(checkWritable(planManagedBlock(path, START, END, BLOCK))).toContain("malformed");
  });

  test("a create plan refuses a file that appeared after planning", () => {
    const path = join(dir, "README.md");
    const plan = planManagedBlock(path, START, END, BLOCK);
    expect(plan.action).toBe("create");
    expect(checkWritable(plan)).toBeNull();
    writeFileSync(path, "# someone else\n");
    expect(checkWritable(plan)).toContain("appeared while planning");
  });

  test("detects a file that turned into a symlink", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, "# Doc\n");
    const plan = planManagedBlock(path, START, END, BLOCK);
    const other = join(dir, "other.md");
    writeFileSync(other, "# Doc\n");
    rmSync(path);
    symlinkSync(other, path);
    expect(checkWritable(plan)).toContain("symlink");
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  test.skipIf(process.getuid?.() === 0)("detects an unwritable file", () => {
    const path = join(dir, "README.md");
    writeFileSync(path, "# Doc\n");
    chmodSync(path, 0o444);
    expect(checkWritable(planManagedBlock(path, START, END, BLOCK))).toContain("not writable");
    expect(readFileSync(path, "utf-8")).toBe("# Doc\n");
  });
});
