---
name: ix-ingest
description: "Runs ix map on edited files to keep the graph current after modifications."
metadata:
  { "openclaw": { "emoji": "🔄", "events": ["tool_result_persist"], "requires": { "bins": ["ix"] } } }
---

# ix-ingest

Fires after Write, Edit, MultiEdit, or NotebookEdit. Runs `ix map` on the changed
file to keep the graph current so the next query reflects the current code state.
Runs asynchronously — does not block the agent response.
