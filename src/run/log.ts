import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { nowIso, sha256 } from "../util/hash.js";

const SECRET_KEYS = [
  "api_key",
  "apikey",
  "authorization",
  "anthropic_api_key",
  "research_provider_api_key",
  "image_provider_api_key",
  "token",
  "secret",
  "password"
];

const SECRET_PATTERN = /\b(sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})\b/g;

/** Recursively redact secret-looking values so keys never reach run logs or artifacts. */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_PATTERN, "[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export interface LogEvent {
  event: string;
  stage?: string;
  model?: string;
  promptHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  retries?: number;
  level?: "info" | "warn" | "error";
  detail?: Record<string, unknown>;
}

export class RunLogger {
  constructor(private readonly runDir: string) {}

  log(event: LogEvent): void {
    const line = JSON.stringify({ ...event, detail: redact(event.detail), ts: nowIso() });
    if (!existsSync(this.runDir)) mkdirSync(this.runDir, { recursive: true });
    appendFileSync(`${this.runDir}/log.jsonl`, line + "\n");
    process.stderr.write(`[pipeline] ${event.event}${event.stage ? ` (${event.stage})` : ""}\n`);
  }

  logArtifact(kind: string, path: string, bytes: string | Buffer): void {
    this.log({ event: kind, detail: { path, sha256: sha256(bytes) } });
  }
}
