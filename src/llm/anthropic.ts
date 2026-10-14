import Anthropic from "@anthropic-ai/sdk";
import { sha256 } from "../util/hash.js";
import type { LLMProvider, StructuredRequest, StructuredResult } from "./types.js";

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      temperature?: number;
      system: string;
      messages: { role: "user" | "assistant"; content: string }[];
    }): Promise<{
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
}

export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: AnthropicLike | null = null;

  constructor(
    private readonly opts: {
      apiKey: string;
      maxTokens: number;
      pricing?: Record<string, Pricing>;
    }
  ) {}

  static fromEnv(opts: { maxTokens: number; pricing?: Record<string, Pricing> }): AnthropicLLMProvider {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. LLM stages require it; verifiers and manual research do not."
      );
    }
    return new AnthropicLLMProvider({ apiKey, ...opts });
  }

  private getClient(): AnthropicLike {
    if (!this.client) {
      const client = new Anthropic({ apiKey: this.opts.apiKey });
      this.client = client as unknown as AnthropicLike;
    }
    return this.client;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const promptHash = sha256(`${request.system}\n---\n${request.prompt}`);
    let lastError: string | null = null;
    let retries = 0;

    while (retries <= request.maxRetries) {
      const response = await this.getClient().messages.create({
        model: request.model,
        max_tokens: 8192,
        temperature: request.temperature ?? 0,
        system: request.system + "\n\nRespond with ONLY a single JSON object. No prose, no code fences.",
        messages: [
          {
            role: "user",
            content:
              request.prompt +
              (lastError
                ? `\n\nYour previous response was invalid and failed validation with: ${lastError}\nReturn corrected JSON only.`
                : "")
          }
        ]
      });
      const raw = (response.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      const usage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0
      };
      try {
        const data = request.schema.parse(extractJson(raw));
        return {
          data,
          raw,
          promptHash,
          model: request.model,
          usage,
          costUsd: this.estimateCost(request.model, usage),
          retries,
          durationMs: Date.now() - started
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (retries >= request.maxRetries) {
          throw new Error(
            `LLM stage "${request.label}" produced invalid output after ${retries + 1} attempt(s): ${lastError}`
          );
        }
      }
      retries++;
    }
    throw new Error("unreachable");
  }

  /** Cost only when a price entry exists for the exact model; otherwise undefined, never guessed. */
  private estimateCost(model: string, usage: { inputTokens: number; outputTokens: number }): number | undefined {
    const price = this.opts.pricing?.[model];
    if (!price) return undefined;
    return (
      (usage.inputTokens / 1_000_000) * price.inputPerMillion +
      (usage.outputTokens / 1_000_000) * price.outputPerMillion
    );
  }
}

/** Extract the first JSON object from a model response (tolerates code fences). */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("no JSON object found in response");
  }
}
