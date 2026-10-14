import { describe, it, expect } from "vitest";
import { verifyDiagrams, type DiagramRenderer } from "../../src/verifiers/diagrams.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagramRecord } from "../../src/stages/schemas.js";

function testDir(name: string): string {
  const dir = join(tmpdir(), `diagram-verify-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeRenderer(behavior: (mmd: string) => { ok: boolean; error?: string }): DiagramRenderer {
  return {
    name: "fake",
    available: true,
    async render(mmdPath, outDir) {
      const fs = await import("node:fs");
      fs.mkdirSync(outDir, { recursive: true });
      const mmd = fs.readFileSync(mmdPath, "utf8");
      const result = behavior(mmd);
      if (result.ok) {
        const svgPath = join(outDir, "out.svg");
        fs.writeFileSync(svgPath, "<svg>fake render</svg>");
        return { ok: true, svgPath, toolVersion: "fake-1.0" };
      }
      return { ok: false, error: result.error };
    }
  };
}

function writeDiagram(runDir: string, id: string, mmd: string): DiagramRecord {
  mkdirSync(`${runDir}/visuals/v1/diagrams`, { recursive: true });
  writeFileSync(`${runDir}/visuals/v1/diagrams/${id}.mmd`, mmd);
  return {
    id,
    articleLocation: "section 2",
    purpose: "flow",
    status: "conceptual",
    mmdPath: `visuals/v1/diagrams/${id}.mmd`,
    renderedPaths: [],
    renderError: null
  };
}

const article = "The cache-aside flow reads from redis first. Misses load from the database into the cache.";

describe("diagram verifier", () => {
  it("marks renderable diagrams as rendered with recorded hashes", async () => {
    const runDir = testDir("ok");
    writeDiagram(runDir, "flow-1", "graph TD\nA[cache-aside] --> B[redis]\nB --> C[database]");
    const result = await verifyDiagrams({
      runDir,
      diagrams: [writeDiagram(runDir, "flow-1", "graph TD\nA[cache-aside] --> B[redis]\nB --> C[database]")],
      renderer: fakeRenderer(() => ({ ok: true })),
      articleMarkdown: article
    });
    expect(result.diagrams[0]?.status).toBe("rendered");
    expect(result.diagrams[0]?.renderedPaths[0]?.sha256).toHaveLength(64);
  });

  it("fails on mermaid syntax errors", async () => {
    const runDir = testDir("syntax");
    const result = await verifyDiagrams({
      runDir,
      diagrams: [writeDiagram(runDir, "bad-1", "graph TD\nA[unclosed")],
      renderer: fakeRenderer(() => ({ ok: false, error: "Parse error" })),
      articleMarkdown: article
    });
    expect(result.diagrams[0]?.status).toBe("failed");
    expect(result.diagrams[0]?.error).toContain("Parse error");
  });

  it("fails when the .mmd source is missing", async () => {
    const runDir = testDir("missing");
    const result = await verifyDiagrams({
      runDir,
      diagrams: [{ id: "gone", articleLocation: "x", purpose: "y", status: "conceptual", mmdPath: "visuals/v1/diagrams/gone.mmd", renderedPaths: [], renderError: null }],
      renderer: fakeRenderer(() => ({ ok: true })),
      articleMarkdown: article
    });
    expect(result.diagrams[0]?.status).toBe("failed");
    expect(result.diagrams[0]?.error).toContain("missing");
  });

  it("stays conceptual (with reason) when the renderer is unavailable", async () => {
    const runDir = testDir("unavail");
    const renderer: DiagramRenderer = { name: "mmdc", available: false, unavailableReason: "mermaid-cli not installed", render: async () => { throw new Error("never"); } };
    const result = await verifyDiagrams({
      runDir,
      diagrams: [writeDiagram(runDir, "d1", "graph TD\nA[cache] --> B[redis]")],
      renderer,
      articleMarkdown: article
    });
    expect(result.diagrams[0]?.status).toBe("conceptual");
    expect(result.diagrams[0]?.error).toContain("not installed");
  });

  it("warns when node labels use terminology absent from the article", async () => {
    const runDir = testDir("labels");
    const result = await verifyDiagrams({
      runDir,
      diagrams: [writeDiagram(runDir, "d2", "graph TD\nA[Kubernetes Operator] --> B[Etcd Quorum]")],
      renderer: fakeRenderer(() => ({ ok: true })),
      articleMarkdown: article
    });
    expect(result.diagrams[0]?.labelWarnings.length).toBeGreaterThan(0);
    expect(result.diagrams[0]?.labelWarnings[0]).toContain("absent from the article");
  });
});
