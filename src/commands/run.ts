import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createManifest, loadManifest, saveManifest, refreshStaleness, stageEntry, type Manifest, type StageEntry } from "../run/manifest.js";
import { RunLogger } from "../run/log.js";
import { validateSlug } from "../util/slug.js";
import { loadConfig, type StageName } from "../config/schema.js";
import { sha256 } from "../util/hash.js";
import { STAGES, stageRange } from "../stages/registry.js";
import type { StageContext } from "../stages/types.js";
import { AnthropicLLMProvider } from "../llm/anthropic.js";
import type { LLMProvider } from "../llm/types.js";
import { verifyConsistency } from "../verifiers/consistency.js";
import { currentDraft, currentDraftVersion } from "../stages/draft.js";
import { currentResearch } from "../stages/research.js";
import { currentVisuals } from "../stages/visuals.js";
import { currentMetadata } from "../stages/metadata.js";
import { DockerSandbox } from "../sandbox/docker.js";
import { FakeSandbox } from "../sandbox/fake.js";
import { loadSandboxSpecs } from "../sandbox/spec.js";
import { verifyCode, loadCodeVerification } from "../verifiers/code.js";
import { loadDiagramVerification } from "../verifiers/diagrams.js";

export function runDirFor(slug: string): string {
  return `runs/${slug}`;
}

export function requireRun(slug: string): { runDir: string; manifest: Manifest; logger: RunLogger } {
  const runDir = runDirFor(slug);
  if (!existsSync(`${runDir}/manifest.json`)) {
    throw new Error(`Run "${slug}" not found under ${runDir}. Run "pipeline init ${slug}" first.`);
  }
  return { runDir, manifest: loadManifest(runDir), logger: new RunLogger(runDir) };
}

/** pipeline init <slug> --request <path> */
export function initRun(slug: string, requestPath: string): { runDir: string; manifest: Manifest } {
  validateSlug(slug);
  if (!existsSync(requestPath)) {
    throw new Error(`Request file not found: ${requestPath}`);
  }
  const runDir = runDirFor(slug);
  if (existsSync(`${runDir}/manifest.json`)) {
    throw new Error(`Run "${slug}" already exists at ${runDir}. Use a new slug or delete the run.`);
  }
  const requestBytes = readFileSync(requestPath, "utf8");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(`${runDir}/request.md`, requestBytes);
  const manifest = createManifest(slug, requestBytes);
  saveManifest(runDir, manifest);
  new RunLogger(runDir).log({ event: "init", detail: { requestPath, requestHash: sha256(requestBytes) } });
  return { runDir, manifest };
}

export function makeLLM(config: ReturnType<typeof loadConfig>): LLMProvider | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return AnthropicLLMProvider.fromEnv({
    maxTokens: 8192,
    ...(config.pricing?.perModel ? { pricing: config.pricing.perModel } : {})
  });
}

function makeContext(slug: string, auto: boolean): { ctx: StageContext; runDir: string } {
  const config = loadConfig();
  const runDir = runDirFor(slug);
  const ctx: StageContext = {
    runDir,
    config,
    llm: makeLLM(config),
    logger: new RunLogger(runDir),
    auto,
    promptPath: (file) => file
  };
  return { ctx, runDir };
}

export interface RunOptions {
  from?: string;
  to?: string;
  auto: boolean;
  force: boolean;
}

/** pipeline run <slug>: execute stages in order, pausing at approval gates. */
export async function runPipeline(slug: string, opts: RunOptions): Promise<void> {
  const { ctx, runDir } = makeContext(slug, opts.auto);
  let manifest = refreshStaleness(runDir, loadManifest(runDir));
  saveManifest(runDir, manifest);

  const selected = stageRange(opts.from, opts.to);
  for (const name of selected) {
    manifest = loadManifest(runDir);
    const entry = stageEntry(manifest, name);
    if (entry.status === "passed" && !opts.force) {
      ctx.logger.log({ event: "stage_skipped", stage: name, detail: { reason: "already passed (use --force to re-run)" } });
      continue;
    }
    const blocked = upstreamBlock(manifest, name, opts.auto);
    if (blocked) {
      if (blocked.kind === "approval") {
        ctx.logger.log({ event: "run_paused", stage: name, detail: { reason: blocked.reason } });
        process.stdout.write(
          `Paused: ${blocked.reason}\nTo approve, set the stage's approvals.state to "approved" in runs/${slug}/manifest.json, or rerun with --auto.\n`
        );
        await runDeterministicVerifiers(slug);
        return;
      }
      throw new Error(blocked.reason);
    }

    const def = STAGES[name];
    const preparedEntry: StageEntry = { ...entry, status: "running", startedAt: new Date().toISOString(), error: null };
    manifest = {
      ...manifest,
      stages: manifest.stages.map((s) => (s.name === name ? preparedEntry : s))
    };
    saveManifest(runDir, manifest);

    try {
      const result = await def.execute(ctx, manifest);
      manifest = {
        ...manifest,
        stages: manifest.stages.map((s) => (s.name === name ? result.entry : s))
      };
      // Approval gate after the stage (never bypasses validation/safety).
      if (def.approvalGate && !opts.auto) {
        manifest = {
          ...manifest,
          stages: manifest.stages.map((s) =>
            s.name === name
              ? { ...s, approvals: { ...s.approvals, state: "awaiting" as const } }
              : s
          )
        };
        saveManifest(runDir, manifest);
        ctx.logger.log({ event: "approval_gate", stage: name, detail: { state: "awaiting human approval; later stages paused" } });
      } else if (def.approvalGate) {
        manifest = {
          ...manifest,
          stages: manifest.stages.map((s) =>
            s.name === name
              ? { ...s, approvals: { state: "approved" as const, decidedBy: "auto", decidedAt: new Date().toISOString() } }
              : s
          )
        };
      }
      saveManifest(runDir, manifest);
    } catch (err) {
      const failedEntry: StageEntry = {
        ...preparedEntry,
        status: "failed",
        error: (err as Error).message,
        finishedAt: new Date().toISOString()
      };
      manifest = { ...manifest, stages: manifest.stages.map((s) => (s.name === name ? failedEntry : s)) };
      saveManifest(runDir, manifest);
      ctx.logger.log({ event: "stage_failed", stage: name, level: "error", detail: { error: (err as Error).message } });
      throw err;
    }
  }
  await runDeterministicVerifiers(slug);
}

function upstreamBlock(
  manifest: Manifest,
  name: StageName,
  auto: boolean
): { kind: "approval" | "prerequisite"; reason: string } | null {
  const order: StageName[] = ["research", "outline", "draft", "visuals", "metadata", "qa"];
  const idx = order.indexOf(name);
  for (const upstream of order.slice(0, idx)) {
    const entry = stageEntry(manifest, upstream);
    if (entry.status !== "passed" && entry.status !== "stale") {
      return {
        kind: "prerequisite",
        reason: `Stage ${name} is blocked: upstream stage ${upstream} is ${entry.status}. Run earlier stages first.`
      };
    }
    // Human approval gates separate stages by default; --auto bypasses the gate only.
    if (STAGES[upstream].approvalGate && !auto && entry.approvals.state !== "approved") {
      return {
        kind: "approval",
        reason: `stage ${upstream} awaits human approval (rerun with --auto to bypass gates, or approve in the manifest)`
      };
    }
  }
  return null;
}

/**
 * Deterministic verifiers only — no LLM rewriting. Safe-fetch/code/diagram paths
 * run with the configured providers; consistency is fully local.
 */
export async function runDeterministicVerifiers(slug: string, only?: "sources" | "code" | "diagrams" | "consistency"): Promise<void> {
  const { ctx, runDir } = makeContext(slug, true);
  const manifest = loadManifest(runDir);

  const wantSources = !only || only === "sources";
  const wantCode = !only || only === "code";
  const wantDiagrams = !only || only === "diagrams";
  const wantConsistency = !only || only === "consistency";

  if (wantSources) {
    const { verifySources } = await import("../verifiers/sources.js");
    let research: ReturnType<typeof currentResearch> | null = null;
    try {
      research = currentResearch(ctx.runDir, manifest);
    } catch {
      research = null;
    }
    if (research) {
      await verifySources({
        runDir,
        research,
        fetchOptions: {
          maxRedirects: ctx.config.research.maxRedirects,
          timeoutMs: ctx.config.research.fetchTimeoutMs,
          maxResponseBytes: ctx.config.research.maxResponseBytes,
          allowedDomains: ctx.config.research.allowedDomains,
          allowPrivateAddresses: ctx.config.research.allowPrivateAddresses
        },
        llm: ctx.llm,
        supportModel: ctx.config.models?.sourceSupport ?? ctx.config.defaults?.model ?? "",
        logger: ctx.logger
      });
    }
  }

  if (wantCode) {
    const draftVersion = stageEntry(manifest, "draft").version;
    if (draftVersion >= 1) {
      const { draft } = currentDraft(ctx.runDir, manifest);
      const specs = loadSandboxSpecs("sandboxes");
      const sandbox =
        ctx.config.providers.sandbox === "fake"
          ? new FakeSandbox()
          : await (async () => {
              const docker = new DockerSandbox({
                networkEnabled: ctx.config.sandbox.networkEnabled,
                readonlyRootfs: ctx.config.sandbox.readonlyRootfs,
                dropAllCapabilities: ctx.config.sandbox.dropAllCapabilities
              });
              await docker.probe();
              return docker;
            })();
      await verifyCode({
        runDir,
        codeBlocks: draft.codeBlocks,
        specs,
        sandbox,
        harness: {},
        repetitions: ctx.config.sandbox.repetitions,
        logger: ctx.logger
      });
    }
  }

  if (wantDiagrams) {
    const visuals = currentVisuals(ctx.runDir, manifest);
    const draftVersion = stageEntry(manifest, "draft").version;
    if (visuals && visuals.diagrams.length > 0 && draftVersion >= 1) {
      const { verifyDiagrams, MermaidCliRenderer } = await import("../verifiers/diagrams.js");
      const renderer = new MermaidCliRenderer(ctx.config.diagrams);
      await renderer.probe();
      await verifyDiagrams({
        runDir,
        diagrams: visuals.diagrams,
        renderer,
        articleMarkdown: currentDraft(ctx.runDir, manifest).markdown
      });
    }
  }

  if (wantConsistency) {
    const draftVersion = currentDraftVersion(manifest);
    if (draftVersion >= 1) {
      const { markdown } = currentDraft(ctx.runDir, manifest);
      const research = currentResearch(ctx.runDir, manifest);
      const visuals = currentVisuals(ctx.runDir, manifest);
      const metadata = currentMetadata(ctx.runDir, manifest);
      const code = loadCodeVerification(runDir);
      verifyConsistency({
        runDir,
        articleMarkdown: markdown,
        research,
        visuals,
        metadata,
        codeVerification: code,
        authorAssertions: [],
        phraseWarnings: {
          enabled: ctx.config.phraseWarnings?.enabled ?? true,
          phrases: ctx.config.phraseWarnings?.phrases ?? []
        }
      });
    }
  }
}
