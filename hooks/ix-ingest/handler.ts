/**
 * ix-ingest — tool_result_persist hook (synchronous)
 *
 * Fires after Write/Edit/MultiEdit/NotebookEdit. Spawns ix map on the changed
 * file in the background to keep the graph current.
 *
 * Note: tool_result_persist must be synchronous — we fire-and-forget the map.
 */

import {
  ixAvailable,
  runIxDetached,
} from "../ix-utils.js";

const handler = (event: any) => {
  const toolName = event.context?.toolName;
  if (
    toolName !== "Write" &&
    toolName !== "Edit" &&
    toolName !== "MultiEdit" &&
    toolName !== "NotebookEdit"
  ) {
    return;
  }

  const filePath = event.context?.toolInput?.file_path;
  if (!filePath) return;

  if (!ixAvailable()) return;

  // Fire-and-forget — don't block the response
  runIxDetached(["map", filePath]);
};

export default handler;
