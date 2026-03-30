---
name: ix-pre-edit
description: "Runs ix impact before file edits and warns about high blast-radius changes."
metadata:
  { "openclaw": { "emoji": "⚠️", "events": ["before_tool_call"], "requires": { "bins": ["ix"] } } }
---

# ix-pre-edit

Fires before Edit, Write, or MultiEdit tool calls. Runs `ix impact` on the target
file and injects a blast-radius warning when the file has significant dependents.
High-risk edits get a clear signal before damage is done.
