/**
 * Core engram operations — init, mine, query, stats.
 * This is the main API surface that CLI and MCP server both use.
 */
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { GraphStore } from "./graph/store.js";
import { queryGraph, shortestPath } from "./graph/query.js";
import { extractDirectory } from "./miners/ast-miner.js";
import { mineGitHistory } from "./miners/git-miner.js";
import { mineSessionHistory, learnFromSession } from "./miners/session-miner.js";
import type { GraphStats } from "./graph/schema.js";

const ENGRAM_DIR = ".engram";
const DB_FILE = "graph.db";

export function getDbPath(projectRoot: string): string {
  return join(projectRoot, ENGRAM_DIR, DB_FILE);
}

export async function getStore(projectRoot: string): Promise<GraphStore> {
  return GraphStore.open(getDbPath(projectRoot));
}

export interface InitResult {
  nodes: number;
  edges: number;
  fileCount: number;
  totalLines: number;
  timeMs: number;
}

export async function init(projectRoot: string): Promise<InitResult> {
  const root = resolve(projectRoot);
  const start = Date.now();

  mkdirSync(join(root, ENGRAM_DIR), { recursive: true });

  const { nodes, edges, fileCount, totalLines } = extractDirectory(root);
  const gitResult = mineGitHistory(root);
  const sessionResult = mineSessionHistory(root);

  const allNodes = [...nodes, ...gitResult.nodes, ...sessionResult.nodes];
  const allEdges = [...edges, ...gitResult.edges, ...sessionResult.edges];

  const store = await getStore(root);
  try {
    store.clearAll();
    store.bulkUpsert(allNodes, allEdges);
    store.setStat("last_mined", String(Date.now()));
    store.setStat("project_root", root);
  } finally {
    store.close();
  }

  return { nodes: allNodes.length, edges: allEdges.length, fileCount, totalLines, timeMs: Date.now() - start };
}

export async function query(
  projectRoot: string,
  question: string,
  options: { mode?: "bfs" | "dfs"; depth?: number; tokenBudget?: number } = {}
): Promise<{ text: string; estimatedTokens: number; nodesFound: number }> {
  const store = await getStore(projectRoot);
  try {
    const result = queryGraph(store, question, options);
    return { text: result.text, estimatedTokens: result.estimatedTokens, nodesFound: result.nodes.length };
  } finally {
    store.close();
  }
}

export async function path(
  projectRoot: string,
  source: string,
  target: string
): Promise<{ text: string; hops: number }> {
  const store = await getStore(projectRoot);
  try {
    const result = shortestPath(store, source, target);
    return { text: result.text, hops: result.edges.length };
  } finally {
    store.close();
  }
}

export async function godNodes(
  projectRoot: string,
  topN = 10
): Promise<Array<{ label: string; kind: string; degree: number; sourceFile: string }>> {
  const store = await getStore(projectRoot);
  try {
    return store.getGodNodes(topN).map((g) => ({
      label: g.node.label, kind: g.node.kind, degree: g.degree, sourceFile: g.node.sourceFile,
    }));
  } finally {
    store.close();
  }
}

export async function stats(projectRoot: string): Promise<GraphStats> {
  const store = await getStore(projectRoot);
  try {
    return store.getStats();
  } finally {
    store.close();
  }
}

export async function learn(
  projectRoot: string,
  text: string,
  sourceLabel = "manual"
): Promise<{ nodesAdded: number }> {
  const { nodes, edges } = learnFromSession(text, sourceLabel);
  if (nodes.length === 0 && edges.length === 0) return { nodesAdded: 0 };
  const store = await getStore(projectRoot);
  try {
    store.bulkUpsert(nodes, edges);
  } finally {
    store.close();
  }
  return { nodesAdded: nodes.length };
}

export async function benchmark(
  projectRoot: string,
  questions?: string[]
): Promise<{
  naiveFullCorpus: number;
  naiveRelevantFiles: number;
  avgQueryTokens: number;
  reductionVsFull: number;
  reductionVsRelevant: number;
  perQuestion: Array<{ question: string; tokens: number; reductionFull: number; reductionRelevant: number }>;
}> {
  const root = resolve(projectRoot);
  const store = await getStore(root);
  try {
    const allNodes = store.getAllNodes();

    // Full corpus baseline (all source files)
    let fullCorpusChars = 0;
    const seenFiles = new Set<string>();
    for (const node of allNodes) {
      if (node.sourceFile && !seenFiles.has(node.sourceFile)) {
        seenFiles.add(node.sourceFile);
        try {
          const fullPath = join(root, node.sourceFile);
          if (existsSync(fullPath)) fullCorpusChars += readFileSync(fullPath, "utf-8").length;
        } catch { /* skip */ }
      }
    }
    const naiveFullCorpus = Math.ceil(fullCorpusChars / 4);

    const qs = questions ?? [
      "how does authentication work",
      "what is the main entry point",
      "how are errors handled",
      "what connects the data layer to the api",
      "what are the core abstractions",
    ];

    const perQuestion: Array<{ question: string; tokens: number; reductionFull: number; reductionRelevant: number }> = [];

    for (const q of qs) {
      const result = queryGraph(store, q, { tokenBudget: 2000 });
      if (result.estimatedTokens > 0) {
        // Relevant files baseline: only files containing matched nodes
        const matchedFiles = new Set(result.nodes.map((n) => n.sourceFile).filter(Boolean));
        let relevantChars = 0;
        for (const f of matchedFiles) {
          try {
            const fullPath = join(root, f);
            if (existsSync(fullPath)) relevantChars += readFileSync(fullPath, "utf-8").length;
          } catch { /* skip */ }
        }
        const naiveRelevant = Math.ceil(relevantChars / 4) || 1;

        perQuestion.push({
          question: q,
          tokens: result.estimatedTokens,
          reductionFull: naiveFullCorpus > 0
            ? Math.round((naiveFullCorpus / result.estimatedTokens) * 10) / 10
            : 0,
          reductionRelevant: Math.round((naiveRelevant / result.estimatedTokens) * 10) / 10,
        });
      }
    }

    const avgQueryTokens = perQuestion.length > 0
      ? Math.round(perQuestion.reduce((sum, p) => sum + p.tokens, 0) / perQuestion.length)
      : 0;

    const avgRelevantChars = perQuestion.length > 0
      ? perQuestion.reduce((sum, p) => sum + p.reductionRelevant, 0) / perQuestion.length
      : 0;

    return {
      naiveFullCorpus,
      naiveRelevantFiles: avgQueryTokens > 0 ? Math.round(avgQueryTokens * avgRelevantChars) : 0,
      avgQueryTokens,
      reductionVsFull: avgQueryTokens > 0 ? Math.round((naiveFullCorpus / avgQueryTokens) * 10) / 10 : 0,
      reductionVsRelevant: Math.round(avgRelevantChars * 10) / 10,
      perQuestion,
    };
  } finally {
    store.close();
  }
}
