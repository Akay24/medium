import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "../../src/llm/mock.js";
import { z } from "zod";

const schema = z.object({ answer: z.string() });

function request(overrides?: Partial<Parameters<MockLLMProvider["generateStructured"]>[0]>) {
  return {
    system: "system prompt",
    prompt: "user prompt",
    schema,
    label: "test-stage",
    maxRetries: 2,
    model: "test-model",
    ...overrides
  } as Parameters<MockLLMProvider["generateStructured"]>[0];
}

describe("LLM structured output", () => {
  it("returns parsed data on valid JSON (tolerates code fences)", async () => {
    const provider = new MockLLMProvider(['```json\n{"answer": "42"}\n```']);
    const result = await provider.generateStructured(request());
    expect(result.data).toEqual({ answer: "42" });
    expect(result.retries).toBe(0);
  });

  it("fails clearly when output stays invalid after retries", async () => {
    const provider = new MockLLMProvider(["this is not json at all"]);
    await expect(provider.generateStructured(request())).rejects.toThrow(
      /invalid output after 3 attempt\(s\)/
    );
  });

  it("fails on schema violations even when JSON parses", async () => {
    const provider = new MockLLMProvider(['{"answer": 123}']);
    await expect(provider.generateStructured(request())).rejects.toThrow(/invalid output/);
  });

  it("exhausts the mock clearly", async () => {
    const provider = new MockLLMProvider([]);
    await expect(provider.generateStructured(request())).rejects.toThrow(/exhausted/);
  });
});
