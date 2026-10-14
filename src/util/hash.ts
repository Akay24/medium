import { createHash } from "node:crypto";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

export function nowIso(): string {
  return new Date().toISOString();
}
