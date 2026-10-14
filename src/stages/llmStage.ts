import type { LLMProvider, StructuredResult } from "../llm/types.js";
import type { StageContext } from "./types.js";
import { loadPrompt } from "../llm/prompts.js";
import { nextVersion } from "../util/fs.js";
import { sha256 } from "../util/hash.js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import type { Manifest, StageEntry } from "../run/manifest.js";
import type { StageName } from "../config/schema.js";

/**
 * Shared machinery for LLM stages: prompt-file hashing, structured generation,
 * versioned artifact writing (never overwrite; new version or --force), logging.
 */
export interface LLMStageIO<O> {
  version: number;
  dir: string;
  result: StructuredResult<O>;
}export async function runLLMStage<O>(opts: {
  ctx: StageContext;
  manifest: Manifest;
  stage: StageName;
  promptFile: string;
  userPayload: string;
  schema: { parse(data: unknown): O };
  /** Files to write into the stage version dir; keys are filenames. */
  files: (output: O, rawResult: StructuredResult<O>) => Record<string, string>;
  entry: StageEntry;
}): Promise<{ io: LLMStageIO<O>; entry: StageEntry }> {
  const { ctx } = opts;
  if (!ctx.llm) {
    throw new Error(`Stage ${opts.stage} requires an LLM provider (set ANTHROPIC_API_KEY).`);
  }
  const promptRelPath = `prompts/${opts.promptFile}`;
  const prompt = loadPrompt(promptRelPath);
  const model = modelFor(opts.ctx.config, opts.stage);
  const result = await ctx.llm.generateStructured({
    system: prompt.content,
    prompt: opts.userPayload,
    schema: opts.schema,
    label: opts.stage,
    maxRetries: ctx.config.retries.llmInvalidOutput,
    model
  });

  ctx.logger.log({
    event: "llm_call",
    stage: opts.stage,
    model: result.model,
    promptHash: result.promptHash,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
    durationMs: result.durationMs,
    retries: result.retries
  });

  const version = nextVersion(`${ctx.runDir}/${opts.stage}`);
  const dir = `${ctx.runDir}/${opts.stage}/v${version}`;
  mkdirAndWrite(dir, opts.files(result.data, result));

  const updatedEntry: StageEntry = {
    ...opts.entry,
    status: "passed",
    version,
    promptHashes: [{ path: promptRelPath, sha256: prompt.hash }],
    outputs: Object.keys(opts.files(result.data, result)).map((f) => ({
      path: `${opts.stage}/v${version}/${f}`,
      sha256: shaVersionedFile(`${dir}/${f}`)
    })),
    startedAt: opts.entry.startedAt ?? new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: null
  };
  return { io: { version, dir, result }, entry: updatedEntry };
}

export function modelFor(config: StageContext["config"], stage: StageName): string {
  const perStage = config.models?.[stage as keyof NonNullable<typeof config.models>];
  const model = perStage ?? config.defaults?.model ?? "";
  if (!model) {
    throw new Error(`No model configured for stage ${stage} and no default model set in pipeline.config.yml`);
  }
  return model;
}

function mkdirAndWrite(dir: string, files: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(`${dir}/${name}`, content);
  }
}

function shaVersionedFile(path: string): string {
  return sha256(readFileSync(path));
}

export function artifactRef(path: string, content: string): { path: string; sha256: string } {
  return { path, sha256: sha256(content) };
}

export type { LLMProvider };
