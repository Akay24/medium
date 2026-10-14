export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StructuredRequest<T> {
  /** Versioned prompt file contents (system side). */
  system: string;
  /** User-side prompt payload; typically JSON-serialized stage inputs. */
  prompt: string;
  schema: { parse(data: unknown): T };
  /** Human label used in logs and errors, e.g. "research". */
  label: string;
  maxRetries: number;
  model: string;
  /** Explicit temperature so different stages can tune determinism. */
  temperature?: number;
}

export interface StructuredResult<T> {
  data: T;
  /** Raw text the model produced, for auditing. */
  raw: string;
  promptHash: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd?: number | undefined;
  retries: number;
  durationMs: number;
}

export interface LLMProvider {
  readonly name: string;
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
