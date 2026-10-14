import { readFileSync } from "node:fs";
import { sha256 } from "../util/hash.js";

export class PromptError extends Error {}

/** Load a versioned prompt file from prompts/ and return its content + hash. Never inline prompts in code. */
export function loadPrompt(relPath: string, repoRoot = process.cwd()): { content: string; hash: string } {
  let content: string;
  try {
    content = readFileSync(`${repoRoot}/${relPath}`, "utf8");
  } catch (err) {
    throw new PromptError(`Prompt file missing: ${relPath} (${(err as Error).message})`);
  }
  return { content, hash: sha256(content) };
}
