# ix-openclaw-plugin

This repo is the OpenClaw plugin for [Ix Memory](https://github.com/ix-infrastructure/IX-Memory). When working in this repo, use `ix` commands to navigate it just like any other codebase.

---

## Cognitive Model

OpenClaw + Ix operates as a **three-layer system**:

```
Ix Graph     = structured memory (code relationships, history, decisions)
OpenClaw     = reasoning engine (infers, synthesizes, decides)
Skills/Agents = cognition layer (task abstractions over the graph)
```

This means the agent is **not a command wrapper**. The agent uses Ix as memory to reason, then synthesizes answers. The graph provides facts; the agent provides understanding.

---

## Behavioral Rules

### Always
- Use Ix graph data **before** reading source code
- Read at **symbol level** only — `ix read <function>`, never whole files
- Use **high-level skills** (`/ix-investigate`, `/ix-understand`) not raw commands
- **Stop early** — once you can answer the question, stop querying
- **Label evidence** — distinguish graph-backed facts from inferences

### Never
- Scan entire files unless the whole file is the explicit subject
- Call `ix depends --depth 3+` or `ix trace` without a specific question
- Assume behavior without graph or code evidence
- Output raw command output — always synthesize and summarize
- Run `ix map` for exploration (use `ix subsystems` — it reads cached data)
- Run `ix rank` without `--by <metric>` and `--kind <kind>` (will error)
