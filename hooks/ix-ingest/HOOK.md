---
name: ix-ingest
description: "No-op. Post-edit graph refresh is handled by the plugin's guarded root map."
metadata:
  { "openclaw": { "emoji": "🔄", "events": ["tool_result_persist"], "requires": { "bins": ["ix"] } } }
---

# ix-ingest

Fires after Write, Edit, MultiEdit, or NotebookEdit and does nothing. It used to
run `ix map <file>`, which Ix rejects (`map` only accepts a directory). The
plugin's `after_tool_call` handler requests the guarded root map instead:
`ix map <git root> --silent`, only for projects that are already mapped, debounced
per root, in the background.
