import { getRuntime } from "../runtime/client.ts";
import { ixHttpGet, runIx, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-health";
export const description =
  "Check whether the ix CLI is installed, the graph is indexed, and the Ix Core Runtime is reachable. Returns a one-line status summary and any issues found.";

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

  // Try HTTP backend first.
  try {
    const health = await ixHttpGet<any>("/v1/health");
    graphPresent = health.status === "ok";
    const stats = await ixHttpGet<any>("/v1/stats");
    const fileNode = (stats.nodes?.byKind ?? []).find((e: any) => e.kind === "file");
    fileCount = fileNode?.count;
  } catch {
    if (!cliVersion) {
      return [
        "## ix-health",
        "",
        "**Status: UNAVAILABLE**",
        "",
        "ix backend unreachable and CLI not found. Ensure Ix is installed:",
        "```",
        "command -v ix",
        "ix connect",
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
  }

  const runtimeReachable = (await getRuntime("/v2/status", { timeoutMs: 2_000 })) !== null;
  const lines = ["## ix-health", ""];

  lines.push(`**Status:** ${graphPresent ? "OK" : "DEGRADED"}`);
  if (cliVersion) lines.push(`**CLI:** ix ${cliVersion} — installed`);
  lines.push(
    `**Graph:** ${graphPresent ? `indexed${typeof fileCount === "number" ? ` (${fileCount} files)` : ""}` : "not indexed — run `ix map`"}`
  );
  if (staleness) lines.push(`**Freshness:** ${staleness}`);
  lines.push(`**Runtime (v2):** ${runtimeReachable ? "reachable" : "not available"}`);

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
