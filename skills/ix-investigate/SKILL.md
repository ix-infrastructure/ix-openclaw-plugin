---
name: ix-investigate
description: Deep dive into a symbol, feature, or bug. Graph-first, minimal code reads, early stopping when sufficient evidence found.
metadata:
  { "openclaw": { "requires": { "bins": ["ix"] } } }
---

Run `command -v ix` to verify ix is on PATH. Never use tilde paths (`~/...`) or absolute paths — always invoke `ix` directly via PATH. If not found, fall back to Grep + Read.

## Goal

Answer: *what is this, how does it connect, and what's the execution path?* Stop as soon as those three questions can be answered accurately.

## Phase 1 — Locate (always)

```bash
timeout 60s ix locate $ARGUMENTS --limit 5 --format llm
```

If multiple matches: use `--kind`, `--path`, or `--pick N` to resolve. Do not proceed until the entity is unambiguous.

If `ix locate` returns nothing: try `ix text $ARGUMENTS --limit 10 --format llm`.

## Phase 2 — Explain (always)

```bash
timeout 60s ix explain <resolved-symbol> --format llm
```

Extract: role, importance, caller count, callee count, confidence score.

**Evaluate:** Is the explanation sufficient to answer the question?

**Stop if:** explain gave clear role, purpose, and connection summary → skip to Output.

## Phase 3 — Connections (run only if caller/callee detail needed)

Run only the directions you need — not both by default:

```bash
# If "who uses this" matters:
timeout 60s ix callers <symbol> --limit 15 --format llm

# If "what does this do internally" matters:
timeout 60s ix callees <symbol> --limit 15 --format llm
```

**Stop if:** you now know who uses it and what it depends on.

## Phase 4 — Trace (run only if execution flow is unclear)

```bash
timeout 60s ix trace <symbol> --format llm
```

One trace only. Pick the most representative direction (`--upstream` or `--downstream`) based on the question.

**Stop if:** execution path is now clear.

## Phase 5 — Code read (last resort only)

Only if the above steps leave a specific implementation question unanswered:
```bash
timeout 60s ix read <symbol> --format llm
```

Read **the symbol only** — never the full file. If the symbol is a class, read the specific method suspected.

**Hard limit:** One `ix read` call maximum. If still unclear after reading, surface the ambiguity to the user rather than reading more.

## Output

```
## [Symbol] — Investigation

**What it is:** [kind, file, subsystem — from graph]
**Role:** [orchestrator / boundary / helper / utility / etc.]

**Execution flow:**
[downstream: what it calls → what those call, 2 levels max]
[upstream: who calls it, top 5]

**Key connections:**
- Depends on: [top 3 callees]
- Used by: [top 3 callers with their subsystem]

**Evidence quality:** [strong / partial / uncertain] — [one-line reason]

**Next step:**
- [most useful follow-up based on findings]
```

If confidence < 0.7 in ix output, label those claims as `[uncertain]` and recommend `ix map` to refresh.
