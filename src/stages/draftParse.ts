import { sha256 } from "../util/hash.js";
import type { CodeBlock, Claim } from "./schemas.js";

export const CLAIM_MARKER_RE = /<!--\s*claim:([a-z]\d+)\s*-->/g;
export const PLACEHOLDER_RE = /\[(?:AUTHOR:[^\]]*|PLACEHOLDER[^\]]*|TODO[^\]]*)\]/g;

export interface ParsedDraft {
  markdown: string;
  claimMarkers: { claimId: string; index: number }[];
  codeBlocks: CodeBlock[];
  diagramRefs: string[];
}

export interface DraftParseIssues {
  unknownClaimIds: string[];
  duplicateCodeIds: string[];
}

/**
 * Parse an article draft into machine-checkable structure:
 * claim markers, runnable code fences (` ```ts run=spec-id `), diagram refs.
 */
export function parseDraft(markdown: string, knownClaimIds: Set<string>): ParsedDraft & { issues: DraftParseIssues } {
  const claimMarkers = [...markdown.matchAll(CLAIM_MARKER_RE)].map((m) => ({
    claimId: m[1] as string,
    index: m.index ?? 0
  }));

  const codeBlocks: CodeBlock[] = [];
  const seenIds = new Set<string>();
  const duplicateCodeIds: string[] = [];
  const fenceRe = /^```([\w-]*)(?:\s+run=([\w-]+))?\s*\n([\s\S]*?)^```/gm;
  let autoIndex = 0;
  for (const m of markdown.matchAll(fenceRe)) {
    const language = m[1] || "text";
    const runSpec = m[2] ?? null;
    const code = m[3] ?? "";
    let id = runSpec ? `${runSpec}` : `code-${++autoIndex}`;
    if (seenIds.has(id)) {
      duplicateCodeIds.push(id);
      id = `${id}-${autoIndex}`;
    }
    seenIds.add(id);
    codeBlocks.push({ id, language, runSpec, code, sha256: sha256(code) });
  }

  const diagramRefs = [...markdown.matchAll(/<!--\s*diagram:([\w-]+)\s*-->/g)].map((m) => m[1] as string);
  const unknownClaimIds = claimMarkers.filter((c) => !knownClaimIds.has(c.claimId)).map((c) => c.claimId);

  return {
    markdown,
    claimMarkers,
    codeBlocks,
    diagramRefs,
    issues: { unknownClaimIds, duplicateCodeIds }
  };
}

/** Remove claim markers for export without concealing anything — callers report leftovers first. */
export function stripClaimMarkers(markdown: string): string {
  return markdown.replace(CLAIM_MARKER_RE, "");
}

/** Prose word count excluding fenced code blocks (used for reading time). */
export function proseWordCount(markdown: string): number {
  const withoutCode = markdown.replace(/^```[\s\S]*?^```/gm, "");
  const withoutMarkers = withoutCode.replace(CLAIM_MARKER_RE, " ");
  const words = withoutMarkers
    .replace(/[#*_>`~\[\]()!-]/g, " ")
    .split(/\s+/)
    .filter((w) => /[a-zA-Z0-9]/.test(w));
  return words.length;
}

export function readingTimeMinutes(markdown: string): number {
  return Math.max(1, Math.round(proseWordCount(markdown) / 200));
}

/** Check whether draft asserts first-person testing without author-supplied evidence. */
export function firstPersonTestingStatements(markdown: string): string[] {
  const hits: string[] = [];
  const patterns = [
    /\bI tested\b/i,
    /\bI measured\b/i,
    /\bI benchmarked\b/i,
    /\bin my (?:production|experiments?|tests?)\b/i,
    /\bwe tested\b/i,
    /\bwe measured\b/i,
    /\bI ran (?:the|this) (?:code|benchmark|test)s?\b/i
  ];
  for (const line of markdown.split("\n")) {
    for (const re of patterns) {
      if (re.test(line)) hits.push(line.trim().slice(0, 160));
    }
  }
  return hits;
}
