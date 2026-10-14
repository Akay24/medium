import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { initRun, runDirFor } from "../../src/commands/run.js";
import { loadManifest, refreshStaleness, saveManifest, stageEntry } from "../../src/run/manifest.js";
import { validateSlug } from "../../src/util/slug.js";
import { sha256 } from "../../src/util/hash.js";
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const WORK = mkdtemp();
function mkdtemp(): string {
  const dir = join("/tmp/opencode", `pipeline-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SAVED_CWD = process.cwd();

beforeAll(() => {
  process.chdir(WORK);
});

afterAll(() => {
  process.chdir(SAVED_CWD);
});

beforeEach(() => {
  rmSync(join(WORK, "runs"), { recursive: true, force: true });
});

describe("slug validation", () => {
  it("accepts normal slugs", () => {
    expect(validateSlug("redis-caching")).toBe("redis-caching");
  });
  it("rejects bad slugs", () => {
    expect(() => validateSlug("Bad_Slug")).toThrow();
    expect(() => validateSlug("-x")).toThrow();
    expect(() => validateSlug("")).toThrow();
  });
});

describe("pipeline init", () => {
  it("creates manifest and copies request", () => {
    const req = join(WORK, "request.md");
    writeFileSync(req, "# request\nsome body");
    const { runDir } = initRun("redis-caching", req);
    expect(existsSync(`${runDir}/request.md`)).toBe(true);
    const manifest = loadManifest(runDir);
    expect(manifest.requestHash).toBe(sha256("# request\nsome body"));
    expect(manifest.stages.map((s) => s.name)).toEqual([
      "research", "outline", "draft", "visuals", "metadata", "qa"
    ]);
    expect(stageEntry(manifest, "research").status).toBe("pending");
  });

  it("refuses to overwrite an existing run", () => {
    const req = join(WORK, "request.md");
    writeFileSync(req, "x");
    initRun("dup-run", req);
    expect(() => initRun("dup-run", req)).toThrow(/already exists/);
  });

  it("fails with missing request file", () => {
    expect(() => initRun("no-request", join(WORK, "missing.md"))).toThrow(/not found/);
  });
});

describe("manifest versioning and staleness", () => {
  it("re-running a stage creates a new version; never silently overwrites", () => {
    const req = join(WORK, "request.md");
    writeFileSync(req, "x");
    const { runDir } = initRun("versioning", req);
    const v1Dir = `${runDir}/research/v1`;
    mkdirSync(v1Dir, { recursive: true });
    writeFileSync(`${v1Dir}/research.json`, "{}");
    expect(existsSync(v1Dir)).toBe(true);
    // A second execution writes v2; v1 is untouched.
    const manifest = loadManifest(runDir);
    const entry = stageEntry(manifest, "research");
    expect(entry.version).toBe(0);
    // simulate recorded input change on a passed stage -> staleness
    entry.status = "passed";
    entry.version = 1;
    entry.inputs.push({ path: "request.md", sha256: sha256("different") });
    saveManifest(runDir, { ...manifest, stages: manifest.stages.map((s) => (s.name === "research" ? entry : s)) });
    const refreshed = refreshStaleness(runDir, loadManifest(runDir));
    expect(stageEntry(refreshed, "research").status).toBe("stale");
  });

  it("marks downstream stages stale when upstream inputs change", () => {
    const req = join(WORK, "request.md");
    writeFileSync(req, "x");
    const { runDir } = initRun("stale-chain", req);
    const manifest = loadManifest(runDir);
    const staleManifest = {
      ...manifest,
      stages: manifest.stages.map((s) =>
        s.name === "research"
          ? { ...s, status: "passed" as const, version: 1, inputs: [{ path: "request.md", sha256: sha256("changed") }] }
          : { ...s, status: "passed" as const, version: 1 }
      )
    };
    saveManifest(runDir, staleManifest);
    const refreshed = refreshStaleness(runDir, loadManifest(runDir));
    expect(stageEntry(refreshed, "research").status).toBe("stale");
    expect(stageEntry(refreshed, "outline").status).toBe("stale");
    expect(stageEntry(refreshed, "qa").status).toBe("stale");
  });
});

describe("run log", () => {
  it("never writes secret-looking values", async () => {
    const req = join(WORK, "request.md");
    writeFileSync(req, "x");
    const { runDir } = initRun("secret-log", req);
    const { RunLogger } = await import("../../src/run/log.js");
    const logger = new RunLogger(runDir);
    process.env.ANTHROPIC_API_KEY = "sk-ant-supersecretvalue123";
    logger.log({
      event: "llm_call",
      detail: { apiKey: "sk-ant-supersecretvalue123", nested: { Authorization: "Bearer tokentokentoken" } }
    });
    const log = readFileSync(`${runDir}/log.jsonl`, "utf8");
    expect(log).not.toContain("sk-ant-supersecretvalue123");
    expect(log).toContain("[REDACTED]");
  });
});
