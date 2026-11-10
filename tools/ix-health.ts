// Copyright 2026 Ix Infrastructure Inc.

import { runIx, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { graphIngested, readStatus, readSubsystemNames, StatusReading } from "./cli-records.ts";

export const name = "ix-health";
export const description =
  "Check whether the ix CLI is installed, and the graph is indexed. Returns a one-line status summary and any issues found.";

export const parameters = {
  type: "object",
  properties: {},
  required: [],
} as const;

export async function execute(
  _params: Record<string, never>,
  context: ToolContext
): Promise<string> {
  const dir = toolDirectory(context);

  const cliVersion = await getCliVersion(dir);

  let graphPresent = false;
  let status: StatusReading = {};

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
    status = readStatus(await runIxJson<unknown>(["status", "--format", "json"], { cwd: dir }));
    graphPresent = graphIngested(status);
  } catch {
    try {
      const parsed = await runIxJson<unknown>(["subsystems", "--list", "--format", "json"], { cwd: dir });
      graphPresent = readSubsystemNames(parsed).length > 0;
    } catch {
      // Report degraded state below.
    }
  }

  const lines = ["## ix-health", ""];

  lines.push(`**Status:** ${graphPresent ? "OK" : "DEGRADED"}`);
  if (cliVersion) lines.push(`**CLI:** ix ${cliVersion} — installed`);
  lines.push(
    `**Graph:** ${graphPresent ? `indexed${status.currentRev !== undefined ? ` (rev ${status.currentRev})` : ""}` : "not indexed — run `ix map`"}`
  );
  if (status.staleFiles !== undefined && status.staleFiles > 0) {
    lines.push(`**Freshness:** ${status.staleFiles} stale file${status.staleFiles === 1 ? "" : "s"}`);
  }
  if (status.lastIngestAt) lines.push(`**Last ingest:** ${status.lastIngestAt}`);

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
