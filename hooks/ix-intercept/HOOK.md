---
name: ix-intercept
description: "Front-runs Grep/Glob tool calls with ix text + ix locate for graph-aware context."
metadata:
  { "openclaw": { "emoji": "🔍", "events": ["before_tool_call"], "requires": { "bins": ["ix"] } } }
---

# ix-intercept

Fires before Grep or Glob tool calls. Runs `ix text` and `ix locate`/`ix inventory`
in parallel and injects a concise one-line summary so the agent has graph-aware
context before the native tool runs.
