import { describe, it, expect } from "vitest";
import { verifyConsistency, type ConsistencyVerifierInput } from "../../src/verifiers/consistency.js";
import type { ResearchOutput } from "../../src/stages/schemas.js";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const research: ResearchOutput = {
  thesis: "Caching trades latency for staleness risk.",
  prerequisites: [],
  learningObjectives: [],
  misconceptions: [],
  claims: [
    { id: "c1", text: "Redis SET supports TTL via the EX option.", kind: "doc-fact", sourceIds: ["s1"] },
    { id: "c2", text: "Cache stampede protection matters under load.", kind: "derived", sourceIds: [] }
  ],
  sources: [{ id: "s1", requestedUrl: "https://redis.io/docs/set", sourceType: "docs", retrievalStatus: "not_fetched" }],
  evidenceGaps: [],
  versionSensitiveClaims: ["c1"]
};

const baseArticle = `# Title

Some intro text here with a fact <!-- claim:c1 --> and derived reasoning <!-- claim:c2 -->.

## Section A

Body text.

## Section B

More body text without claims.
`;

function makeInput(overrides?: Partial<ConsistencyVerifierInput>): ConsistencyVerifierInput {
  const runDir = join(tmpdir(), `consistency-${Date.now()}`);
  mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    articleMarkdown: baseArticle,
    research,
    visuals: null,
    metadata: null,
    codeVerification: null,
    authorAssertions: [],
    phraseWarnings: { enabled: true, phrases: ["in conclusion"] },
    ...overrides
  };
}

function issues(input: ConsistencyVerifierInput, check: string) {
  return verifyConsistency(input).issues.filter((i) => i.check === check);
}

describe("consistency verifier", () => {
  it("passes a clean article", () => {
    const result = verifyConsistency(makeInput());
    expect(result.passed).toBe(true);
  });

  it("flags unresolved placeholders as errors", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\n[AUTHOR: add anecdote here]" }));
    expect(result.passed).toBe(false);
    expect(issues(makeInput({ articleMarkdown: baseArticle + "\n[AUTHOR: add anecdote here]" }), "placeholders")).toHaveLength(1);
  });

  it("flags claim markers referencing nonexistent claim ids", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\nBad ref <!-- claim:c99 -->" }));
    expect(result.passed).toBe(false);
    expect(issues(makeInput({ articleMarkdown: baseArticle + "\nBad ref <!-- claim:c99 -->" }), "claim-ids").length).toBeGreaterThan(0);
  });

  it("flags claims citing sources absent from research", () => {
    const result = verifyConsistency(makeInput());
    expect(issues(makeInput(), "source-ids")).toHaveLength(0);
    const badResearch: ResearchOutput = { ...research, claims: [...research.claims, { id: "c3", text: "x", kind: "doc-fact", sourceIds: ["s404"] }] };
    expect(issues(makeInput({ research: badResearch }), "source-ids").length).toBeGreaterThan(0);
    void result;
  });

  it("flags first-person testing claims without author assertions", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\nI tested this in production and it worked." }));
    expect(result.passed).toBe(false);
    expect(issues(makeInput({ articleMarkdown: baseArticle + "\nI tested this in production and it worked." }), "personal-experience")).toHaveLength(1);
  });

  it("allows first-person claims backed by an author assertion", () => {
    const result = verifyConsistency(
      makeInput({ articleMarkdown: baseArticle + "\nI tested this in production and it worked.", authorAssertions: ["I tested this in production and it worked."] })
    );
    expect(result.passed).toBe(true);
  });

  it("warns on version-sensitive claims without version qualifiers", () => {
    const found = issues(makeInput(), "version-qualifier");
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("warning");
  });

  it("flags duplicate headings", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\n## Section A" }));
    expect(result.passed).toBe(false);
  });

  it("flags code drift between article bytes and tested bytes", () => {
    const result = verifyConsistency(
      makeInput({
        codeVerification: {
          generatedAt: "2026-01-01T00:00:00.000Z",
          sandbox: "fake",
          sandboxAvailable: true,
          checks: [{ codeId: "redis-basic", status: "passed", runSpec: "redis-basic", sourceSha256: "differenthash", repetitions: 1, exitCodes: [0], logs: [], toolVersions: {}, untestedBehaviors: [], materializedSha256Matches: false }]
        },
        articleMarkdown: baseArticle + "\n```ts run=redis-basic\nconst x = 1;\n```\n"
      })
    );
    expect(result.passed).toBe(false);
    expect(issues(makeInput({
      codeVerification: {
        generatedAt: "2026-01-01T00:00:00.000Z",
        sandbox: "fake",
        sandboxAvailable: true,
        checks: [{ codeId: "redis-basic", status: "passed", runSpec: "redis-basic", sourceSha256: "differenthash", repetitions: 1, exitCodes: [0], logs: [], toolVersions: {}, untestedBehaviors: [], materializedSha256Matches: false }]
      },
      articleMarkdown: baseArticle + "\n```ts run=redis-basic\nconst x = 1;\n```\n"
    }), "code-drift")).toHaveLength(1);
  });

  it("flags drafts referencing missing diagrams", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\n<!-- diagram:flow-1 -->" }));
    expect(result.passed).toBe(false);
  });

  it("emits phrase warnings without failing", () => {
    const result = verifyConsistency(makeInput({ articleMarkdown: baseArticle + "\nIn conclusion, caching is great." }));
    expect(result.passed).toBe(true);
    expect(issues(makeInput({ articleMarkdown: baseArticle + "\nIn conclusion, caching is great." }), "phrase-lint")[0]?.severity).toBe("warning");
  });

  it("flags empty required metadata", () => {
    const result = verifyConsistency(
      makeInput({
        metadata: {
          headline: "",
          alternativeHeadlines: ["a", "b"],
          subtitle: "s",
          excerpt: "e",
          tags: [],
          readingTimeMinutes: 5,
          coverAltText: "alt",
          series: { name: null, articleNumber: null },
          navigation: { previous: null, next: null, roadmap: null },
          relatedArticles: [],
          suggestedSection: null,
          platformLimits: {
            tags: { value: 5, lastVerifiedAt: null, sourceUrl: null, unverified: true },
            title: { value: 100, lastVerifiedAt: null, sourceUrl: null, unverified: true },
            subtitle: { value: 140, lastVerifiedAt: null, sourceUrl: null, unverified: true }
          }
        }
      })
    );
    expect(result.passed).toBe(false);
  });
});
