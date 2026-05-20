import { callRuntime } from "../runtime/client.ts";
import {
  ixHttpGet,
  ixUnavailableMessage,
  runIx,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";

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

  // Verify the backend is reachable (HTTP first, CLI fallback).
  let backendReachable = false;
  try {
    await ixHttpGet("/v1/health", 5_000);
    backendReachable = true;
  } catch {
    try {
      await runIx(["status"], { cwd: dir, timeoutMs: 5_000 });
      backendReachable = true;
    } catch (error) {
      return ixUnavailableMessage(
        "ix-ingest: status",
        "**ix backend unreachable.** Ensure Ix is installed and running.",
        getErrorMessage(error)
      );
    }
  }

  if (params.refresh) {
    const runtimeResult = await callRuntime(
      "/v2/ingest/map",
      { trigger: "manual", priority: "normal" },
      { dir }
    );

    if (runtimeResult) {
      return [
        "## ix-ingest: graph refresh",
        "",
        "**Status:** Graph update queued (runtime).",
        `**Job:** ${typeof runtimeResult.job_id === "string" ? runtimeResult.job_id : "accepted"}`,
      ].join("\n");
    }

    try {
      const args = params.silent === false ? ["map"] : ["map", "--silent"];
      await runIx(args, { cwd: dir });
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
    const health = await ixHttpGet<any>("/v1/health");
    const stats = await ixHttpGet<any>("/v1/stats");
    const fileNode = (stats.nodes?.byKind ?? []).find((e: any) => e.kind === "file");
    return formatStatus({
      connected: health.status === "ok",
      graphPresent: health.status === "ok",
      fileCount: fileNode?.count,
    });
  } catch {
    try {
      const status = await runIxJson<StatusResult>(["status", "--format", "json"], { cwd: dir });
      return formatStatus(status);
    } catch {
      return probeStatus(dir);
    }
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
      "Ensure ix is connected: `ix connect`",
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
