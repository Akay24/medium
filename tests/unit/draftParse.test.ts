import { describe, it, expect } from "vitest";
import { parseDraft, stripClaimMarkers, proseWordCount, readingTimeMinutes, firstPersonTestingStatements } from "../../src/stages/draftParse.js";
import { sha256 } from "../../src/util/hash.js";

const markdown = `# Redis caching

Redis SET supports TTL <!-- claim:c1 -->.

\`\`\`ts run=redis-basic
import { createClient } from "redis";
const client = createClient();
await client.connect();
\`\`\`

<!-- diagram:cache-aside -->

## Notes

[AUTHOR: confirm tone]
`;

describe("draft parsing", () => {
  it("extracts claim markers and flags unknown ids", () => {
    const parsed = parseDraft(markdown, new Set(["c1", "c2"]));
    expect(parsed.claimMarkers).toHaveLength(1);
    expect(parsed.claimMarkers[0]?.claimId).toBe("c1");
    expect(parsed.issues.unknownClaimIds).toHaveLength(0);
  });

  it("extracts code blocks with run specs and stable ids + hashes", () => {
    const parsed = parseDraft(markdown, new Set(["c1"]));
    expect(parsed.codeBlocks).toHaveLength(1);
    const block = parsed.codeBlocks[0];
    expect(block?.runSpec).toBe("redis-basic");
    expect(block?.sha256).toBe(sha256('import { createClient } from "redis";\nconst client = createClient();\nawait client.connect();\n'));
  });

  it("extracts diagram refs", () => {
    const parsed = parseDraft(markdown, new Set(["c1"]));
    expect(parsed.diagramRefs).toEqual(["cache-aside"]);
  });

  it("stripClaimMarkers removes markers without changing other text", () => {
    const stripped = stripClaimMarkers(markdown);
    expect(stripped).not.toContain("<!-- claim:c1 -->");
    expect(stripped).toContain("Redis SET supports TTL");
    expect(stripped).toContain("```ts run=redis-basic");
  });

  it("prose word count excludes code blocks", () => {
    const count = proseWordCount(markdown);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(30);
    expect(readingTimeMinutes(markdown)).toBeGreaterThanOrEqual(1);
  });

  it("detects first-person testing statements", () => {
    expect(firstPersonTestingStatements("I tested this in production.")[0]).toBeDefined();
    expect(firstPersonTestingStatements("We measured latency improvements.")[0]).toBeDefined();
    expect(firstPersonTestingStatements("Redis is fast.")).toHaveLength(0);
  });
});
