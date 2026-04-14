/**
 * Config Miner - indexes configured Claude Code hooks and MCP servers as
 * concept nodes. Always-on infrastructure: no relevance scoring, confidence
 * fixed at EXTRACTED 1.0.
 *
 * Hooks can be configured at global (~/.claude/settings.json) or project
 * (.claude/settings.local.json) scope; both are merged. MCP servers only
 * come from global settings (matching Claude Code's precedence).
 *
 * Silent failure throughout - malformed settings must not crash engram.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import type { GraphEdge, GraphNode } from "../graph/schema.js";
import { toPosixPath } from "../graph/path-utils.js";

export interface ConfigMineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface HookEntry {
  type?: string;
  command?: string;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}

interface McpServer {
  command?: string;
  args?: string[];
}

interface Settings {
  hooks?: Record<string, HookGroup[]>;
  mcpServers?: Record<string, McpServer>;
}

function readSettings(path: string | undefined): Settings | null {
  if (!path || !existsSync(path)) return null;
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Settings;
  } catch {
    return null;
  }
}

export function mineConfig(
  globalSettingsPath: string | undefined,
  localSettingsPath: string | undefined
): ConfigMineResult {
  const result: ConfigMineResult = { nodes: [], edges: [] };
  if (process.env.ENGRAM_SKIP_ECOSYSTEM === "1") return result;

  const global = readSettings(globalSettingsPath);
  const local = readSettings(localSettingsPath);
  if (!global && !local) return result;

  const now = Date.now();
  const seenHookIds = new Set<string>();

  for (const [source, settings] of [
    ["global", global],
    ["local", local],
  ] as const) {
    if (!settings?.hooks) continue;
    const sourcePath = source === "global" ? globalSettingsPath! : localSettingsPath!;
    for (const [hookType, groups] of Object.entries(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        const matcher = group.matcher ?? "*";
        const hooks = Array.isArray(group.hooks) ? group.hooks : [];
        for (const h of hooks) {
          if (h.type !== "command" || !h.command) continue;
          const id = `hook:${hookType}:${matcher}:${h.command}`;
          if (seenHookIds.has(id)) continue;
          seenHookIds.add(id);

          result.nodes.push({
            id,
            label: `${hookType}:${matcher}`,
            kind: "concept",
            sourceFile: toPosixPath(sourcePath),
            sourceLocation: null,
            confidence: "EXTRACTED",
            confidenceScore: 1.0,
            lastVerified: now,
            queryCount: 0,
            metadata: {
              miner: "config-miner",
              subkind: "hook",
              hookType,
              matcher,
              command: h.command,
              scope: source,
            },
          });
        }
      }
    }
  }

  if (global?.mcpServers && globalSettingsPath) {
    for (const [name, cfg] of Object.entries(global.mcpServers)) {
      result.nodes.push({
        id: `mcp:${name}`,
        label: name,
        kind: "concept",
        sourceFile: toPosixPath(globalSettingsPath),
        sourceLocation: null,
        confidence: "EXTRACTED",
        confidenceScore: 1.0,
        lastVerified: now,
        queryCount: 0,
        metadata: {
          miner: "config-miner",
          subkind: "mcp_server",
          command: cfg?.command ?? "",
          args: Array.isArray(cfg?.args) ? cfg.args : [],
        },
      });
    }
  }

  return result;
}
