// Copyright 2026 Ix Infrastructure Inc.

/**
 * OpenClaw's own file-writing tools, and the files a call to one touches.
 *
 * Grounded in openclaw 2026.8.2 (node_modules/openclaw/dist):
 *
 *  - Core tool ids are lowercase: `edit`, `read`, `write`, `apply_patch`,
 *    `exec` (core-tool-factory-descriptors-DVnZG0uk.js:6-29). The tool-hook matcher
 *    rejects the Claude Code spellings `Write`, `Edit` and `bash` as
 *    non-canonical (hook-runner-global-ac8FBwry.js:23-30), and there is no
 *    `MultiEdit` or `NotebookEdit`.
 *  - `edit` and `write` take the file as `path`, relative to the agent
 *    workspace or absolute (sessions-CQip-Rlp.js:5973 and :7673).
 *  - `apply_patch` takes one `input` string in the `*** Begin Patch` envelope
 *    (core-coding-tools-Dm2UQvOI.js:515). Its file headers are `*** Add File: `,
 *    `*** Delete File: `, `*** Update File: ` and `*** Move to: `; the walk
 *    below mirrors the host's own extractApplyPatchTargets
 *    (apply-patch-paths-CdNP-nNi.js:5-74), which is not exported from the plugin SDK.
 *  - `before_tool_call` may also carry host-resolved `derivedPaths`, today only
 *    for `apply_patch` (agent-tools.before-tool-call-DNsfw1Z7.js:1182-1186);
 *    `after_tool_call` never does (PluginHookAfterToolCallEvent).
 */

/** The core tools that write files, as canonical OpenClaw tool ids. */
export const WRITE_TOOL_NAMES = ["apply_patch", "edit", "write"] as const;

export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

const WRITE_TOOLS: ReadonlySet<string> = new Set(WRITE_TOOL_NAMES);

export function isWriteTool(toolName: unknown): toolName is WriteToolName {
  return typeof toolName === "string" && WRITE_TOOLS.has(toolName);
}

const ADD_FILE = "*** Add File: ";
const DELETE_FILE = "*** Delete File: ";
const UPDATE_FILE = "*** Update File: ";
const MOVE_TO = "*** Move to: ";

function markerPath(line: string | undefined, marker: string): string | undefined {
  if (line === undefined) return undefined;
  const header = line.trimStart();
  if (!header.startsWith("***")) return undefined;
  const trimmed = header.trimEnd();
  return trimmed.startsWith(marker) ? trimmed.slice(marker.length) : undefined;
}

/**
 * Every file an `apply_patch` envelope names (added, deleted, updated, and
 * move destinations), in order, without duplicates. Paths are returned as
 * written, usually relative to the agent workspace. Same walk as the host's
 * extractApplyPatchTargets: an added file's `+` body and an updated file's
 * hunk lines are skipped, so a body line that looks like a header is not read
 * as one.
 */
export function applyPatchPaths(input: unknown): string[] {
  if (typeof input !== "string" || !input) return [];
  const lines = input.split(/\r?\n/);
  const paths: string[] = [];
  const add = (target: string) => {
    if (target && !paths.includes(target)) paths.push(target);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const added = markerPath(lines[index], ADD_FILE);
    if (added !== undefined) {
      add(added);
      while (index + 1 < lines.length && lines[index + 1].startsWith("+")) index += 1;
      continue;
    }

    const deleted = markerPath(lines[index], DELETE_FILE);
    if (deleted !== undefined) {
      add(deleted);
      continue;
    }

    const updated = markerPath(lines[index], UPDATE_FILE);
    if (updated === undefined) continue;
    add(updated);

    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    const moved = markerPath(lines[next], MOVE_TO);
    if (moved !== undefined) {
      add(moved);
      next += 1;
    }
    while (next < lines.length && !lines[next].startsWith("***")) next += 1;
    index = next - 1;
  }
  return paths;
}

/**
 * The files a write-tool call touches, as the host passed them. Prefers the
 * host's `derivedPaths` when present; otherwise reads the tool's own params.
 */
export function writeToolPaths(
  toolName: unknown,
  params: unknown,
  derivedPaths?: readonly unknown[]
): string[] {
  if (!isWriteTool(toolName)) return [];

  const derived = (derivedPaths ?? []).filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  if (derived.length > 0) return [...new Set(derived)];

  const record = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  if (toolName === "apply_patch") return applyPatchPaths(record.input);

  const target = record.path;
  return typeof target === "string" && target.trim() ? [target] : [];
}
