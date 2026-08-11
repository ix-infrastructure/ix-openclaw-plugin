import { ixHttpGet, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-stats";
export const description =
  "Return graph-wide statistics: file count, node and edge counts by kind, and graph health status. Use to verify the graph is indexed and to orient in an unfamiliar codebase.";

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

  // Ahead of the HTTP path deliberately — see runtime/llm.ts. Defers when the
  // records report an empty graph, so the "run `ix map`" line below survives;
  // a substring check, not a parse.
  const fast = await tryLlm(["stats"], dir);
  if (fast && !fast.includes("total=0")) return `## ix-stats\n\n${fast}`;

  let raw: any;
  try {
    raw = await ixHttpGet<any>("/v1/stats");
  } catch {
    try {
      raw = await runIxJson<any>(["stats", "--format", "json"], { cwd: dir });
    } catch (error) {
      return ixUnavailableMessage(
        "ix-stats",
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  const totalNodes = raw.nodes?.total ?? 0;
  const totalEdges = raw.edges?.total ?? 0;
  const fileCount = raw.files ?? countByKind(raw.nodes?.byKind, "file");
  if (totalNodes === 0) {
    return ["## ix-stats", "", "**Graph is empty.** Run `ix map` to index the codebase."].join("\n");
  }

  const lines = [
    "## ix-stats",
    "",
    "**Codebase:**",
    `- Files indexed: ${fileCount}`,
    `- Total nodes: ${totalNodes}`,
    `- Total edges: ${totalEdges}`,
  ];
  if (raw.language) lines.push(`- Primary language: ${raw.language}`);

  if (Array.isArray(raw.nodes?.byKind) && raw.nodes.byKind.length > 0) {
    lines.push("", "**Nodes by kind:**");
    for (const entry of raw.nodes.byKind) {
      if (entry.kind && entry.count > 0) lines.push(`- ${entry.kind}: ${entry.count}`);
    }
  }
  if (Array.isArray(raw.edges?.byPredicate) && raw.edges.byPredicate.length > 0) {
    lines.push("", "**Edges by type:**");
    for (const entry of raw.edges.byPredicate) {
      if (entry.kind && entry.count > 0) lines.push(`- ${entry.kind}: ${entry.count}`);
    }
  }

  return lines.join("\n");
}

function countByKind(byKind: Array<{ kind?: string; count?: number }> | undefined, kind: string): number {
  return byKind?.find((entry) => entry.kind === kind)?.count ?? 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
