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
timeout 60s ix smells --list --format json
```

This reads the smell results already stored in the graph and runs nothing. It prints
`{count, smells: [{smell, entity_id}]}`: each row names the smell kind (`has_smell.orphan_file`, …)
and a 12-character entity id, not a file. ix does not say when those results were detected,
so they may predate the latest `ix map`; say so when you report them. If nothing is stored
(`count` 0), say that no smell results are stored (not that the graph is clean) and that the
user can ask for fresh detection. Do not run `ix smells` without `--list` (or the `ix-smells`
tool with `detect: true`) unless the user asks for fresh detection: it re-runs the analysis
and writes a new set of results to the Ix backend.

`ix smells` always covers the whole graph (it has no path filter). If `$ARGUMENTS`
scopes to a path, say that the smells cover the whole graph.

Classify each finding: `orphan_file` / `god_module` / `weak_component_member`.

## Phase 3 — Hotspots (only if smells are found, none are stored, or coupling is high)

Run only if Phase 1 or 2 revealed significant issues, or Phase 2 found no stored smells
(an empty store says nothing about health):
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
