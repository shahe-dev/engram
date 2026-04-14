import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { minePlugins } from "../src/miners/plugin-miner.js";
import type { GraphNode } from "../src/graph/schema.js";

const FIXTURE_SRC = resolve(__dirname, "fixtures/claude-dir");

function copyDir(src: string, dst: string): void {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function setupFixture(): string {
  const tmp = join(tmpdir(), `engram-plugin-miner-${Date.now()}-${Math.random()}`);
  mkdirSync(tmp, { recursive: true });
  copyDir(FIXTURE_SRC, tmp);
  const manifestPath = join(tmp, "plugins", "installed_plugins.json");
  const manifest = readFileSync(manifestPath, "utf-8");
  const pluginAbs = join(tmp, "plugins", "store", "plugins", "sample-plugin@mp");
  const escaped = pluginAbs.replace(/\\/g, "\\\\");
  writeFileSync(manifestPath, manifest.replace("FIXTURE_ABS_PATH", escaped));
  return tmp;
}

function pyFileNode(path: string): GraphNode {
  return {
    id: `file:${path}`,
    label: path,
    kind: "file",
    sourceFile: path,
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
  };
}

describe("minePlugins", () => {
  let claudeDir: string;

  beforeAll(() => {
    claudeDir = setupFixture();
  });

  afterAll(() => {
    rmSync(claudeDir, { recursive: true, force: true });
  });

  it("returns empty when claudeDir is missing", () => {
    const result = minePlugins("/does/not/exist", []);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.pluginCount).toBe(0);
  });

  it("returns empty when ENGRAM_SKIP_ECOSYSTEM=1", () => {
    process.env.ENGRAM_SKIP_ECOSYSTEM = "1";
    try {
      const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
      expect(result.nodes).toHaveLength(0);
      expect(result.pluginCount).toBe(0);
    } finally {
      delete process.env.ENGRAM_SKIP_ECOSYSTEM;
    }
  });

  it("indexes plugin, its 2 skills, and 1 agent", () => {
    const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
    expect(result.pluginCount).toBe(1);
    const pluginNodes = result.nodes.filter((n) => n.metadata.subkind === "plugin");
    const skillNodes = result.nodes.filter((n) => n.metadata.subkind === "skill");
    const agentNodes = result.nodes.filter((n) => n.metadata.subkind === "agent");
    expect(pluginNodes).toHaveLength(1);
    expect(skillNodes).toHaveLength(2);
    expect(agentNodes).toHaveLength(1);
  });

  it("creates provided_by edges from skill/agent to plugin", () => {
    const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
    const providedBy = result.edges.filter((e) => e.relation === "provided_by");
    expect(providedBy).toHaveLength(3);
    for (const e of providedBy) {
      expect(e.target).toBe("plugin:sample-plugin");
    }
  });

  it("scores python-review as EXTRACTED when project has python files", () => {
    const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
    const pyReview = result.nodes.find((n) => n.label === "python-review");
    expect(pyReview?.confidence).toBe("EXTRACTED");
  });

  it("creates relevant_to edges only for EXTRACTED or INFERRED skills", () => {
    const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
    const relevantTo = result.edges.filter((e) => e.relation === "relevant_to");
    for (const e of relevantTo) {
      const src = result.nodes.find((n) => n.id === e.source);
      expect(src?.confidence).not.toBe("AMBIGUOUS");
    }
  });

  it("handles plugin directory without skills/ or agents/ gracefully", () => {
    const emptyPluginDir = join(claudeDir, "plugins", "store", "plugins", "empty-plugin@mp");
    mkdirSync(emptyPluginDir, { recursive: true });
    const manifestPath = join(claudeDir, "plugins", "installed_plugins.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.plugins["empty-plugin@mp"] = [
      {
        scope: "user",
        installPath: emptyPluginDir,
        version: "0.1.0",
        installedAt: "2026-04-01T00:00:00Z",
        lastUpdated: "2026-04-01T00:00:00Z",
        gitCommitSha: "def456",
      },
    ];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = minePlugins(claudeDir, [pyFileNode("main.py")]);
    expect(result.pluginCount).toBe(2);
    const emptyPluginNode = result.nodes.find((n) => n.id === "plugin:empty-plugin");
    expect(emptyPluginNode).toBeDefined();
  });
});
