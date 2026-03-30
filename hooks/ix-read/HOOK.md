---
name: ix-read
description: "Injects ix overview + inventory + impact context before file reads."
metadata:
  { "openclaw": { "emoji": "📖", "events": ["before_tool_call"], "requires": { "bins": ["ix"] } } }
---

# ix-read

Fires before Read tool calls. Runs `ix inventory`, `ix overview`, and `ix impact`
in parallel and injects a concise summary with key entities, risk level, and
dependent count so the agent has structural context before reading the file.
