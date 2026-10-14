import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { safeFetch, FetchBlockedError, isPrivateAddress } from "../../src/util/safeFetch.js";

let server: Server;
let port: number;
const requests: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url ?? "/");
    if (req.url === "/ok") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><title>OK Page</title><body>hello world content</body></html>");
    } else if (req.url === "/redirect-private") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else if (req.url?.startsWith("/redirect-loop")) {
      res.writeHead(302, { location: `/redirect-loop?t=${Date.now()}` });
      res.end();
    } else if (req.url === "/notfound") {
      res.writeHead(404);
      res.end("nope");
    } else if (req.url === "/binary") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(Buffer.from([0, 1, 2, 3]));
    } else if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x".repeat(100_000));
    } else if (req.url === "/chain") {
      res.writeHead(302, { location: "/ok" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("root");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const baseOpts = {
  maxRedirects: 5,
  timeoutMs: 5000,
  maxResponseBytes: 50_000,
  allowedDomains: [],
  // Tests bind to loopback; production config defaults this to false.
  allowPrivateAddresses: true
};

describe("safeFetch SSRF protections", () => {
  it("blocks file:// and other non-http schemes", async () => {
    await expect(safeFetch("file:///etc/passwd", baseOpts)).rejects.toThrow(FetchBlockedError);
    await expect(safeFetch("gopher://example.com", baseOpts)).rejects.toThrow(FetchBlockedError);
  });

  it("blocks localhost and private IP targets", async () => {
    await expect(safeFetch("http://localhost/x", { ...baseOpts, allowPrivateAddresses: false })).rejects.toThrow(FetchBlockedError);
    await expect(safeFetch("http://10.0.0.1/x", { ...baseOpts, allowPrivateAddresses: false })).rejects.toThrow(FetchBlockedError);
    await expect(safeFetch("http://192.168.1.5/x", { ...baseOpts, allowPrivateAddresses: false })).rejects.toThrow(FetchBlockedError);
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/", { ...baseOpts, allowPrivateAddresses: false })).rejects.toThrow(FetchBlockedError);
  });

  it("re-checks redirect targets and blocks redirect into a private IP", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-private`, { ...baseOpts, allowPrivateAddresses: false }))
      .rejects.toThrow(FetchBlockedError);
  });

  it("isPrivateAddress covers loopback, link-local, CGNAT, and IPv6", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.1.1")).toBe(true);
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("enforces redirect limits", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/redirect-loop`, baseOpts)).rejects.toThrow(/Too many redirects|redirect/i);
  });

  it("reports dead links and HTTP errors as retrieval failures", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/notfound`, baseOpts)).rejects.toThrow(/HTTP 404/);
    await expect(safeFetch("http://nonexistent.invalid", baseOpts)).rejects.toThrow(FetchBlockedError);
  });

  it("blocks non-readable content types", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/binary`, baseOpts)).rejects.toThrow(/content-type/);
  });

  it("enforces response size limits", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/big`, { ...baseOpts, maxResponseBytes: 1000 })).rejects.toThrow(/exceeds/);
  });

  it("follows safe redirects and records title, hash, and normalized text", async () => {
    const result = await safeFetch(`http://127.0.0.1:${port}/chain`, baseOpts);
    expect(result.finalUrl).toContain("/ok");
    expect(result.title).toBe("OK Page");
    expect(result.text).toContain("hello world content");
    expect(result.contentHash).toHaveLength(64);
    expect(result.redirects).toHaveLength(1);
  });

  it("honors the domain allowlist when configured", async () => {
    await expect(
      safeFetch(`http://127.0.0.1:${port}/ok`, { ...baseOpts, allowedDomains: ["redis.io"] })
    ).rejects.toThrow(/allowlist/);
  });
});
