// Copyright 2026 Ix Infrastructure Inc.

/**
 * ix-map — agent_end hook
 *
 * This used to run a bare `ix map` in the host process's cwd after every agent
 * response — whatever directory that happened to be, mapped or not. Automatic
 * maps now go only through the plugin's guarded root map
 * (runtime/auto-map.ts, requested after edits and at session end), so this
 * hook deliberately does nothing.
 */

const handler = (_event: any) => {
  return;
};

export default handler;
