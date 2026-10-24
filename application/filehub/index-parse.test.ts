import { describe, expect, test } from "bun:test";
import {
  ASSET_HISTORY_END,
  ASSET_HISTORY_START,
  ASSET_REFERENCES_END,
  ASSET_REFERENCES_START,
  isCurrentOwnershipLine,
  parseOwnerIndex,
} from "./index-parse.ts";

const CURRENT = "| [[report.md]] | document | 2026-10-18 | assets/acme/report |";

function withHistory(lines: string): string {
  return `# Acme\n${ASSET_HISTORY_START}\n${lines}\n${ASSET_HISTORY_END}\n`;
}

function withReferences(lines: string): string {
  return `# Acme\n${ASSET_REFERENCES_START}\n${lines}\n${ASSET_REFERENCES_END}\n`;
}

describe("current ownership rows", () => {
  test("parses a four-column row", () => {
    const parsed = parseOwnerIndex(`# Acme\n${CURRENT}\n`);
    expect(parsed.current).toEqual([
      { path: "report.md", type: "document", date: "2026-10-18", slug: "assets/acme/report", line: 2 },
    ]);
    expect(parsed.issues).toEqual([]);
  });

  test("skips rows inside fences, block quotes and HTML comments", () => {
    const raw = [
      "# Acme",
      "```md",
      "| fenced.md | document | 2026-10-18 | assets/acme/fenced |",
      "```",
      "> | quoted.md | document | 2026-10-18 | assets/acme/quoted |",
      "<!--",
      "| commented.md | document | 2026-10-18 | assets/acme/commented |",
      "-->",
      "~~~",
      "| tilde.md | document | 2026-10-18 | assets/acme/tilde |",
      "~~~",
      CURRENT,
    ].join("\n");
    const parsed = parseOwnerIndex(raw);
    expect(parsed.current.map((row) => row.slug)).toEqual(["assets/acme/report"]);
  });

  test("a three-column row is not a current ownership row", () => {
    const parsed = parseOwnerIndex("# Acme\n| 2026-10-18 | doc.txt | assets/acme/doc |\n");
    expect(parsed.current).toEqual([]);
  });
});

describe("history rows", () => {
  test("requires one local link and a backticked strict slug", () => {
    const parsed = parseOwnerIndex(
      withHistory("- [old.md](old.md) — `assets/acme/old`\n- [no-slug.md](no-slug.md)\nplain text"),
    );
    expect(parsed.history).toEqual([
      { path: "old.md", slug: "assets/acme/old", label: "old.md", line: 3 },
    ]);
    expect(parsed.issues.map((issue) => issue.code)).toEqual([
      "history_unregistered",
      "history_entry_invalid",
    ]);
  });

  test("a slug-shaped number of segments is required", () => {
    const parsed = parseOwnerIndex(withHistory("- [deep.md](deep.md) — `assets/acme/deep/v2`\n"));
    expect(parsed.history).toEqual([]);
    expect(parsed.issues[0]?.code).toBe("history_unregistered");
  });

  test("history never enters current ownership", () => {
    const parsed = parseOwnerIndex(withHistory(`- [report.md](report.md) — \`assets/acme/report\``));
    expect(parsed.current).toEqual([]);
    expect(parsed.history).toHaveLength(1);
  });
});

describe("reference rows", () => {
  test("keeps ownership out and parses local, anchor and external targets", () => {
    const parsed = parseOwnerIndex(
      withReferences(
        [
          "- [bundle](../other/doc.pdf)",
          "- [section](#overview)",
          "- [site](https://example.com/doc) `assets/acme/site`",
        ].join("\n"),
      ),
    );
    expect(parsed.references).toEqual([
      { target: "../other/doc.pdf", kind: "relative", line: 3 },
      { target: "#overview", kind: "anchor", line: 4 },
      {
        target: "https://example.com/doc",
        kind: "external",
        slug: "assets/acme/site",
        line: 5,
      },
    ]);
    expect(parsed.current).toEqual([]);
    expect(parsed.issues).toEqual([]);
  });

  test("parses sha256 and bundle digests only with a slug", () => {
    const hex = "a".repeat(64);
    const parsed = parseOwnerIndex(
      withReferences(
        [
          `- [locked](../other/doc.pdf) \`assets/acme/doc\` \`sha256:${hex}\``,
          `- [bundle](../other/kit.zip) \`assets/acme/kit\` \`bundle-sha256:${hex}\``,
          `- [unlocked](../other/other.pdf) \`sha256:${hex}\``,
        ].join("\n"),
      ),
    );
    expect(parsed.references[0]?.digest).toEqual({ algorithm: "sha256", value: hex });
    expect(parsed.references[1]?.digest).toEqual({ algorithm: "bundle-sha256", value: hex });
    expect(parsed.references[2]?.digest).toBeUndefined();
    expect(parsed.issues.map((issue) => issue.code)).toEqual(["reference_digest_without_slug"]);
  });

  test("rejects a malformed digest value", () => {
    const parsed = parseOwnerIndex(
      withReferences("- [doc](../doc.pdf) `assets/acme/doc` `sha256:ABC`\n"),
    );
    expect(parsed.references[0]?.digest).toBeUndefined();
    expect(parsed.issues[0]?.code).toBe("reference_digest_invalid");
  });

  test("a malformed bullet is an issue, not a reference", () => {
    const parsed = parseOwnerIndex(withReferences("not a link\n"));
    expect(parsed.references).toEqual([]);
    expect(parsed.issues[0]?.code).toBe("reference_entry_invalid");
  });
});

describe("markers", () => {
  test("accepts one closed pair per section", () => {
    const parsed = parseOwnerIndex(`${withHistory("- [a.md](a.md) — \`assets/acme/a\`")}${withReferences("- [b](../b)")}`);
    expect(parsed.issues).toEqual([]);
  });

  test("reports duplicate, nested and reverse markers", () => {
    expect(parseOwnerIndex(`${withHistory("")}${ASSET_HISTORY_START}\n${ASSET_HISTORY_END}\n`).issues.map((i) => i.code)).toContain(
      "marker_duplicate",
    );
    expect(
      parseOwnerIndex(`${ASSET_HISTORY_START}\n${ASSET_REFERENCES_START}\n`).issues.map((i) => i.code),
    ).toContain("marker_nested");
    expect(parseOwnerIndex(`${ASSET_HISTORY_END}\n`).issues.map((i) => i.code)).toContain("marker_reverse");
  });

  test("reports mismatched and unclosed markers", () => {
    expect(
      parseOwnerIndex(`${ASSET_HISTORY_START}\n${ASSET_REFERENCES_END}\n`).issues.map((i) => i.code),
    ).toContain("marker_mismatched");
    expect(parseOwnerIndex(`${ASSET_REFERENCES_START}\n- [x](../x)\n`).issues.map((i) => i.code)).toContain(
      "marker_unclosed",
    );
  });

  test("marker lines inside a fence are examples, not structure", () => {
    const parsed = parseOwnerIndex(`\`\`\`md\n${ASSET_HISTORY_START}\n\`\`\`\n- [plain.md](plain.md)\n`);
    expect(parsed.issues).toEqual([]);
    expect(parsed.history).toEqual([]);
    expect(parsed.unmarkedLinks).toBe(1);
  });
});

describe("unmarked links", () => {
  test("stay readable but are counted as unverified navigation", () => {
    const parsed = parseOwnerIndex("# Acme\n- [report.md](report.md)\n- [plain](plain)\n");
    expect(parsed.unmarkedLinks).toBe(2);
    expect(parsed.references).toEqual([]);
  });
});

describe("isCurrentOwnershipLine", () => {
  test("accepts the exact current row and rejects identical text elsewhere", () => {
    const content = [
      "# Acme",
      "```md",
      CURRENT,
      "```",
      ASSET_HISTORY_START,
      `- [report.md](report.md) — \`assets/acme/report\``,
      ASSET_HISTORY_END,
      CURRENT,
    ].join("\n");
    expect(isCurrentOwnershipLine(content, CURRENT)).toBe(true);
  });

  test("a line that only appears in a fence is not ownership", () => {
    const content = `# Acme\n\`\`\`md\n${CURRENT}\n\`\`\`\n`;
    expect(isCurrentOwnershipLine(content, CURRENT)).toBe(false);
  });

  test("an identical line with an unsupported slug is not ownership", () => {
    const line = "| report.md | document | 2026-10-18 | assets/acme/report/v2 |";
    expect(isCurrentOwnershipLine(`# Acme\n${line}\n`, line)).toBe(false);
  });
});
