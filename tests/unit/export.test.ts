import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { initRun, runDirFor } from "../../src/commands/run.js";
import { exportRun, exportBlockers } from "../../src/commands/export.js";
import { loadManifest, saveManifest, stageEntry, type Manifest } from "../../src/run/manifest.js";
import { verifyConsistency } from "../../src/verifiers/consistency.js";
import { sha256, nowIso } from "../../src/util/hash.js";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import type { ResearchOutput, DraftOutput } from "../../src/stages/schemas.js";

const RESEARCH: ResearchOutput = {
  thesis: "Redis caching trades latency for staleness risk.",
  prerequisites: [],
  learningObjectives: [],
  misconceptions: [],
  claims: [{ id: "c1", text: "Redis SET supports EX.", kind: "doc-fact", sourceIds: ["s1"] }],
  sources: [{ id: "s1", requestedUrl: "https://redis.io/docs/set", sourceType: "docs", retrievalStatus: "not_fetched" }],
  evidenceGaps: [],
  versionSensitiveClaims: []
};

const CLEAN_ARTICLE = `# Redis caching\n\nRedis SET supports EX <!-- claim:c1 -->.\n\n## Flow\n\nReads check the cache first.\n`;

function tmpSlug(name: string): string {
  return `export-test-${name}`;
}

/** Build a run fixture with research/draft stages marked passed. */
function buildRun(slug: string, article: string): string {
  const req = `/tmp/opencode/${slug}-request.md`;
  writeFileSync(req, "# request\nbody");
  rmSync(runDirFor(slug), { recursive: true, force: true });
  const { runDir } = initRun(slug, req);
  const manifest = loadManifest(runDir);

  mkdirSync(`${runDir}/research/v1`, { recursive: true });
  writeFileSync(`${runDir}/research/v1/research.json`, JSON.stringify(RESEARCH));

  const code = 'console.log("cache ok");';
  mkdirSync(`${runDir}/draft/v1`, { recursive: true });
  writeFileSync(`${runDir}/draft/v1/article.md`, article);
  const draft: DraftOutput = {
    markdownPath: "article.md",
    claims: [],
    codeBlocks: [{ id: "redis-basic", language: "ts", runSpec: "redis-basic", code, sha256: sha256(code) }],
    diagramRefs: [],
    untestedBehaviors: []
  };
  writeFileSync(`${runDir}/draft/v1/draft.json`, JSON.stringify(draft));

  const updated: Manifest = {
    ...manifest,
    stages: manifest.stages.map((s) => {
      if (s.name === "research") {
        return { ...s, status: "passed" as const, version: 1, approvals: { ...s.approvals, state: "approved" as const } };
      }
      if (s.name === "draft") {
        return { ...s, status: "passed" as const, version: 1, approvals: { ...s.approvals, state: "approved" as const } };
      }
      return s;
    })
  };
  saveManifest(runDir, updated);
  return runDir;
}

const SAVED_CWD = process.cwd();

beforeAll(() => {
  process.chdir("/tmp/opencode");
  mkdirSync("/tmp/opencode", { recursive: true });
});

afterAll(() => {
  process.chdir(SAVED_CWD);
});

beforeEach(() => {
  // runs/ is gitignored; clean test slugs
  for (const name of ["clean", "bad", "forced"]) {
    rmSync(runDirFor(tmpSlug(name)), { recursive: true, force: true });
  }
});

describe("export", () => {
  it("exports a clean run with the full package layout", async () => {
    const runDir = buildRun(tmpSlug("clean"), CLEAN_ARTICLE);
    verifyConsistency({
      runDir,
      articleMarkdown: CLEAN_ARTICLE,
      research: RESEARCH,
      visuals: null,
      metadata: null,
      codeVerification: null,
      authorAssertions: [],
      phraseWarnings: { enabled: true, phrases: [] }
    });
    const result = await exportRun(tmpSlug("clean"), false);
    expect(result.blocked).toBe(false);
    expect(existsSync(`${result.packageDir}/article.md`)).toBe(true);
    expect(existsSync(`${result.packageDir}/article.html`)).toBe(true);
    expect(existsSync(`${result.packageDir}/source/article-with-markers.md`)).toBe(true);
    expect(existsSync(`${result.packageDir}/code/redis-basic.ts`)).toBe(true);
    expect(existsSync(`${result.packageDir}/verification-summary.json`)).toBe(true);
    expect(existsSync(`${result.packageDir}/REMAINING_ACTIONS.md`)).toBe(true);
    const review = readFileSync(`${result.packageDir}/review-package.md`, "utf8");
    for (const section of ["1. Summary", "2. Claim provenance", "10. Publication checklist", "11. Limitations"]) {
      expect(review).toContain(section);
    }
    const article = readFileSync(`${result.packageDir}/article.md`, "utf8");
    expect(article).not.toContain("<!-- claim:c1 -->");
  });

  it("blocks export when mandatory checks fail", async () => {
    const bad = CLEAN_ARTICLE + "\n[AUTHOR: add production anecdote]";
    const runDir = buildRun(tmpSlug("bad"), bad);
    verifyConsistency({
      runDir,
      articleMarkdown: bad,
      research: RESEARCH,
      visuals: null,
      metadata: null,
      codeVerification: null,
      authorAssertions: [],
      phraseWarnings: { enabled: true, phrases: [] }
    });
    expect(exportBlockers(runDir, loadConsistencyOrThrow(runDir)).length).toBeGreaterThan(0);
    await expect(exportRun(tmpSlug("bad"), false)).rejects.toThrow(/Export blocked/);
  });

  it("--force exports a visibly unverified package with remaining blockers", async () => {
    const bad = CLEAN_ARTICLE + "\n[AUTHOR: add production anecdote]";
    const runDir = buildRun(tmpSlug("forced"), bad);
    verifyConsistency({
      runDir,
      articleMarkdown: bad,
      research: RESEARCH,
      visuals: null,
      metadata: null,
      codeVerification: null,
      authorAssertions: [],
      phraseWarnings: { enabled: true, phrases: [] }
    });
    const result = await exportRun(tmpSlug("forced"), true);
    expect(result.forced).toBe(true);
    const unverified = readFileSync(`${result.packageDir}/UNVERIFIED.txt`, "utf8");
    expect(unverified).toContain("UNVERIFIED");
    expect(unverified).toContain("[AUTHOR");
    const manifest = loadManifest(runDir);
    expect(manifest.export.status).toBe("exported_forced");
    // forced export must not change failed results into passes
    expect(manifest.stages.find((s) => s.name === "draft")?.status).toBe("passed");
  });

  it("refuses to export before a draft exists", async () => {
    const req = `/tmp/opencode/${tmpSlug("empty")}-request.md`;
    writeFileSync(req, "x");
    rmSync(runDirFor(tmpSlug("empty")), { recursive: true, force: true });
    initRun(tmpSlug("empty"), req);
    await expect(exportRun(tmpSlug("empty"), false)).rejects.toThrow(/draft stage/);
    rmSync(runDirFor(tmpSlug("empty")), { recursive: true, force: true });
  });
});

function loadConsistencyOrThrow(runDir: string) {
  const raw = JSON.parse(readFileSync(`${runDir}/verification/consistency.json`, "utf8"));
  expect(raw.generatedAt).toBeTypeOf("string");
  expect(nowIso()).toBeTypeOf("string");
  return raw as { passed: boolean; issues: { check: string; severity: "error" | "warning"; message: string }[] };
}
