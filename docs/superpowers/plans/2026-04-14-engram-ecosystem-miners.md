# Engram Ecosystem Miners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new miners (`plugin-miner`, `config-miner`) and a shared `stack-detect` utility to engram, indexing installed Claude Code plugins, plugin-provided agents, configured hooks, and MCP servers as `concept` nodes with `subkind` discriminators.

**Architecture:** Two data sources, two miners. `plugin-miner` walks `~/.claude/plugins/` and indexes plugins + their nested agents with stack-based relevance scoring. `config-miner` parses global + project settings JSON and indexes hooks + MCP servers as always-on infrastructure (no scoring). Both miners hook into the existing pipeline in `src/core.ts` after `ast-miner` and `skills-miner`.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, sql.js-backed GraphStore. No new dependencies.

**Design spec:** `docs/superpowers/specs/2026-04-14-engram-ecosystem-miners-design.md`

---

## File Structure

### Create
- `src/graph/stack-detect.ts` — pure function, detects project stack from `GraphNode[]`
- `src/miners/plugin-miner.ts` — plugin + agent indexing with relevance scoring
- `src/miners/config-miner.ts` — hook + MCP server indexing from settings
- `tests/graph/stack-detect.test.ts`
- `tests/plugin-miner.test.ts`
- `tests/config-miner.test.ts`
- `tests/fixtures/claude-dir/installed_plugins.json` + sample plugin tree
- `tests/fixtures/settings/` — sample settings.json and settings.local.json

### Modify
- `src/graph/schema.ts` — add `provided_by` and `relevant_to` to `EdgeRelation` union
- `src/miners/index.ts` — re-export the two new miners
- `src/core.ts` — invoke both miners in the pipeline, merge their results

---

## Task 1: Extend EdgeRelation schema

**Files:**
- Modify: `src/graph/schema.ts:46-62`

- [ ] **Step 1: Read current EdgeRelation union**

Run: `grep -n "EdgeRelation" src/graph/schema.ts`
Expected: shows the `export type EdgeRelation = ...` union ending with `"triggered_by"`.

- [ ] **Step 2: Add the two new relations**

Edit `src/graph/schema.ts`. Change:

```typescript
  // v0.2: skills-miner uses this to link keyword concept nodes to the
  // skill concept nodes they activate. Skills themselves use the existing
  // `similar_to` relation for cross-references (Related Skills sections).
  | "triggered_by";
```

to:

```typescript
  // v0.2: skills-miner uses this to link keyword concept nodes to the
  // skill concept nodes they activate. Skills themselves use the existing
  // `similar_to` relation for cross-references (Related Skills sections).
  | "triggered_by"
  // v0.5: ecosystem miners use these to link plugin-provided skills/agents
  // to their parent plugin (`provided_by`) and to project files the skill
  // is relevant to (`relevant_to`, only emitted for EXTRACTED/INFERRED).
  | "provided_by"
  | "relevant_to";
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/graph/schema.ts
git commit -m "feat(schema): add provided_by and relevant_to edge relations"
```

---

## Task 2: Stack-detect utility — failing test

**Files:**
- Create: `tests/graph/stack-detect.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/graph/stack-detect.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectStack } from "../../src/graph/stack-detect.js";
import type { GraphNode } from "../../src/graph/schema.js";

function makeFileNode(sourceFile: string, label = sourceFile): GraphNode {
  return {
    id: `file:${sourceFile}`,
    label,
    kind: "file",
    sourceFile,
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
  };
}

function makeClassNode(label: string): GraphNode {
  return {
    id: `class:${label}`,
    label,
    kind: "class",
    sourceFile: "src/x.py",
    sourceLocation: null,
    confidence: "EXTRACTED",
    confidenceScore: 1.0,
    lastVerified: 0,
    queryCount: 0,
    metadata: {},
  };
}

describe("detectStack", () => {
  it("returns empty set for empty input", () => {
    expect(detectStack([])).toEqual(new Set());
  });

  it("detects python from .py files", () => {
    const nodes = [makeFileNode("src/main.py")];
    expect(detectStack(nodes).has("python")).toBe(true);
  });

  it("detects typescript from .ts and .tsx files", () => {
    const nodes = [makeFileNode("src/a.ts"), makeFileNode("src/b.tsx")];
    const stack = detectStack(nodes);
    expect(stack.has("typescript")).toBe(true);
  });

  it("detects fastapi framework from class labels", () => {
    const nodes = [makeFileNode("src/main.py"), makeClassNode("FastAPIRouter")];
    const stack = detectStack(nodes);
    expect(stack.has("python")).toBe(true);
    expect(stack.has("fastapi")).toBe(true);
  });

  it("detects mixed stack", () => {
    const nodes = [
      makeFileNode("backend/main.py"),
      makeFileNode("frontend/app.ts"),
    ];
    const stack = detectStack(nodes);
    expect(stack.has("python")).toBe(true);
    expect(stack.has("typescript")).toBe(true);
  });

  it("ignores non-file non-class nodes for extension detection", () => {
    const nodes: GraphNode[] = [
      {
        id: "concept:foo",
        label: "foo.py",
        kind: "concept",
        sourceFile: "",
        sourceLocation: null,
        confidence: "EXTRACTED",
        confidenceScore: 1.0,
        lastVerified: 0,
        queryCount: 0,
        metadata: {},
      },
    ];
    expect(detectStack(nodes).has("python")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/stack-detect.test.ts`
Expected: all tests FAIL with "Cannot find module '../../src/graph/stack-detect.js'".

---

## Task 3: Stack-detect utility — implementation

**Files:**
- Create: `src/graph/stack-detect.ts`

- [ ] **Step 1: Write minimal implementation**

Create `src/graph/stack-detect.ts`:

```typescript
/**
 * Project stack detection.
 *
 * Reads a snapshot of graph nodes (typically fresh AST output) and returns
 * a set of lowercase tokens describing the project's languages and
 * frameworks (e.g. "python", "fastapi", "docker"). Used by ecosystem
 * miners to score plugin-provided skills and agents against the current
 * project context.
 *
 * Pure function. No I/O. No store access. Caller provides the nodes.
 */
import type { GraphNode } from "./schema.js";

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".pl": "perl",
  ".pm": "perl",
};

const FRAMEWORK_MARKERS: Record<string, string> = {
  fastapi: "fastapi",
  django: "django",
  flask: "flask",
  pytest: "pytest",
  streamlit: "streamlit",
  pydantic: "pydantic",
  express: "express",
  react: "react",
  nextjs: "nextjs",
  "next.js": "nextjs",
  vue: "vue",
  angular: "angular",
  playwright: "playwright",
  gin: "gin",
  echo: "echo",
  fiber: "fiber",
  actix: "actix",
  tokio: "tokio",
  axum: "axum",
  spring: "spring",
  springboot: "springboot",
  junit: "junit",
  docker: "docker",
  postgres: "postgres",
  postgresql: "postgres",
  redis: "redis",
  graphql: "graphql",
  grpc: "grpc",
  duckdb: "duckdb",
};

export function detectStack(nodes: readonly GraphNode[]): Set<string> {
  const tokens = new Set<string>();

  for (const node of nodes) {
    if (node.kind === "file" && node.sourceFile) {
      const ext = node.sourceFile.match(/\.[a-z]+$/i)?.[0]?.toLowerCase();
      if (ext && EXT_TO_LANGUAGE[ext]) {
        tokens.add(EXT_TO_LANGUAGE[ext]);
      }
    }

    if (node.kind === "file" || node.kind === "class" || node.kind === "function") {
      const label = node.label.toLowerCase();
      for (const [marker, framework] of Object.entries(FRAMEWORK_MARKERS)) {
        if (label.includes(marker)) {
          tokens.add(framework);
        }
      }
    }
  }

  return tokens;
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/graph/stack-detect.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/graph/stack-detect.ts tests/graph/stack-detect.test.ts
git commit -m "feat(graph): add stack-detect utility for project language/framework detection"
```

---

## Task 4: Relevance scoring — failing test

**Files:**
- Create: `tests/plugin-miner-scoring.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/plugin-miner-scoring.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { scoreRelevance } from "../src/miners/plugin-miner.js";

describe("scoreRelevance", () => {
  it("returns INFERRED 0.6 when stack is empty", () => {
    const result = scoreRelevance("python-tdd", "Python TDD workflow", new Set());
    expect(result.confidence).toBe("INFERRED");
    expect(result.score).toBe(0.6);
  });

  it("returns EXTRACTED 1.0 when skill name matches stack language", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("python-tdd", "Python TDD workflow", stack);
    expect(result.confidence).toBe("EXTRACTED");
    expect(result.score).toBe(1.0);
  });

  it("returns EXTRACTED 1.0 when skill matches stack framework", () => {
    const stack = new Set(["python", "fastapi"]);
    const result = scoreRelevance("fastapi-patterns", "FastAPI patterns", stack);
    expect(result.confidence).toBe("EXTRACTED");
  });

  it("returns AMBIGUOUS 0.2 when skill mentions non-matching language", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("kotlin-review", "Kotlin code review", stack);
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.score).toBe(0.2);
  });

  it("returns INFERRED 0.6 for universal keywords when no language mention", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("security-review", "Security audit", stack);
    expect(result.confidence).toBe("INFERRED");
    expect(result.score).toBe(0.6);
  });

  it("returns AMBIGUOUS 0.2 when nothing matches", () => {
    const stack = new Set(["python"]);
    const result = scoreRelevance("random-thing", "unrelated content", stack);
    expect(result.confidence).toBe("AMBIGUOUS");
    expect(result.score).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plugin-miner-scoring.test.ts`
Expected: FAIL with "Cannot find module '../src/miners/plugin-miner.js'".

---

## Task 5: Relevance scoring — implementation

**Files:**
- Create: `src/miners/plugin-miner.ts` (scoring function + stub miner export)

- [ ] **Step 1: Write minimal implementation**

Create `src/miners/plugin-miner.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/plugin-miner-scoring.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/miners/plugin-miner.ts tests/plugin-miner-scoring.test.ts
git commit -m "feat(plugin-miner): add relevance scoring with stack awareness"
```

---

## Task 6: Plugin-miner fixture setup + failing tests

**Files:**
- Create: `tests/fixtures/claude-dir/plugins/installed_plugins.json`
- Create: `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/skills/tdd/SKILL.md`
- Create: `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/skills/python-review/SKILL.md`
- Create: `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/agents/reviewer.md`
- Create: `tests/plugin-miner.test.ts`

- [ ] **Step 1: Create installed_plugins.json fixture**

Create `tests/fixtures/claude-dir/plugins/installed_plugins.json`:

```json
{
  "plugins": {
    "sample-plugin@mp": [
      {
        "scope": "user",
        "installPath": "FIXTURE_ABS_PATH",
        "version": "1.2.3",
        "installedAt": "2026-04-01T00:00:00Z",
        "lastUpdated": "2026-04-10T00:00:00Z",
        "gitCommitSha": "abc123"
      }
    ]
  }
}
```

Note: `FIXTURE_ABS_PATH` is a sentinel — test code rewrites it at runtime to the absolute path of the fixture plugin directory.

- [ ] **Step 2: Create fixture SKILL.md files**

Create `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/skills/tdd/SKILL.md`:

```markdown
---
name: tdd
description: Test-driven development workflow for any project
---

Write tests first.
```

Create `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/skills/python-review/SKILL.md`:

```markdown
---
name: python-review
description: Python code review with PEP 8 and type-hint checks
---

Review Python code.
```

- [ ] **Step 3: Create fixture agent**

Create `tests/fixtures/claude-dir/plugins/store/plugins/sample-plugin@mp/agents/reviewer.md`:

```markdown
---
name: reviewer
description: General-purpose code review agent
---

Review code.
```

- [ ] **Step 4: Write the failing tests**

Create `tests/plugin-miner.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { minePlugins } from "../src/miners/plugin-miner.js";
import type { GraphNode } from "../src/graph/schema.js";

const FIXTURE_SRC = resolve(__dirname, "fixtures/claude-dir");

function setupFixture(): string {
  const tmp = join(tmpdir(), `engram-plugin-miner-${Date.now()}-${Math.random()}`);
  mkdirSync(tmp, { recursive: true });

  // Copy fixture tree and rewrite installPath
  copyDir(FIXTURE_SRC, tmp);
  const manifestPath = join(tmp, "plugins", "installed_plugins.json");
  const manifest = readFileSync(manifestPath, "utf-8");
  const pluginAbs = join(tmp, "plugins", "store", "plugins", "sample-plugin@mp");
  // JSON-escape the path (Windows backslashes)
  const escaped = pluginAbs.replace(/\\/g, "\\\\");
  writeFileSync(manifestPath, manifest.replace("FIXTURE_ABS_PATH", escaped));
  return tmp;
}

function copyDir(src: string, dst: string): void {
  const { readdirSync, statSync, copyFileSync } = require("node:fs") as typeof import("node:fs");
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const s = join(src, entry);
    const d = join(dst, entry);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
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
    // Create a second plugin with nothing inside
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
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run tests/plugin-miner.test.ts`
Expected: FAIL. The "empty dir" and env-var tests may pass (stub returns empty), but the fixture-based tests FAIL because `minePlugins` is a stub returning empty.

---

## Task 7: Plugin-miner implementation

**Files:**
- Modify: `src/miners/plugin-miner.ts` (replace stub with real implementation)

- [ ] **Step 1: Replace the stub with the full implementation**

Replace the `minePlugins` stub at the bottom of `src/miners/plugin-miner.ts` with:

```typescript
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { detectStack } from "../graph/stack-detect.js";
import { toPosixPath } from "../graph/path-utils.js";

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

  // Pick first file whose language matches — used as relevant_to target.
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

    // Skills
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

        // relevant_to edge for non-AMBIGUOUS skills
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

    // Agents
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
```

Also add the import of `GraphNode` at the top of the file:

```typescript
import type { Confidence, GraphEdge, GraphNode } from "../graph/schema.js";
```

(It's already imported via the stub signature — verify the import is present.)

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/plugin-miner.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 3: Run the full suite to confirm no regressions**

Run: `npm test`
Expected: all 486+ existing tests still pass, plus the new ones.

- [ ] **Step 4: Commit**

```bash
git add src/miners/plugin-miner.ts tests/plugin-miner.test.ts tests/fixtures/claude-dir/
git commit -m "feat(plugin-miner): index plugins, skills, and agents with relevance scoring"
```

---

## Task 8: Config-miner fixture setup + failing tests

**Files:**
- Create: `tests/fixtures/settings/settings.json`
- Create: `tests/fixtures/settings/settings.local.json`
- Create: `tests/config-miner.test.ts`

- [ ] **Step 1: Create fixture settings files**

Create `tests/fixtures/settings/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "engram intercept" }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "engram intercept" }
        ]
      }
    ]
  },
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@context7/mcp"]
    },
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"]
    }
  }
}
```

Create `tests/fixtures/settings/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "local-hook.sh" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/config-miner.test.ts`:

```typescript
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
    // Uses a known-bad path approach: pass a directory as if it were a file
    const result = mineConfig(FIXTURE_DIR, undefined);
    expect(result.nodes).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/config-miner.test.ts`
Expected: FAIL with "Cannot find module '../src/miners/config-miner.js'".

---

## Task 9: Config-miner implementation

**Files:**
- Create: `src/miners/config-miner.ts`

- [ ] **Step 1: Write implementation**

Create `src/miners/config-miner.ts`:

```typescript
/**
 * Config Miner — indexes configured Claude Code hooks and MCP servers as
 * concept nodes. Always-on infrastructure: no relevance scoring, confidence
 * fixed at EXTRACTED 1.0.
 *
 * Hooks can be configured at global (~/.claude/settings.json) or project
 * (.claude/settings.local.json) scope; both are merged. MCP servers only
 * come from global settings (matching Claude Code's precedence).
 *
 * Silent failure throughout — malformed settings must not crash engram.
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

  // MCP servers: global only
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/config-miner.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/miners/config-miner.ts tests/config-miner.test.ts tests/fixtures/settings/
git commit -m "feat(config-miner): index hooks and MCP servers from Claude Code settings"
```

---

## Task 10: Export new miners from index.ts

**Files:**
- Modify: `src/miners/index.ts`

- [ ] **Step 1: Read current index**

Run: `cat src/miners/index.ts`
Expected output shows 3 re-exports (ast-miner, git-miner, session-miner). Note: skills-miner is deliberately NOT re-exported here (it's imported directly by core.ts). Follow the same pattern for the new miners — they're imported directly by core.ts, no re-export needed.

- [ ] **Step 2: Decide — no changes to index.ts**

Since skills-miner is imported directly by core.ts and not re-exported, our new miners follow the same pattern. No edit to `index.ts` required. Skip to Task 11.

---

## Task 11: Wire miners into core.ts pipeline — failing integration test

**Files:**
- Modify: `tests/core.test.ts` (add one integration test)

- [ ] **Step 1: Read current core tests**

Run: `grep -n "describe\|it(" tests/core.test.ts | head -20`
Expected: shows existing test structure.

- [ ] **Step 2: Add integration test at the end of tests/core.test.ts**

Append to `tests/core.test.ts`:

```typescript
import { mineConfig } from "../src/miners/config-miner.js";
import { minePlugins } from "../src/miners/plugin-miner.js";

describe("ecosystem miners integration", () => {
  it("plugin-miner and config-miner are invokable with no-op inputs", () => {
    // Smoke test — real fixture-based tests live in plugin-miner.test.ts
    // and config-miner.test.ts. This just verifies the exports exist and
    // are callable from core.ts's perspective.
    const pluginResult = minePlugins("/nonexistent", []);
    const configResult = mineConfig(undefined, undefined);
    expect(pluginResult.nodes).toHaveLength(0);
    expect(configResult.nodes).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it passes (baseline)**

Run: `npx vitest run tests/core.test.ts -t "ecosystem miners"`
Expected: PASS (miners already exist, stubs return empty for missing inputs).

---

## Task 12: Wire miners into core.ts pipeline

**Files:**
- Modify: `src/core.ts:14` (imports), `src/core.ts:75-110` (pipeline)

- [ ] **Step 1: Add imports**

Edit `src/core.ts` around line 14 (after the existing skills-miner import). Add:

```typescript
import { minePlugins } from "./miners/plugin-miner.js";
import { mineConfig } from "./miners/config-miner.js";
```

- [ ] **Step 2: Invoke miners after skills-miner**

Find the block in `src/core.ts` that reads:

```typescript
    const allNodes = [
      ...nodes,
      ...gitResult.nodes,
      ...sessionResult.nodes,
      ...skillNodes,
    ];
    const allEdges = [
      ...edges,
      ...gitResult.edges,
      ...sessionResult.edges,
      ...skillEdges,
    ];
```

Replace with:

```typescript
    // Ecosystem indexing: plugins + nested agents, plus hooks + MCP servers
    // from Claude Code settings. Silent failure — these miners never throw.
    const claudeDir = DEFAULT_SKILLS_DIR.replace(/[/\\]skills$/, "");
    const pluginResult = minePlugins(claudeDir, nodes);
    const globalSettings = join(claudeDir, "settings.json");
    const localSettings = join(root, ".claude", "settings.local.json");
    const configResult = mineConfig(globalSettings, localSettings);

    const allNodes = [
      ...nodes,
      ...gitResult.nodes,
      ...sessionResult.nodes,
      ...skillNodes,
      ...pluginResult.nodes,
      ...configResult.nodes,
    ];
    const allEdges = [
      ...edges,
      ...gitResult.edges,
      ...sessionResult.edges,
      ...skillEdges,
      ...pluginResult.edges,
      ...configResult.edges,
    ];
```

- [ ] **Step 3: Verify `join` is imported from node:path at the top of core.ts**

Run: `grep -n "from \"node:path\"" src/core.ts`
Expected: shows an existing `import { ... } from "node:path"` line. If `join` is not in the import list, add it.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all tests PASS (existing 486 + the new ones from Tasks 2, 4, 6, 8, 11).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/core.ts tests/core.test.ts
git commit -m "feat(core): wire plugin-miner and config-miner into the mining pipeline"
```

---

## Task 13: Manual end-to-end verification

**Files:**
- No code changes — verification only.

- [ ] **Step 1: Re-mine seo-brain**

Run from `c:/Users/shahe/seo-brain`: `node c:/Users/shahe/engram/dist/cli.js init`
Expected: command completes without errors. Output should show a higher node count than before (previously 261; should now include plugin/agent/hook/mcp nodes).

- [ ] **Step 2: Inspect the new nodes**

Run from `c:/Users/shahe/seo-brain`:

```bash
sqlite3 .engram/graph.db "SELECT kind, json_extract(metadata, '$.subkind') AS subkind, COUNT(*) FROM nodes GROUP BY kind, subkind;"
```

Expected: rows showing `concept | plugin | N`, `concept | skill | N`, `concept | agent | N`, `concept | hook | N`, `concept | mcp_server | N`.

- [ ] **Step 3: Verify SessionStart brief still works**

Open a new Claude Code session in seo-brain and confirm the startup brief appears without errors (look for the `[engram] Project brief for seo-brain` line).

- [ ] **Step 4: Test the escape hatch**

Run: `ENGRAM_SKIP_ECOSYSTEM=1 node c:/Users/shahe/engram/dist/cli.js init`
Expected: command succeeds, node count is back to pre-ecosystem baseline (no plugin/hook/mcp nodes in the DB).

- [ ] **Step 5: Commit a CHANGELOG update**

Edit `CHANGELOG.md`. Add a new entry at the top:

```markdown
## Unreleased

### Added
- `plugin-miner`: indexes installed Claude Code plugins and their provided agents as `concept` nodes with `subkind: "plugin"` and `subkind: "agent"`.
- `config-miner`: indexes configured hooks (`subkind: "hook"`) and MCP servers (`subkind: "mcp_server"`) from global and project settings.
- `stack-detect` utility in `src/graph/`: shared language/framework detection from AST nodes.
- New `EdgeRelation` values: `provided_by` and `relevant_to`.
- Environment variable `ENGRAM_SKIP_ECOSYSTEM=1` disables both new miners.
```

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for ecosystem miners"
```

---

## Self-review checklist

- [x] Spec coverage: stack-detect (T2-3), relevance scoring (T4-5), plugin-miner (T6-7), config-miner (T8-9), schema edges (T1), pipeline integration (T11-12), verification (T13).
- [x] No placeholders — every step shows the actual code/command.
- [x] Type consistency: `PluginMineResult` defined in T5, used in T7. `ConfigMineResult` defined in T9. `scoreRelevance` signature consistent across tasks.
- [x] Every test file has both failing-test and passing-impl tasks.
- [x] Windows compatibility: uses `toPosixPath` for sourceFile writes, matches Nick's cross-platform convention.
