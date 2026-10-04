// Copyright 2026 Ix Infrastructure Inc.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";

import { resolveProjectRoot } from "../runtime/auto-map.ts";
import {
  ixUnavailableMessage,
  runIx,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";

// An explicit, agent-requested map of a whole project routinely runs for
// minutes; the 60 s default killed it part-way.
const MAP_TIMEOUT_MS = 10 * 60_000;

export const name = "ix-ingest";
export const description =
  "Check the Ix graph ingestion status. Returns whether the graph is present, how fresh it is, and whether a refresh is recommended. Can optionally trigger a graph rebuild.";

export const parameters = {
  type: "object",
  properties: {
    refresh: {
      type: "boolean",
      description: "If true, trigger a graph refresh via `ix map`. Default: false",
      default: false,
    },
    silent: {
      type: "boolean",
      description: "If refresh is true, run `ix map --silent`. Default: true",
      default: true,
    },
  },
  required: [],
} as const;

interface Params {
  refresh?: boolean;
  silent?: boolean;
}

interface StatusResult {
  connected?: boolean;
  graphPresent?: boolean;
  lastUpdated?: string;
  fileCount?: number;
  staleness?: string;
  recommendation?: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  // Verify the backend is reachable, through the ix CLI: it knows the
  // endpoint, the workspace and (once the backend enforces one) the token.
  try {
    await runIx(["status"], { cwd: dir, timeoutMs: 5_000 });
  } catch (error) {
    return ixUnavailableMessage(
      "ix-ingest: status",
      "**ix backend unreachable.** Ensure Ix is installed and running.",
      getErrorMessage(error)
    );
  }

  if (params.refresh) {
    // Map the project root (git top level), not whatever subdirectory the tool
    // context happens to point at. Outside git, the directory itself.
    const resolved = await resolveProjectRoot(dir);
    const root = "root" in resolved ? resolved.root : dir;
    if (sameDir(root, homedir())) {
      return [
        "## ix-ingest: graph refresh",
        "",
        "**Status:** Refused — the project root is your home directory.",
        "Run `ix map <project dir>` for the project you mean.",
      ].join("\n");
    }
    try {
      const args = params.silent === false ? ["map", root] : ["map", root, "--silent"];
      await runIx(args, { cwd: root, timeoutMs: MAP_TIMEOUT_MS });
      return [
        "## ix-ingest: graph refresh",
        "",
        "**Status:** Graph refresh complete.",
        "The Ix graph has been rebuilt. Graph data is now current.",
      ].join("\n");
    } catch (error) {
      return [
        "## ix-ingest: graph refresh",
        "",
        `**Status:** Refresh failed — ${getErrorMessage(error)}`,
        "",
        "Try running `ix map` manually to diagnose.",
      ].join("\n");
    }
  }

  try {
    const status = await runIxJson<StatusResult>(["status", "--format", "json"], { cwd: dir });
    return formatStatus(status);
  } catch {
    return probeStatus(dir);
  }
}

async function probeStatus(dir: string): Promise<string> {
  try {
    const parsed = await runIxJson<{ names?: string[]; list?: string[] }>(
      ["subsystems", "--list", "--format", "json"],
      { cwd: dir }
    );
    const names = parsed.names ?? parsed.list ?? [];
    if (names.length === 0) {
      return [
        "## ix-ingest: status",
        "",
        "**Status:** Graph is empty — no subsystems found.",
        "",
        "Run `ix map` to build the graph:",
        "```",
        "ix map",
        "```",
      ].join("\n");
    }

    return [
      "## ix-ingest: status",
      "",
      "**Status:** Graph is present.",
      `**Subsystems found:** ${names.length} (${names.slice(0, 5).join(", ")}${names.length > 5 ? "..." : ""})`,
      "",
      "_Detailed freshness data unavailable. Run `ix status` directly for more info._",
    ].join("\n");
  } catch (error) {
    return [
      "## ix-ingest: status",
      "",
      `**Status:** Could not determine graph state — ${getErrorMessage(error)}`,
      "",
      "Check the backend with `ix status`; start it with `ix docker start`.",
    ].join("\n");
  }
}

function formatStatus(status: StatusResult): string {
  const lines = ["## ix-ingest: status", ""];

  if (typeof status.connected === "boolean") {
    lines.push(`**Connected:** ${status.connected ? "yes" : "no ⚠"}`);
  }
  if (typeof status.graphPresent === "boolean") {
    lines.push(`**Graph present:** ${status.graphPresent ? "yes" : "no — run `ix map`"}`);
  }
  if (typeof status.fileCount === "number") {
    lines.push(`**Files indexed:** ${status.fileCount}`);
  }
  if (status.lastUpdated) {
    lines.push(`**Last updated:** ${status.lastUpdated}`);
  }
  if (status.staleness) {
    lines.push(`**Freshness:** ${status.staleness}`);
  }
  if (status.recommendation) {
    lines.push("", `**Recommendation:** ${status.recommendation}`);
  }

  return lines.join("\n");
}

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
