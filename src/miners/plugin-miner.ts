/**
 * Plugin Miner — indexes installed Claude Code plugins, their skills, and
 * their agents as concept nodes with subkind discriminators. Scores each
 * skill/agent's relevance to the current project stack.
 *
 * Schema discipline: no new NodeKinds. All new nodes use `kind: "concept"`
 * with `metadata.subkind` set to "plugin", "skill", or "agent". Matches
 * Nick's skills-miner convention (concept + subkind: "skill").
 *
 * Silent failure throughout — malformed plugin installs must not crash
 * engram's SessionStart brief.
 */
import type { Confidence, GraphEdge, GraphNode } from "../graph/schema.js";

// ─── Relevance scoring ──────────────────────────────────────────────────────

const LANGUAGE_TOKENS = new Set([
  "python", "typescript", "javascript", "go", "golang", "rust",
  "java", "kotlin", "swift", "ruby", "php", "c", "cpp", "csharp",
  "perl", "scala", "elixir", "haskell", "lua", "dart",
]);

const UNIVERSAL_KEYWORDS = new Set([
  "tdd", "test", "testing", "security", "debugging", "debug",
  "git", "docker", "deployment", "deploy", "ci", "cd",
  "api", "rest", "documentation", "docs", "refactor",
  "code-review", "review", "lint", "format", "build",
  "verification", "plan", "brainstorm",
]);

export interface RelevanceScore {
  confidence: Confidence;
  score: number;
}

export function scoreRelevance(
  name: string,
  description: string,
  stackTokens: Set<string>
): RelevanceScore {
  if (stackTokens.size === 0) {
    return { confidence: "INFERRED", score: 0.6 };
  }

  const tokens = `${name} ${description}`
    .toLowerCase()
    .split(/[\s\-_/.,;:()|]+/)
    .filter((t) => t.length > 1);

  let hasLanguageToken = false;
  let hasLanguageMatch = false;

  for (const token of tokens) {
    if (LANGUAGE_TOKENS.has(token)) {
      hasLanguageToken = true;
      if (stackTokens.has(token)) {
        hasLanguageMatch = true;
      }
    }
    if (stackTokens.has(token)) {
      return { confidence: "EXTRACTED", score: 1.0 };
    }
  }

  if (hasLanguageToken && !hasLanguageMatch) {
    return { confidence: "AMBIGUOUS", score: 0.2 };
  }

  for (const token of tokens) {
    if (UNIVERSAL_KEYWORDS.has(token)) {
      return { confidence: "INFERRED", score: 0.6 };
    }
  }

  return { confidence: "AMBIGUOUS", score: 0.2 };
}

// ─── Main miner (stub — filled in Task 7) ───────────────────────────────────

export interface PluginMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  pluginCount: number;
  anomalies: string[];
}

export function minePlugins(
  _claudeDir: string,
  _astNodes: readonly GraphNode[]
): PluginMineResult {
  return { nodes: [], edges: [], pluginCount: 0, anomalies: [] };
}
