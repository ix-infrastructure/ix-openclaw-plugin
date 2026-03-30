---
name: ix-briefing
description: "Injects Ix session briefing (goals, bugs, decisions) into incoming messages. Requires Ix Pro."
metadata:
  { "openclaw": { "emoji": "📋", "events": ["message:received"], "requires": { "bins": ["ix"] } } }
---

# ix-briefing

Fires when a new message is received. Injects a compact session briefing from Ix Pro
once every 10 minutes. No-op if Ix Pro is not installed or if the briefing cache is fresh.
