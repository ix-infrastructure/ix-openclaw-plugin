// Copyright 2026 Ix Infrastructure Inc.

/**
 * ix-ingest — tool_result_persist hook (synchronous)
 *
 * Fires after Write/Edit/MultiEdit/NotebookEdit. It used to run
 * `ix map <file>`, which Ix rejects ("Map path is not a directory", v0.10.6+),
 * so it never refreshed anything. Post-edit refresh is now the plugin's
 * `after_tool_call` handler (plugins/ix-plugin.ts), which requests the guarded
 * root map (runtime/auto-map.ts): git root only, already-mapped projects only,
 * debounced per root. This hook deliberately does nothing.
 */

const handler = (_event: any) => {
  return;
};

export default handler;
