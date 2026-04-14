# Engram Ecosystem Miners — Design

**Date:** 2026-04-14
**Author:** Shahe
**Status:** Approved, ready for implementation plan
**Target:** engram (fork at shahe-dev/engram, upstream at NickCirv/engram@v0.4.4)

## Goal

Extend engram to index the Claude Code plugin ecosystem — plugins, agents, hooks, and MCP servers — so they appear as first-class nodes in the knowledge graph alongside code structure, skills, git history, and sessions.

Today, engram's `skills-miner` indexes SKILL.md files but ignores the surrounding ecosystem: which plugin owns a skill, what agents a plugin provides, which hooks are configured, and which MCP servers are installed. Adding these closes the gap without duplicating any of Nick's existing mining logic.

## Non-goals

- No remote plugin marketplace indexing (local `~/.claude/plugins/` only).
- No plugin version history or update detection.
- No hook command parsing — store the command string, don't try to understand it.
- No MCP server runtime status checks.
- No trigger extraction from plugin skills (Nick's `skills-miner` already handles SKILL.md triggers; we do not duplicate).

## Architecture

Two new miners and one shared utility, following Nick's conventions:

```
src/graph/
  stack-detect.ts          (NEW) — project stack detection from store
src/miners/
  plugin-miner.ts          (NEW) — plugins + nested agents
  config-miner.ts          (NEW) — hooks + MCP servers
```

### `src/graph/stack-detect.ts`

Pure function `detectStack(store: GraphStore): Set<string>`. Reads `file` and `class`/`function` nodes from the store, maps extensions to languages (`.py` → `python`, `.ts` → `typescript`, etc.), and matches labels against framework markers (`fastapi`, `react`, `docker`, etc.). Returns lowercase tokens.

Single source of truth for stack detection. Future miners that need project-context awareness import from here rather than reinventing.

### `src/miners/plugin-miner.ts`

Input: `claudeDir` (default `~/.claude`), `store` (for stack detection).
Output: nodes for each plugin, skill, and agent; edges `provided_by` (skill/agent → plugin) and `relevant_to` (skill/agent → project file) when relevance scores EXTRACTED or INFERRED.

Reads `plugins/installed_plugins.json`, walks each plugin's `skills/` and `agents/` directories, parses SKILL.md and agent frontmatter.

### `src/miners/config-miner.ts`

Input: `settingsPath` (global `~/.claude/settings.json`) and `localSettingsPath` (project `<root>/.claude/settings.local.json`).
Output: nodes for each hook and MCP server. No relevance scoring, no `relevant_to` edges. Confidence 1.0 — these are always-on infrastructure, not recommendations.

## Schema

### No new `NodeKind` values

All new nodes use `kind: "concept"` with a `metadata.subkind` discriminator, following Nick's established pattern (his skills-miner uses `concept + subkind: "skill"`).

| Entity | `kind` | `metadata.subkind` | id format |
|---|---|---|---|
| Plugin | `concept` | `plugin` | `plugin:<name>` |
| Agent | `concept` | `agent` | `agent:<plugin>/<name>` |
| Hook | `concept` | `hook` | `hook:<type>:<matcher>` |
| MCP server | `concept` | `mcp_server` | `mcp:<name>` |

### New `EdgeRelation` values

Additive to the existing enum in `src/graph/schema.ts`:

- `provided_by` — skill/agent → plugin
- `relevant_to` — skill/agent → file (only emitted when source node scored EXTRACTED or INFERRED)

## Data flow

### Plugin-miner

1. Read `~/.claude/plugins/installed_plugins.json`.
2. For each plugin entry: create a plugin concept node (`id = plugin:<name>`).
3. For each `SKILL.md` in the plugin's `skills/` directory:
   - Parse frontmatter (reuse Nick's YAML parser — extract to a shared helper or import from `skills-miner`).
   - Score relevance against stack tokens via `detectStack`.
   - Create skill node with confidence from scoring.
   - Create `provided_by` edge → plugin.
   - If confidence is EXTRACTED or INFERRED, create one `relevant_to` edge to the first matching file node in the store.
4. Same loop for each `.md` in the plugin's `agents/` directory.

### Config-miner

1. Read `~/.claude/settings.json` and `<project>/.claude/settings.local.json`.
2. For each hook entry (PreToolUse / PostToolUse / SessionStart / UserPromptSubmit / Stop / etc., plus matcher and command):
   - Create hook node with confidence 1.0.
3. For each MCP server in global settings:
   - Create MCP node with confidence 1.0.

Local settings may add hooks; MCP servers only come from global settings (matching Claude Code's own precedence).

## Relevance scoring

Applied to skills and agents only. Hooks and MCP servers get confidence 1.0 because they are always-on infrastructure, not LLM-selected suggestions.

| Match type | Confidence | Score |
|---|---|---|
| Skill token matches a detected language or framework | `EXTRACTED` | 1.0 |
| Skill mentions a universal dev keyword (tdd, debug, security, etc.) | `INFERRED` | 0.6 |
| Skill mentions a language token that does NOT match detected stack | `AMBIGUOUS` | 0.2 |
| No match, no language mismatch | `AMBIGUOUS` | 0.2 |

Stack set is empty when the store has no AST nodes yet — in that case skills default to `INFERRED` / 0.6 (can't rule anything out yet).

## Error handling

Both miners fail silently and gracefully, matching Nick's existing convention.

- `~/.claude/` missing → return `{nodes: [], edges: []}`
- `installed_plugins.json` missing or malformed → return empty
- Individual plugin's `skills/` or `agents/` directory missing → skip, continue
- Individual `SKILL.md` or agent file unparseable → skip that file, continue (optionally append to an `anomalies[]` array for diagnostics)
- Broken symlinks → skip silently
- Settings JSON malformed → return empty from that source, still process the other

No exception escapes either miner. A corrupted plugin install must not crash engram's SessionStart brief.

### Environment escape hatch

Mirror Nick's `ENGRAM_SKIP_SKILLS` pattern:

- `ENGRAM_SKIP_ECOSYSTEM=1` → both new miners return empty. Used by CI and tests.

## Testing

### `tests/graph/stack-detect.test.ts`

- Nodes with `.py` files → set includes `"python"`.
- Node labels containing `fastapi` → set includes `"fastapi"`.
- Empty store → returns empty set.
- Mixed stack (Python + TypeScript) → includes both.

### `tests/plugin-miner.test.ts`

Fixtures under `tests/fixtures/claude-dir/`.

- Missing `.claude/` → empty.
- Missing `installed_plugins.json` → empty.
- Malformed JSON → empty.
- Valid plugin with 2 skills and 1 agent → 3 content nodes + 3 `provided_by` edges + 1 plugin node.
- Skill matching stack → EXTRACTED confidence + `relevant_to` edge created.
- Skill not matching stack → AMBIGUOUS confidence, no `relevant_to` edge.
- Plugin with no `skills/` or `agents/` → plugin node only.
- Corrupted `SKILL.md` → skipped, other skills still indexed.
- `ENGRAM_SKIP_ECOSYSTEM=1` → empty.

### `tests/config-miner.test.ts`

- Missing settings files → empty.
- Malformed JSON → empty.
- Valid settings with 3 hooks + 2 MCP servers → 5 nodes, all confidence 1.0.
- `mcpServers` without `hooks` → MCP nodes only.
- Local + global settings both provide hooks → both sets indexed.
- `ENGRAM_SKIP_ECOSYSTEM=1` → empty.

### Integration

One integration test in `tests/core.test.ts` against a fixture repo, verifying the full pipeline produces expected counts.

## Pipeline integration

Miners run in `src/core.ts` in this order:

1. `ast-miner` — provides the data `stack-detect` reads.
2. `skills-miner` — Nick's existing miner, unchanged.
3. `plugin-miner` — new.
4. `config-miner` — new.

## Upstream contribution path

After local implementation and verification, prepare as a single PR to `NickCirv/engram`:

- One commit per miner (plugin-miner, config-miner, stack-detect) to make review easier.
- PR description explains the gap, the schema discipline (concept+subkind, no new NodeKinds), and the feature-flag escape hatch.
- Tests land with each commit.

Windows/Node 25 fixes (already upstream as of v0.4.4) are not part of this PR.
