# engram Elevation Trilogy — Design Spec

> **Status:** approved 2026-04-20. Implementation begins on branch `feat/v2.1-reliability-seamless`.
> **Author:** Nick Ashkar with brainstorming skill (Claude).
> **Supersedes:** `00-strategy/next-steps-roadmap.md` v2.0 tail.

## TL;DR

Three sequential releases, each standalone-useful, each setting up the next.

| Release | Codename | Ship target | Theme |
|---------|----------|-------------|-------|
| **v2.1** | Reliability + Zero-Friction Install | +1 week | Close the bleeding — merge contributor PRs, fix #11, seamless install |
| **v2.2** | Spine | +2 weeks | Serena as a first-class engram provider via reusable MCP-client subsystem |
| **v3.0** | Landmines | +3-4 weeks | Mistakes-as-moat expansion + R2 reposition ("the context tool that remembers what broke") |

Between v2.0.2 (shipped 2026-04-18) and v3.0, engram transitions from *"another memory tool"* (ratioed in r/LocalLLaMA) to *"the context tool that remembers what broke"* — differentiated, authoritative, orchestrating Serena, not fighting it.

## Research grounding (2026-04-20)

- **GitHub issues = table stakes:** #5 OOM, #6 contributor OOM fix PR, #11 AST/LSP silent unavailability, #13 reindex CLI PR, #14 Bash auto-reindex. Two external contributors (@gabiudrescu +) actively submitting substantive PRs.
- **npm downloads:** 1,300/week; 10/day organic baseline spiking to 450+ on launch days. Retention unknown — hotfixes don't reach 90% of installs because no self-update path.
- **Reddit reality:** r/LocalLLaMA post ratioed (0.44, "why do I see one of these daily"). 4+ projects named "Engram/Claude Engram/Engram Memory" launched Mar-Apr 2026. **Name collision is real; rename is prohibitively expensive.**
- **Competitors:** Serena just hit stable (JetBrains-powered LSP + published evals), Vera (Rust semantic search), Anthropic native Auto-Memory + Auto-Dream. Engram's differentiator is *not* semantic retrieval (losing ground) — it's the `mistakes` provider + graph orchestration.

## Strategic choices (recorded)

- **Thesis:** T1 + T2 + T3 — all three shipped sequentially as a trilogy (option α over mega-release β or two-way split γ).
- **Positioning:** R2 (keep the name `engram`/`engramx`, rebrand tagline). Rename (R3) is rejected — 2-week migration cost for marginal discovery gain; npm dist-tag equity + GitHub history + active contributors outweigh.
- **Update UX:** Option A — passive notify + manual `engram update`. No background auto-install. Privacy-preserving (no telemetry). Kill-switch via env.

---

# v2.1 — "Reliability + Zero-Friction Install"

## Scope

### Track A — Close the bleeding (reliability)

| Issue | Action | Owner |
|-------|--------|-------|
| **#5 + #6** init OOM on large repos | Merge @gabiudrescu's PR #6 (MAX_DEPTH=100, MAX_FILES_PER_COMMIT=50, `.engramignore`, expanded exclusions). Regression test on 50K-file fixture. | Merge + verify |
| **#11** AST/LSP unavailable despite enabled | Forensic debug `src/providers/resolver.ts:_resetAvailabilityCache`, `src/providers/ast.ts:isAvailable`, `src/providers/lsp.ts:getConnection`. Add regression test that forces enabled=true + asserts provider actually emits rows. | Dedicated follow-up — NOT in the same commit as seamless-install work. |
| **#13** `engram reindex <file>` CLI | Merge existing PR. Add `--auto-reindex` flag to `install-hook`. | Merge |
| **#14** Bash auto-reindex | Widen `--auto-reindex` PostToolUse matcher to Bash. Parse `rm`/`mv`/`cp`/`git rm`/`git mv`/`>`/`>>`. Silent-skip on non-code paths. Reuse `syncFile` primitive. | New code: `src/intercept/handlers/bash-postool.ts` + tests |
| **#3** ecosystem miners | **Defer to v2.2.** Tag the PR "v2.2 candidate." | — |

### Track B — Zero-friction install

| Command | Description |
|---------|-------------|
| **`engram update`** | Detect install manager (npm/pnpm/yarn/bun). Shell out to upgrade command. Verify `engram --version` changed. `--check` dry-run (no install). Passive notify: on any `engram *` invocation, if `~/.engram/last-update-check` > 7 days old and newer version exists, print one-line hint. `ENGRAM_NO_UPDATE_CHECK=1` and `$CI` disable. No telemetry beyond one anonymous GET to `registry.npmjs.org`. |
| **`engram doctor`** | Wrap `src/intercept/component-status.ts` probes into human report. Per-component: ✓/⚠/✗ + remediation hint. `--verbose` for detail. `--json` for machine. Non-zero exit on critical failure. |
| **`engram setup`** | First-run wizard. Steps: (1) `engram init` in current repo if not initialized; (2) `engram install-hook` with scope prompt; (3) detect Cursor/Windsurf/Continue configs and offer adapter setup; (4) run `engram doctor` to verify. One command for "done, working." |
| **`engram init --with-hook`** | Shorthand: init + install-hook in one invocation. Safe-additive to existing `init`. |
| **First-run hint** | On any `engram` subcommand run in a repo lacking `.engram/graph.db`: print `💡 First time? Run 'engram setup' for a zero-friction install.` Throttle via `~/.engram/first-run-shown`. Skip in CI. |

### Track C — Diagnostics (local-only, no telemetry)

| Feature | Description |
|---------|-------------|
| **Crash reports** | On `init` / `watch` / `server` throw: write `~/.engram/crashes/<timestamp>.log` with stack + node version + repo size + engram version. Print path to user. |
| **`engram doctor --export`** | Redacted JSON blob — versions + OS + component statuses. User copy-pastes into bug reports. |

## Architecture (v2.1 only)

```
src/
  cli.ts                              ← add 3 subcommands (update, doctor, setup)
  update/                             ← NEW
    check.ts                          ← npm registry check + semver compare
    install.ts                        ← detect pkg-mgr + shell out to upgrade
    notify.ts                         ← throttled first-run / stale-version hint
  intercept/
    handlers/
      bash-postool.ts                 ← NEW — parse rm/mv/git-rm for reindex
      bash.ts                         ← existing, extend if needed (don't fight it)
    installer.ts                      ← extend with --auto-reindex matcher widening
  doctor/                             ← NEW
    report.ts                         ← format component-status into human report
    remediation.ts                    ← per-component fix hints
  setup/                              ← NEW
    wizard.ts                         ← sequential prompts, idempotent each step
    detect.ts                         ← Cursor/Windsurf/Continue presence detection
tests/
  update/                             ← NEW
  doctor/                             ← NEW
  setup/                              ← NEW
  intercept/handlers/
    bash-postool.test.ts              ← NEW
```

## Acceptance criteria

- [ ] All PRs in "Reliability" table merged or explicitly deferred to v2.2
- [ ] `engram setup` on fresh machine + fresh repo → green `engram doctor` in under 30s
- [ ] `engram update --check` hits registry in < 500ms (cached); `engram update` actually upgrades on npm/pnpm/yarn/bun
- [ ] First-run hint appears exactly once per repo; respects `$CI`
- [ ] `engram update` passive-check respects `ENGRAM_NO_UPDATE_CHECK=1`
- [ ] 730+ tests pass (670 baseline + new)
- [ ] CI green Ubuntu + Windows × Node 20 + 22
- [ ] CHANGELOG + README + SECURITY.md updated
- [ ] Launch post drafted (r/LocalLLaMA + r/ClaudeCode + r/mcp)

## Out of scope for v2.1

- Serena provider (→ v2.2)
- MCP-client subsystem (→ v2.2)
- Mistakes-moat expansion (→ v3.0)
- Rename / npm repackaging (→ rejected per R2)
- Background auto-update (rejected per option A)

---

# v2.2 — "Spine" (Serena provider)

## Strategic framing

> *"engram is the spine; Serena is the LSP. You install one tool, get both."*

Engram orchestrates; Serena does what Serena does best (LSP-grade references). This validates engram's "context spine" positioning at the architecture level. Any future MCP tool (Cursor memory, sequential-thinking, new LSP bridges) plugs in through the same subsystem.

## Architecture

```
src/
  mcp-client/                         ← NEW — reusable subsystem
    client.ts                         ← stdio JSON-RPC client
    lifecycle.ts                      ← spawn / warm / healthcheck / shutdown
    budget.ts                         ← per-provider token budget allocator
  providers/
    serena.ts                         ← NEW provider
    serena-tool-map.ts                ← query-intent → Serena tool routing
  intercept/
    component-status.ts               ← add checkSerena()
bench/
  tasks/semantic/                     ← NEW — 5 benchmark tasks
    task-11-find-caller-lsp
    task-12-cross-module-reference
    task-13-polymorphic-dispatch
    task-14-inherited-method
    task-15-indirect-caller
```

## Serena tools exposed (5 only)

| Serena tool | Engram provider emits | Rationale |
|-------------|----------------------|-----------|
| `find_symbol` | symbol location + precise signature | Graph file-for-class, LSP-precise |
| `find_references` | 2-hop reverse graph | LSP-exact find-caller replaces regex |
| `get_symbol_body` | 50-line function body | Read function without full-file read |
| `list_symbols_overview` | architecture sketch | Improves task-07 benchmark |
| `get_symbols_overview` | per-file symbol summary | On-demand hot-file exploration |

**Deliberately skipped:** all `replace_*`/`insert_*` write tools. Engram reads through Serena, writes nothing. Keeps security posture simple.

## Budget allocator

```
intent = "find-caller"      → serena 60%, structure 20%, git 10%, mistakes 10%
intent = "how hot is X"     → git 60%, structure 20%, mistakes 20%
intent = "landmine check"   → mistakes 50%, git 30%, structure 20%
intent = "unknown"          → even split across top 5
```

Provider weights are data-driven via `config.ts`. Minimum floor per enabled provider: 5% of packet (prevents starvation). Learnable later in v3.0.

## Graceful degradation matrix

| State | Behavior |
|-------|----------|
| Serena not installed | `doctor` shows: `⚠ Serena: not installed. Install: pip install serena-agent`. Engram falls back to AST provider. |
| Serena wrong version | Compat matrix in availability check. Fall back. |
| Serena crashes mid-session | MCP client restarts once; on 2nd crash, disable for session. |
| Serena slow (>2s) | Per-query timeout; return partial. |
| User opts out | `ENGRAM_DISABLE_SERENA=1` or `engram config set serena.enabled false`. |

## Acceptance criteria

- [ ] 5 new bench tasks with **real measured numbers** (no estimates in the launch post)
- [ ] `engram doctor` reports Serena status + install hint
- [ ] 30+ new mcp-client tests (lifecycle, timeouts, reconnect, corruption)
- [ ] Graceful fallback verified — kill Serena mid-session, engram keeps working
- [ ] Budget allocator: 10+ adversarial queries stay ≤500 token packet
- [ ] `engram setup` v2.1 wizard detects missing Serena and offers `pip install serena-agent`
- [ ] Licensing: Serena MIT + engram Apache-2.0 — no embedding, stdio-only, zero contamination

## Risks

| Risk | Mitigation |
|------|-----------|
| Serena spawn cold-start 1-2s | Warm on SessionStart, subsequent queries cached |
| Python dep breaks engram's "zero native deps" brand | Serena is **optional**; engram core stays zero-deps. Precise language in README. |
| Serena API churns | Pin compat range in availability check; `doctor` catches mismatch |
| Budget allocator starves non-Serena providers | 5% floor per enabled provider, adversarial-query tests |

---

# v3.0 — "Landmines" (Mistakes moat + R2 reposition)

## Strategic framing

> *"engram is the only context tool that remembers what broke."*

The `mistakes` provider is already unique. v3.0 doubles down:
- **Live regret learning:** `engram learn "X was wrong because Y"` post-compaction auto-surfaces in the NEXT session
- **Confidence decay:** mistakes fade over time unless re-confirmed (prevents stale-warning fatigue)
- **Agent-visible scoring:** the context packet shows *why* a file is landmined — "3 mistakes in last 30d, newest from 2d ago"
- **Budget-allocator integration:** landmined files get automatic priority boost in provider weighting
- **Cross-session replay:** after context compaction, mistakes for files touched in recent session get re-injected first

## R2 repositioning

- **Homepage tagline change:** from "The context spine for AI coding agents" → "The context tool that remembers what broke."
- **Reddit narrative:** lead every post with a mistake-story ("Claude spent 2 hours rewriting the auth flow in the exact way we learned NOT to last month. engram stops that.")
- **README hero section:** restructure around landmines as the lead value-prop; graph/Serena/cache become supporting evidence.
- **No rename** — npm, GitHub, URLs stay. Tagline rebrand only.

## Scope (initial — to be refined in a v3.0 design spec)

- Expand `mistakes-miner` to catch more failure patterns (deprecation warnings, test failures, agent self-corrections)
- Add `engram landmines` CLI (`mistakes` alias + decay + density ranking)
- Budget-allocator scoring boost for files with recent mistakes
- Cross-session mistake-replay after PreCompact
- Ship 5 new bench tasks that explicitly measure "mistake avoidance"
- Reposition all marketing copy on cirvgreen.com/products/engram

## Acceptance criteria (placeholder — v3.0 spec to be written after v2.2 ships)

- [ ] Mistakes density visible in `engram stats` and dashboard
- [ ] Confidence decay tested on synthetic 90-day timeline
- [ ] "Landmine avoidance" bench tasks — measurable % improvement
- [ ] cirvgreen.com/products/engram rewritten around new tagline
- [ ] Reddit launch: r/LocalLLaMA (the one we ratioed) + r/ClaudeCode + r/mcp + HN

---

# Release rhythm

```
Week 1       → v2.1 ships (Reliability + Zero-Friction Install)
Week 1-3     → v2.2 designed + built (Spine / Serena)
Week 3       → v2.2 ships
Week 3-7     → v3.0 designed + built (Landmines / R2)
Week 7       → v3.0 ships — the authoritative reposition moment
```

Three launches in ~7 weeks. Each standalone-useful. Each building credibility for the next.

## Success metrics (per release)

| Metric | v2.1 | v2.2 | v3.0 |
|--------|------|------|------|
| npm weekly downloads (target) | 1.8K (+40%) | 3K | 6K |
| GitHub stars (target) | +50 | +100 | +300 |
| Reddit post score | ≥50 on r/ClaudeCode | ≥100 on r/LocalLLaMA | ≥300 on r/LocalLLaMA |
| Retention proxy (downloads 7d after non-launch day) | 15/day | 25/day | 60/day |
| Active contributors | 2 → 3 | 3 → 4 | 4 → 6 |

---

# Non-goals (entire trilogy)

- **No team/shared-graph feature.** Single-user remains the scope.
- **No cloud backend.** Local-first is invariant.
- **No embedding layer inside engram core.** Hybrid retrieval is a Serena-style-provider concern.
- **No rename or npm repackaging.**
- **No paid tier.** engram remains 100% Apache-2.0 through v3.0. Monetization, if ever, comes *after* distribution is proven.
- **No backwards-incompat breakage.** v1.x graph.db auto-migrates all the way through v3.0.
