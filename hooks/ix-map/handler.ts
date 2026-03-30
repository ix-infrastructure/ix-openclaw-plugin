/**
 * ix-map — agent_end hook
 *
 * Fires after the agent finishes a response. Runs ix map asynchronously
 * to refresh the full graph for the next session.
 */

import { ixAvailable, runIxDetached } from "../ix-utils.js";

const handler = (event: any) => {
  if (event.type !== "agent" && event.action !== "end") {
    // Also accept the combined event type
    if (event.type !== "lifecycle" || event.action !== "agent_end") return;
  }

  if (!ixAvailable()) return;

  // Fire-and-forget
  runIxDetached(["map"]);
};

export default handler;
