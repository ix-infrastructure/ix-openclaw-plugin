---
name: ix-map
description: "Refreshes the full ix graph after the agent finishes a response."
metadata:
  { "openclaw": { "emoji": "🗺️", "events": ["agent_end"], "requires": { "bins": ["ix"] } } }
---

# ix-map

Fires after the agent finishes each response. Runs `ix map` asynchronously to
keep the architectural graph current so the next session starts fresh.
Does not block the agent response or session end.
