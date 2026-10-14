import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { verifySources, sourcesCheckPassed, sourcesEvidenceTable } from "../../src/verifiers/sources.js";
import type { ResearchOutput } from "../../src/stages/schemas.js";
import type { LLMProvider, StructuredResult } from "../../src/llm/types.js";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/doc") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>Redis SET docs</title><body>Redis SET supports expiration with the EX option.</body></html>");
    } else if (req.url === "/offtopic") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("This page discusses gardening tips for roses and tulips.");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
  research = {
    thesis: "Redis SET supports TTL.",
    prerequisites: [],
    learningObjectives: [],
    misconceptions: [],
    claims: [
      { id: "c1", text: "Redis SET supports expiration with the EX option.", kind: "doc-fact", sourceIds: ["s1"] },
      { id: "c2", text: "Redis was written in 2009.", kind: "doc-fact", sourceIds: ["s2"] }
    ],
    sources: [
      { id: "s1", requestedUrl: `http://127.0.0.1:${port}/doc`, sourceType: "docs", retrievalStatus: "not_fetched" },
      { id: "s2", requestedUrl: `http://127.0.0.1:${port}/offtopic`, sourceType: "docs", retrievalStatus: "not_fetched" },
      { id: "s3", requestedUrl: `http://127.0.0.1:${port}/missing`, sourceType: "docs", retrievalStatus: "not_fetched" }
    ],
    evidenceGaps: [],
    versionSensitiveClaims: []
  };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fetchOpts = {
  maxRedirects: 3,
  timeoutMs: 5000,
  maxResponseBytes: 100_000,
  allowedDomains: [],
  allowPrivateAddresses: true
};

let research: ResearchOutput;

function fakeLLM(verdict: "supports" | "does_not_support" | "cannot_determine", quote: string | null): LLMProvider {
  return {
    name: "mock",
    async generateStructured<T>(req: { label: string }): Promise<StructuredResult<T>> {
      const data = { verdict, evidenceQuote: quote, evidenceLocation: "body", rationale: "because" } as unknown as T;
      return { data, raw: "", promptHash: "h", model: "mock-model", usage: { inputTokens: 1, outputTokens: 1 }, retries: 0, durationMs: 1 };
    }
  };
}

function testRunDir(): string {
  const dir = join(tmpdir(), `sources-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("source verifier", () => {
  it("records fetch evidence: status, hash, title, extract", async () => {
    const runDir = testRunDir();
    const result = await verifySources({ runDir, research, fetchOptions: fetchOpts, llm: null, supportModel: "x" });
    const s1 = result.sources.find((s) => s.sourceId === "s1");
    expect(s1?.httpStatus).toBe(200);
    expect(s1?.contentHash).toHaveLength(64);
    expect(s1?.pageTitle).toBe("Redis SET docs");
    expect(s1?.evidenceExtract).toContain("EX option");
    expect(result.sources.find((s) => s.sourceId === "s3")?.retrievalError).toBeTruthy();
  });

  it("flags a claim citing a source missing from research", async () => {
    const runDir = testRunDir();
    const badResearch: ResearchOutput = {
      ...research,
      claims: [...research.claims, { id: "c9", text: "x", kind: "doc-fact", sourceIds: ["s404"] }]
    };
    const result = await verifySources({ runDir, research: badResearch, fetchOptions: fetchOpts, llm: null, supportModel: "x" });
    expect(result.issues.some((i) => i.message.includes("unknown source s404"))).toBe(true);
  });

  it("stores model-assessed support separately and labeled, rejecting fabricated quotes", async () => {
    const runDir = testRunDir();
    const result = await verifySources({
      runDir,
      research,
      fetchOptions: fetchOpts,
      llm: fakeLLM("supports", "fabricated quote not in page"),
      supportModel: "mock-model"
    });
    const c1 = result.modelAssessedSupport.find((a) => a.claimId === "c1");
    expect(c1?.label).toBe("model_assessed_support");
    // fabricated quote -> cannot_determine
    expect(c1?.verdict).toBe("cannot_determine");
    const c2 = result.modelAssessedSupport.find((a) => a.claimId === "c2");
    // offtopic page does not contain the fabricated claim evidence: quote null -> verdict passes through but is model-assessed only
    expect(c2?.label).toBe("model_assessed_support");
  });

  it("keeps claims unverified when the source could not be fetched", async () => {
    const runDir = testRunDir();
    const onlyMissing: ResearchOutput = {
      ...research,
      claims: [{ id: "c1", text: "x", kind: "doc-fact", sourceIds: ["s3"] }],
      sources: research.sources.filter((s) => s.id === "s3")
    };
    const result = await verifySources({ runDir, research: onlyMissing, fetchOptions: fetchOpts, llm: fakeLLM("supports", null), supportModel: "m" });
    expect(result.claimMapping[0]?.allSourcesFetched).toBe(false);
    expect(sourcesCheckPassed(result)).toBe(true); // mapping exists; support is separately labeled
  });

  it("warns when no LLM is configured (support skipped, not faked)", async () => {
    const runDir = testRunDir();
    const result = await verifySources({ runDir, research, fetchOptions: fetchOpts, llm: null, supportModel: "x" });
    expect(result.modelAssessedSupport).toHaveLength(0);
    expect(result.issues.some((i) => i.message.includes("No LLM configured"))).toBe(true);
  });

  it("writes the evidence table and persisted artifact", async () => {
    const runDir = testRunDir();
    const result = await verifySources({
      runDir,
      research,
      fetchOptions: fetchOpts,
      llm: fakeLLM("supports", "Redis SET supports expiration with the EX option."),
      supportModel: "mock-model"
    });
    const table = sourcesEvidenceTable(result);
    expect(table).toContain("model_assessed_support");
    expect(table).toContain("Source verification evidence");
  });
});
