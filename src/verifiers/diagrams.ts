import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, basename } from "node:path";
import { sha256, nowIso } from "../util/hash.js";
import type { DiagramRecord } from "../stages/schemas.js";
import type { PipelineConfig } from "../config/schema.js";

export interface RenderedDiagram {
  ok: boolean;
  svgPath?: string;
  pngPath?: string;
  error?: string;
  toolVersion?: string;
}

export interface DiagramRenderer {
  readonly name: string;
  readonly available: boolean;
  readonly unavailableReason?: string | undefined;
  render(mmdPath: string, outDir: string): Promise<RenderedDiagram>;
}

export class MermaidCliRenderer implements DiagramRenderer {
  readonly name = "mermaid-cli";
  public available = true;
  public unavailableReason: string | undefined;

  constructor(private readonly config: PipelineConfig["diagrams"]) {}

  async probe(): Promise<void> {
    const res = await new Promise<{ code: number | null }>((resolve) => {
      execFile(this.config.rendererCommand, ["--version"], { timeout: 15_000 }, (err) =>
        resolve({ code: err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0 })
      );
    });
    this.available = res.code === 0;
    if (!this.available) {
      this.unavailableReason = `Diagram renderer "${this.config.rendererCommand}" not available. Diagrams stay conceptual; install @mermaid-js/mermaid-cli to render.`;
    }
  }

  async render(mmdPath: string, outDir: string): Promise<RenderedDiagram> {
    mkdirSync(outDir, { recursive: true });
    const base = basename(mmdPath).replace(/\.mmd$/, "");
    const svgPath = join(outDir, `${base}.svg`);
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      execFile(
        this.config.rendererCommand,
        ["-i", mmdPath, "-o", svgPath],
        { timeout: this.config.timeoutMs },
        (err, _stdout, stderr) =>
          resolve({
            code: err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0,
            stderr: stderr ?? ""
          })
      );
    });
    if (result.code !== 0 || !existsSync(svgPath)) {
      return { ok: false, error: result.stderr || "mermaid render failed" };
    }
    return { ok: true, svgPath, toolVersion: this.config.rendererCommand };
  }
}

export const diagramVerificationSchema = z.object({
  generatedAt: z.string().datetime(),
  renderer: z.string(),
  rendererAvailable: z.boolean(),
  diagrams: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["conceptual", "rendered", "failed"]),
      mmdPath: z.string().nullable(),
      renderedPaths: z.array(z.object({ path: z.string(), sha256: z.string() })),
      error: z.string().nullable(),
      labelWarnings: z.array(z.string())
    })
  )
});

export type DiagramVerification = z.infer<typeof diagramVerificationSchema>;

export interface DiagramVerifierInput {
  runDir: string;
  diagrams: DiagramRecord[];
  renderer: DiagramRenderer;
  /** Article markdown used for terminology cross-checking. */
  articleMarkdown: string;
}

/** Render each diagram; a successful render proves syntax/renderability, not technical truth. */
export async function verifyDiagrams(input: DiagramVerifierInput): Promise<DiagramVerification> {
  const outDir = `${input.runDir}/verification/diagrams`;
  mkdirSync(outDir, { recursive: true });
  const diagrams: DiagramVerification["diagrams"] = [];

  for (const d of input.diagrams) {
    const labelWarnings = checkLabels(d, input.runDir, input.articleMarkdown);
    if (!d.mmdPath || !existsSync(`${input.runDir}/${d.mmdPath}`)) {
      diagrams.push({
        id: d.id,
        status: "failed",
        mmdPath: d.mmdPath,
        renderedPaths: [],
        error: "diagram source .mmd missing",
        labelWarnings
      });
      continue;
    }
    if (!input.renderer.available) {
      diagrams.push({
        id: d.id,
        status: "conceptual",
        mmdPath: d.mmdPath,
        renderedPaths: [],
        error: input.renderer.unavailableReason ?? "renderer unavailable",
        labelWarnings
      });
      continue;
    }
    const rendered = await input.renderer.render(
      `${input.runDir}/${d.mmdPath}`,
      join(outDir, d.id)
    );
    diagrams.push({
      id: d.id,
      status: rendered.ok ? "rendered" : "failed",
      mmdPath: d.mmdPath,
      renderedPaths: rendered.ok && rendered.svgPath
        ? [{ path: rendered.svgPath, sha256: sha256(readFileSync(rendered.svgPath)) }]
        : [],
      error: rendered.ok ? null : rendered.error ?? "render failed",
      labelWarnings
    });
  }

  const result: DiagramVerification = {
    generatedAt: nowIso(),
    renderer: input.renderer.name,
    rendererAvailable: input.renderer.available,
    diagrams
  };
  writeFileSync(`${input.runDir}/verification/diagrams.json`, JSON.stringify(result, null, 2) + "\n");
  return result;
}

/** Warn when diagram node labels use terms absent from the article (render success != factual truth). */
function checkLabels(d: DiagramRecord, runDir: string, markdown: string): string[] {
  if (!d.mmdPath) return [];
  const mmdPath = `${runDir}/${d.mmdPath}`;
  if (!existsSync(mmdPath)) return [];
  const mmd = readFileSync(mmdPath, "utf8");
  const labels = [...mmd.matchAll(/\[([^\]]+)\]/g)].map((m) => (m[1] ?? "").replace(/"/g, "").trim());
  const warnings: string[] = [];
  const lowerArticle = markdown.toLowerCase();
  for (const label of labels) {
    const words = label.split(/\s+/).filter((w) => w.length >= 4);
    if (words.length > 0 && words.every((w) => !lowerArticle.includes(w.toLowerCase()))) {
      warnings.push(`Diagram ${d.id}: node label "${label}" uses terminology absent from the article`);
    }
  }
  return warnings;
}

export function diagramsCheckPassed(v: DiagramVerification): boolean {
  return v.diagrams.every((d) => d.status !== "failed");
}

export function loadDiagramVerification(runDir: string): DiagramVerification | null {
  const path = `${runDir}/verification/diagrams.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as DiagramVerification) : null;
}
