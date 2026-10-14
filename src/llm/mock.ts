import { mkdirSync, writeFileSync } from "node:fs";
import { redact } from "../run/log.js";
import { extractJson } from "./anthropic.js";
import type { LLMProvider, StructuredRequest, StructuredResult } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  public calls: { label: string; prompt: string; retries: number }[] = [];

  constructor(
    /** Sequence of raw responses returned per generateStructured call. */
    private readonly responses: string[],
    private readonly onCall?: (label: string, prompt: string) => void
  ) {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (this.responses.length === 0) {
      throw new Error(`MockLLMProvider exhausted for stage "${request.label}"`);
    }
    const raw = this.responses.shift() as string;
    this.calls.push({ label: request.label, prompt: request.prompt, retries: 0 });
    this.onCall?.(request.label, request.prompt);
    const started = Date.now();
    let retries = 0;
    // Same retry-with-validation-errors contract as the real provider.
    while (true) {
      try {
        const data = request.schema.parse(extractJson(raw));
        return {
          data,
          raw,
          promptHash: "mockhash",
          model: request.model,
          usage: { inputTokens: 10, outputTokens: 10 },
          retries,
          durationMs: Date.now() - started
        };
      } catch (err) {
        if (retries >= request.maxRetries) {
          throw new Error(
            `LLM stage "${request.label}" produced invalid output after ${retries + 1} attempt(s): ${(err as Error).message}`
          );
        }
        retries++;
      }
    }
  }
}

/** Helper for tests/mocks that want to write a structured artifact without an LLM. */
export function writeArtifact(dir: string, path: string, data: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${path}`, JSON.stringify(redact(data), null, 2) + "\n");
}
