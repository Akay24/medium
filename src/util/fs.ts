import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Creates the parent directory of a path if missing. */
export function ensureDirFor(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Next available version directory index (v1, v2, ...) under a stage directory. */
export function nextVersion(stageDir: string): number {
  for (let v = 1; ; v++) {
    if (!existsSync(`${stageDir}/v${v}`)) return v;
  }
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
