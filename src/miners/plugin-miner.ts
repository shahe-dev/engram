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
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { detectStack } from "../graph/stack-detect.js";
import { toPosixPath } from "../graph/path-utils.js";

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

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".py": "python", ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".go": "go",
  ".rs": "rust", ".java": "java", ".kt": "kotlin",
  ".swift": "swift", ".rb": "ruby", ".php": "php",
};

interface PluginEntry {
  scope?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].replace(/\r/g, "").split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*"?(.*?)"?\s*$/);
    if (kv) result[kv[1]] = kv[2];
  }
  return result;
}

function pluginShortName(pluginKey: string): string {
  const atIdx = pluginKey.indexOf("@");
  return atIdx > 0 ? pluginKey.slice(0, atIdx) : pluginKey;
}

function marketplaceName(pluginKey: string): string {
  const atIdx = pluginKey.indexOf("@");
  return atIdx > 0 ? pluginKey.slice(atIdx + 1) : "unknown";
}

export function minePlugins(
  claudeDir: string,
  astNodes: readonly GraphNode[]
): PluginMineResult {
  const result: PluginMineResult = { nodes: [], edges: [], pluginCount: 0, anomalies: [] };

  if (process.env.ENGRAM_SKIP_ECOSYSTEM === "1") return result;
  if (!existsSync(claudeDir)) return result;

  const manifestPath = join(claudeDir, "plugins", "installed_plugins.json");
  if (!existsSync(manifestPath)) return result;

  let manifest: { plugins?: Record<string, PluginEntry[]> };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return result;
  }

  const pluginEntries = manifest.plugins;
  if (!pluginEntries || typeof pluginEntries !== "object") return result;

  const stackTokens = detectStack(astNodes);
  const now = Date.now();

  const filesByLang = new Map<string, GraphNode>();
  for (const node of astNodes) {
    if (node.kind !== "file") continue;
    const ext = node.sourceFile.match(/\.[a-z]+$/i)?.[0]?.toLowerCase();
    if (!ext) continue;
    const lang = EXT_TO_LANGUAGE[ext];
    if (lang && !filesByLang.has(lang)) filesByLang.set(lang, node);
  }

  for (const [pluginKey, entries] of Object.entries(pluginEntries)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const entry = entries[0];
    if (!entry.installPath || !existsSync(entry.installPath)) continue;

    const pluginName = pluginShortName(pluginKey);
    const marketplace = marketplaceName(pluginKey);
    const pluginId = `plugin:${pluginName}`;

    result.nodes.push({
      id: pluginId,
      label: pluginName,
      kind: "concept",
      sourceFile: toPosixPath(entry.installPath),
      sourceLocation: null,
      confidence: "EXTRACTED",
      confidenceScore: 1.0,
      lastVerified: now,
      queryCount: 0,
      metadata: {
        miner: "plugin-miner",
        subkind: "plugin",
        marketplace,
        version: entry.version ?? "unknown",
      },
    });
    result.pluginCount++;

    const skillsDir = join(entry.installPath, "skills");
    if (existsSync(skillsDir)) {
      let skillDirs: string[] = [];
      try { skillDirs = readdirSync(skillsDir); } catch { skillDirs = []; }

      for (const skillDir of skillDirs) {
        if (skillDir.startsWith("temp_git_") || skillDir.startsWith(".")) continue;
        const skillPath = join(skillsDir, skillDir);
        try { if (!statSync(skillPath).isDirectory()) continue; } catch { continue; }

        const skillMdPath = join(skillPath, "SKILL.md");
        if (!existsSync(skillMdPath)) continue;

        let content: string;
        try { content = readFileSync(skillMdPath, "utf-8"); } catch {
          result.anomalies.push(skillMdPath);
          continue;
        }
        const fm = parseFrontmatter(content);
        const name = fm.name || skillDir;
        const description = fm.description || "";
        const { confidence, score } = scoreRelevance(name, description, stackTokens);
        const skillId = `skill:${pluginName}/${name}`;

        result.nodes.push({
          id: skillId,
          label: name,
          kind: "concept",
          sourceFile: toPosixPath(skillMdPath),
          sourceLocation: null,
          confidence,
          confidenceScore: score,
          lastVerified: now,
          queryCount: 0,
          metadata: {
            miner: "plugin-miner",
            subkind: "skill",
            description,
            sourcePlugin: pluginName,
            marketplace,
            version: entry.version ?? "unknown",
          },
        });

        result.edges.push({
          source: skillId,
          target: pluginId,
          relation: "provided_by",
          confidence: "EXTRACTED",
          confidenceScore: 1.0,
          sourceFile: toPosixPath(skillMdPath),
          sourceLocation: null,
          lastVerified: now,
          metadata: { miner: "plugin-miner" },
        });

        if (confidence !== "AMBIGUOUS") {
          const lowered = `${name} ${description}`.toLowerCase();
          for (const [lang, fileNode] of filesByLang) {
            if (lowered.includes(lang) || confidence === "INFERRED") {
              result.edges.push({
                source: skillId,
                target: fileNode.id,
                relation: "relevant_to",
                confidence,
                confidenceScore: score,
                sourceFile: toPosixPath(skillMdPath),
                sourceLocation: null,
                lastVerified: now,
                metadata: { miner: "plugin-miner", language: lang },
              });
              break;
            }
          }
        }
      }
    }

    const agentsDir = join(entry.installPath, "agents");
    if (existsSync(agentsDir)) {
      let agentFiles: string[] = [];
      try { agentFiles = readdirSync(agentsDir); } catch { agentFiles = []; }

      for (const agentFile of agentFiles) {
        if (!agentFile.endsWith(".md")) continue;
        const agentPath = join(agentsDir, agentFile);
        try { if (!statSync(agentPath).isFile()) continue; } catch { continue; }

        let content: string;
        try { content = readFileSync(agentPath, "utf-8"); } catch {
          result.anomalies.push(agentPath);
          continue;
        }
        const fm = parseFrontmatter(content);
        const name = fm.name || basename(agentFile, ".md");
        const description = fm.description || "";
        const { confidence, score } = scoreRelevance(name, description, stackTokens);
        const agentId = `agent:${pluginName}/${name}`;

        result.nodes.push({
          id: agentId,
          label: name,
          kind: "concept",
          sourceFile: toPosixPath(agentPath),
          sourceLocation: null,
          confidence,
          confidenceScore: score,
          lastVerified: now,
          queryCount: 0,
          metadata: {
            miner: "plugin-miner",
            subkind: "agent",
            description,
            sourcePlugin: pluginName,
            marketplace,
          },
        });

        result.edges.push({
          source: agentId,
          target: pluginId,
          relation: "provided_by",
          confidence: "EXTRACTED",
          confidenceScore: 1.0,
          sourceFile: toPosixPath(agentPath),
          sourceLocation: null,
          lastVerified: now,
          metadata: { miner: "plugin-miner" },
        });
      }
    }
  }

  return result;
}
