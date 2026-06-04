---
name: ix-architecture
description: Analyze system design — structure, coupling, code smells, and high-risk hotspots. Purely graph-based, no code reads.
metadata:
  { "openclaw": { "requires": { "bins": ["ix"] } } }
---

Run `command -v ix` to verify ix is on PATH. Never use tilde paths (`~/...`) or absolute paths — always invoke `ix` directly via PATH. If not found, stop and say so — this skill requires a graph.

## Goal

Answer: *how healthy is this system's design, where are the weak boundaries, and what should be improved?* Never reads source code — structural analysis only.

## Phase 1 — Structure (always)

Run in parallel:
```bash
timeout 60s ix subsystems --format llm
timeout 60s ix subsystems --list --format llm
```

If `$ARGUMENTS` is provided, also run:
```bash
timeout 60s ix subsystems $ARGUMENTS --explain
timeout 60s ix subsystems $ARGUMENTS --format llm
```

Extract:
- Region hierarchy (systems → subsystems → modules)
- Cohesion scores per region (higher = more self-contained)
- External coupling per region (lower = better)
- `crosscut_score` > 0.1 → cross-cutting concern (design smell)
- `confidence` < 0.6 → fuzzy boundary (uncertain region)

## Phase 2 — Smells

```bash
timeout 60s ix smells --format llm
```

If `$ARGUMENTS` scopes to a path:
```bash
timeout 60s ix smells --path $ARGUMENTS --format llm
```

Classify each finding: `orphan` / `god-module` / `weak-component`.

## Phase 3 — Hotspots (only if smells are found or coupling is high)

Run only if Phase 1 or 2 revealed significant issues:
```bash
timeout 60s ix rank --by dependents --kind class    --top 10 --exclude-path test --format llm
timeout 60s ix rank --by dependents --kind function --top 10 --exclude-path test --format llm
```

Correlate: are the most-depended-on entities also in poorly-bounded subsystems? These are the highest-risk components.

## Output

```
## Architecture Analysis

### System Structure
[Region hierarchy with file counts. Flag: low-confidence boundaries, high-coupling regions, cross-cutting modules.]

### Health Scores
| Region | Cohesion | Ext. Coupling | Boundary Ratio | Flag |
|--------|----------|---------------|----------------|------|
| [name] | [0-1]    | [0-1]         | [ratio]        | [⚠ if bad] |

### Code Smells
**High severity:**
- [smell type] in [file/module] — [why it matters]

**Medium severity:**
- ...

### Hotspots
[Top components where structural debt + centrality combine — highest risk for changes]

### Improvement Areas
1. [specific issue] — [concrete suggestion]
2. ...

### What's healthy
[Briefly note well-structured areas — not everything is a problem]
```

**Evidence:** All claims must cite graph data (cohesion scores, smell counts, rank positions). No speculative design advice without structural evidence.
