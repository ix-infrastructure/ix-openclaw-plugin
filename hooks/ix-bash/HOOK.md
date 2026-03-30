---
name: ix-bash
description: "Intercepts bash grep/rg commands and front-runs with ix text + ix locate."
metadata:
  { "openclaw": { "emoji": "🐚", "events": ["before_tool_call"], "requires": { "bins": ["ix"] } } }
---

# ix-bash

Fires before Bash tool calls. Detects grep/rg search patterns and front-runs
them with `ix text` + `ix locate` for graph-aware results. The native Bash
command still runs — this injects additional context.
