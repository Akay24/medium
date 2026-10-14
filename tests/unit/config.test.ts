import { describe, it, expect } from "vitest";
import { loadConfig, modelForStage, ConfigError } from "../../src/config/schema.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function writeConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const path = join(dir, "pipeline.config.yml");
  writeFileSync(path, yaml);
  return path;
}

const validConfig = `
defaults:
  model: test-model
mediumLimits:
  maxTags: { value: 5, lastVerifiedAt: null, sourceUrl: null, unverified: true }
  maxTitleLength: { value: 100, lastVerifiedAt: null, sourceUrl: null, unverified: true }
  maxSubtitleLength: { value: 140, lastVerifiedAt: null, sourceUrl: null, unverified: true }
  unverifiedNotice: "unverified"
`;

describe("config schema", () => {
  it("accepts a minimal valid config with defaults", () => {
    const cfg = loadConfig(writeConfig(validConfig));
    expect(cfg.defaults?.model).toBe("test-model");
    expect(cfg.research.allowPrivateAddresses).toBe(false);
    expect(cfg.sandbox.networkEnabled).toBe(false);
    expect(cfg.providers.image).toBe("brief-only");
  });

  it("rejects invalid config with a clear error", () => {
    expect(() => loadConfig(writeConfig("providers: { llm: bogus }\n"))).toThrow(ConfigError);
  });

  it("rejects private-address-enabled research by schema only when wrong types", () => {
    expect(() => loadConfig(writeConfig(validConfig + "research:\n  maxSources: 0\n"))).toThrow(ConfigError);
  });

  it("modelForStage uses per-stage model with configured fallback", () => {
    const cfg = loadConfig(writeConfig(validConfig + "models:\n  qa: qa-model\n"));
    expect(modelForStage(cfg, "qa")).toBe("qa-model");
    expect(modelForStage(cfg, "outline")).toBe("test-model");
  });
});
