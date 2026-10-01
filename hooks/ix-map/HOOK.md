---
name: ix-map
description: "No-op. Automatic graph refresh is handled by the plugin's guarded root map."
metadata:
  { "openclaw": { "emoji": "🗺️", "events": ["agent_end"], "requires": { "bins": ["ix"] } } }
---

# ix-map

Fires after the agent finishes each response and does nothing. It used to run a
bare `ix map` in whatever directory the host process was in. Automatic refresh
now happens only through the plugin's guarded root map (after edits and at
session end): `ix map <git root> --silent`, only for projects that are already
mapped, debounced per root, in the background.
