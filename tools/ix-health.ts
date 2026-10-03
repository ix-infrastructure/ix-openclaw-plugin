// Copyright 2026 Ix Infrastructure Inc.

import { runIx, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-health";
export const description =
  "Check whether the ix CLI is installed, and the graph is indexed. Returns a one-line status summary and any issues found.";

export const parameters = {
  type: "object",
  properties: {},
  required: [],
} as const;

interface StatusResult {
  currentRev?: number;
  graphPresent?: boolean;
  fileCount?: number;
  staleFiles?: number;
  staleness?: string;
}

export async function execute(
  _params: Record<string, never>,
  context: ToolContext
): Promise<string> {
  const dir = toolDirectory(context);

  const cliVersion = await getCliVersion(dir);

  let graphPresent = false;
  let fileCount: number | undefined;
  let staleness: string | undefined;

  // Everything goes through the ix CLI, which knows the endpoint, the
  // workspace and (once the backend enforces one) the token. Calling the
  // backend over HTTP from here read every workspace's graph unscoped.
  if (!cliVersion) {
    return [
      "## ix-health",
      "",
      "**Status: UNAVAILABLE**",
      "",
      "ix CLI not found. Ensure Ix is installed and its backend is running:",
      "```",
      "command -v ix",
      "ix status",
      "ix docker start",
      "ix map",
      "```",
    ].join("\n");
  }
  try {
    const status = await runIxJson<StatusResult>(["status", "--format", "json"], { cwd: dir });
    graphPresent = (status.currentRev ?? 0) > 0 || status.graphPresent === true;
    fileCount = status.fileCount;
    staleness = typeof status.staleFiles === "number" && status.staleFiles > 0
      ? `${status.staleFiles} stale files`
      : status.staleness;
  } catch {
    try {
      const parsed = await runIxJson<{ names?: string[]; list?: string[] }>(
        ["subsystems", "--list", "--format", "json"],
        { cwd: dir }
      );
      graphPresent = (parsed.names ?? parsed.list ?? []).length > 0;
    } catch {
      // Report degraded state below.
    }
  }

  const lines = ["## ix-health", ""];

  lines.push(`**Status:** ${graphPresent ? "OK" : "DEGRADED"}`);
  if (cliVersion) lines.push(`**CLI:** ix ${cliVersion} — installed`);
  lines.push(
    `**Graph:** ${graphPresent ? `indexed${typeof fileCount === "number" ? ` (${fileCount} files)` : ""}` : "not indexed — run `ix map`"}`
  );
  if (staleness) lines.push(`**Freshness:** ${staleness}`);

  if (!graphPresent) {
    lines.push("", "**Action needed:** Run `ix map` to build the initial graph before using other tools.");
  }

  return lines.join("\n");
}

async function getCliVersion(dir: string): Promise<string | null> {
  try {
    const raw = await runIx(["--version", "--format", "json"], { cwd: dir });
    try {
      const parsed = JSON.parse(raw.trim()) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      return raw.trim().split(/\s+/)[0] ?? "unknown";
    }
  } catch {
    try {
      const raw = await runIx(["--version"], { cwd: dir });
      return raw.trim().split(/\s+/)[0] ?? "unknown";
    } catch {
      return null;
    }
  }

  return null;
}
