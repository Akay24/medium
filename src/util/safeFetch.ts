import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { sha256 } from "../util/hash.js";

export class FetchBlockedError extends Error {}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  fetchedAt: string;
  contentHash: string;
  title: string | null;
  /** Bounded normalized text extract for review. */
  text: string;
  truncated: boolean;
  redirects: string[];
  contentType: string | null;
}

export interface FetchOptions {
  maxRedirects: number;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Optional domain allowlist (exact host or `.example.com` suffix form). */
  allowedDomains: string[];
  allowPrivateAddresses: boolean;
}

const BLOCKED_HOSTNAMES = ["localhost", "metadata.google.internal", "metadata.goog"];

/** Returns true for private, link-local, loopback, or otherwise reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0 || a === 255) return true;
    return false;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return false;
  }
  return true; // not an IP at all -> treat as unsafe
}

export function isBlockedUrl(url: URL, opts: Pick<FetchOptions, "allowPrivateAddresses">): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `Blocked scheme ${url.protocol} (only http/https allowed)`;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.includes(host)) return `Blocked host ${host}`;
  if (!opts.allowPrivateAddresses) {
    if (isIP(host) && isPrivateAddress(host)) return `Blocked private IP ${host}`;
    if (host.endsWith(".local") || host.endsWith(".internal")) return `Blocked internal host ${host}`;
  }
  return null;
}

function domainAllowed(host: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  return allowedDomains.some(
    (d) => host === d || host.endsWith(d.startsWith(".") ? d : `.${d}`)
  );
}

async function resolveHostSafely(host: string, opts: FetchOptions): Promise<void> {
  if (isIP(host)) {
    if (!opts.allowPrivateAddresses && isPrivateAddress(host)) {
      throw new FetchBlockedError(`Blocked private IP ${host}`);
    }
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new FetchBlockedError(`DNS resolution failed for ${host}`);
  }
  if (addresses.length === 0) throw new FetchBlockedError(`No DNS records for ${host}`);
  for (const { address } of addresses) {
    if (!opts.allowPrivateAddresses && isPrivateAddress(address)) {
      throw new FetchBlockedError(`Host ${host} resolves to private address ${address}`);
    }
  }
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return m?.[1] ? m[1].trim() : null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch a URL with SSRF protections: scheme restriction, private-IP blocking
 * (including re-checks of every redirect target), redirect/size/timeout limits,
 * content-type filter. Fetched content is returned as inert data only.
 */
export async function safeFetch(url: string, opts: FetchOptions): Promise<FetchResult> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new FetchBlockedError(`Invalid URL: ${url}`);
  }

  const redirects: string[] = [];
  const startedAt = Date.now();

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const blocked = isBlockedUrl(current, opts);
    if (blocked) throw new FetchBlockedError(blocked);
    if (!domainAllowed(current.hostname, opts.allowedDomains)) {
      throw new FetchBlockedError(`Domain ${current.hostname} is not in the configured allowlist`);
    }
    await resolveHostSafely(current.hostname, opts);

    const isRedirectHop = hop > 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method: isRedirectHop ? "GET" : "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "article-pipeline-verifier/0.1", accept: "text/html,text/plain,application/json" }
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new FetchBlockedError(`Timeout after ${opts.timeoutMs}ms fetching ${current}`);
      }
      throw new FetchBlockedError(`Fetch failed for ${current}: ${(err as Error).message}`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      clearTimeout(timer);
      await response.body?.cancel();
      if (!location) throw new FetchBlockedError(`Redirect ${response.status} without location at ${current}`);
      const next = new URL(location, current);
      redirects.push(next.toString());
      current = next;
      continue;
    }

    if (!response.ok) {
      clearTimeout(timer);
      await response.body?.cancel();
      throw new FetchBlockedError(`HTTP ${response.status} for ${current}`);
    }

    const contentType = response.headers.get("content-type");
    const readable =
      contentType === null ||
      /^(text\/|application\/(json|xml|xhtml|\+json|\+xml))/.test(contentType);
    if (!readable) {
      clearTimeout(timer);
      await response.body?.cancel();
      throw new FetchBlockedError(`Blocked content-type ${contentType} for ${current}`);
    }

    const reader = response.body?.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > opts.maxResponseBytes) {
          void reader.cancel();
          clearTimeout(timer);
          throw new FetchBlockedError(
            `Response exceeds ${opts.maxResponseBytes} byte limit for ${current}`
          );
        }
        chunks.push(Buffer.from(value));
      }
    }
    clearTimeout(timer);

    const body = Buffer.concat(chunks).toString("utf8");
    const isHtml = (contentType ?? "").includes("html");
    return {
      requestedUrl: url,
      finalUrl: current.toString(),
      status: response.status,
      fetchedAt: new Date(startedAt).toISOString(),
      contentHash: sha256(body),
      title: isHtml ? extractTitle(body) : null,
      text: (isHtml ? htmlToText(body) : body).slice(0, 20_000),
      truncated: body.length > 20_000,
      redirects,
      contentType
    };
  }
  throw new FetchBlockedError(`Too many redirects (limit ${opts.maxRedirects}) starting at ${url}`);
}
