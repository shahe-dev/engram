import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { mineConfig } from "../src/miners/config-miner.js";

const FIXTURE_DIR = resolve(__dirname, "fixtures/settings");
const GLOBAL = resolve(FIXTURE_DIR, "settings.json");
const LOCAL = resolve(FIXTURE_DIR, "settings.local.json");

describe("mineConfig", () => {
  it("returns empty when both files are missing", () => {
    const result = mineConfig("/nope/settings.json", "/nope/local.json");
    expect(result.nodes).toHaveLength(0);
  });

  it("returns empty when ENGRAM_SKIP_ECOSYSTEM=1", () => {
    process.env.ENGRAM_SKIP_ECOSYSTEM = "1";
    try {
      const result = mineConfig(GLOBAL, LOCAL);
      expect(result.nodes).toHaveLength(0);
    } finally {
      delete process.env.ENGRAM_SKIP_ECOSYSTEM;
    }
  });

  it("indexes hooks from global settings", () => {
    const result = mineConfig(GLOBAL, undefined);
    const hooks = result.nodes.filter((n) => n.metadata.subkind === "hook");
    expect(hooks.length).toBeGreaterThanOrEqual(2);
    const labels = hooks.map((h) => h.label);
    expect(labels).toContain("SessionStart:startup");
    expect(labels).toContain("PreToolUse:*");
  });

  it("indexes MCP servers from global settings only", () => {
    const result = mineConfig(GLOBAL, LOCAL);
    const mcps = result.nodes.filter((n) => n.metadata.subkind === "mcp_server");
    expect(mcps).toHaveLength(2);
    const names = mcps.map((m) => m.label);
    expect(names).toContain("context7");
    expect(names).toContain("playwright");
  });

  it("merges hooks from global and local settings", () => {
    const result = mineConfig(GLOBAL, LOCAL);
    const hooks = result.nodes.filter((n) => n.metadata.subkind === "hook");
    const labels = hooks.map((h) => h.label);
    expect(labels).toContain("UserPromptSubmit:*");
  });

  it("all hook and mcp nodes have confidence 1.0", () => {
    const result = mineConfig(GLOBAL, LOCAL);
    for (const n of result.nodes) {
      expect(n.confidence).toBe("EXTRACTED");
      expect(n.confidenceScore).toBe(1.0);
    }
  });

  it("stores hook command in metadata", () => {
    const result = mineConfig(GLOBAL, undefined);
    const sessionStart = result.nodes.find((n) => n.label === "SessionStart:startup");
    expect(sessionStart?.metadata.command).toBe("engram intercept");
  });

  it("handles malformed JSON silently", () => {
    const result = mineConfig(FIXTURE_DIR, undefined);
    expect(result.nodes).toHaveLength(0);
  });
});
