import { ixHttpPost, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-rank";
export const description =
  "Rank symbols by a graph metric (dependents, callers, importers, members) to surface hotspots and high-centrality components. Useful before architecture review or impact planning.";

export const parameters = {
  type: "object",
  properties: {
    by: {
      type: "string",
      description: "Metric to rank by. Default: dependents",
      enum: ["dependents", "callers", "importers", "members"],
      default: "dependents",
    },
    kind: {
      type: "string",
      description: "Symbol kind to rank. Default: class",
      enum: ["class", "function", "file", "interface", "module"],
      default: "class",
    },
    top: {
      type: "number",
      description: "How many results to return. Default: 10, max: 50",
      default: 10,
    },
    path: {
      type: "string",
      description: "Optional: restrict ranking to a directory path prefix",
    },
  },
  required: [],
} as const;

interface Params {
  by?: "dependents" | "callers" | "importers" | "members";
  kind?: "class" | "function" | "file" | "interface" | "module";
  top?: number;
  path?: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const by = params.by ?? "dependents";
  const kind = params.kind ?? "class";
  const top = Math.min(params.top ?? 10, 50);

  const args = ["rank", "--by", by, "--kind", kind, "--top", String(top), "--format", "json"];
  if (params.path) args.push("--path", params.path);

  let raw: any;
  try {
    raw = await rankViaHttp(by, kind, top, params.path);
  } catch {
    try {
      raw = await runIxJson<any>(args, { cwd: dir });
    } catch (error) {
      return ixUnavailableMessage(
        `ix-rank: ${by}/${kind}`,
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  const results = raw.results ?? [];
  if (results.length === 0) {
    return `## ix-rank: ${by}/${kind}\n\nNo results. The graph may be empty — run \`ix map\` to index the codebase.`;
  }

  const lines = [
    `## ix-rank: top ${kind} by ${by}${params.path ? ` in \`${params.path}\`` : ""}`,
    "",
    "| Rank | Symbol | Score | Path |",
    "|------|--------|-------|------|",
  ];

  results.forEach((result: any, index: number) => {
    lines.push(`| ${index + 1} | \`${result.name ?? "?"}\` | ${result.score ?? "—"} | ${result.path ? `\`${result.path}\`` : "—"} |`);
  });

  if (raw.summary?.evaluated) {
    lines.push("", `_Evaluated ${raw.summary.evaluated} total, showing ${results.length}_`);
  }

  return lines.join("\n");
}

const METRIC_CONFIG: Record<string, { direction: "in" | "out"; predicates: string[] }> = {
  dependents: { direction: "in",  predicates: ["CALLS", "IMPORTS", "REFERENCES"] },
  callers:    { direction: "in",  predicates: ["CALLS", "REFERENCES"] },
  importers:  { direction: "in",  predicates: ["IMPORTS"] },
  members:    { direction: "out", predicates: ["CONTAINS"] },
};

async function rankViaHttp(
  by: string,
  kind: string,
  top: number,
  path?: string
): Promise<any> {
  const config = METRIC_CONFIG[by];
  if (!config) throw new Error(`Unknown metric: ${by}`);

  const allNodes = await ixHttpPost<any[]>("/v1/list", { kind, limit: 2000 });
  if (!Array.isArray(allNodes)) throw new Error("Unexpected list response");

  const candidates = path
    ? allNodes.filter((n: any) => (n.provenance?.sourceUri ?? "").includes(path))
    : allNodes;

  if (candidates.length === 0) {
    return { metric: by, kind, results: [], summary: { evaluated: 0, returned: 0 } };
  }

  const BATCH = 20;
  const scored: Array<{ name: string; kind: string; score: number }> = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (node: any) => {
        try {
          const expanded = await ixHttpPost<any>("/v1/expand", {
            nodeId: node.id,
            direction: config.direction,
            predicates: config.predicates,
            hops: 1,
          });
          return { name: node.name ?? "(unnamed)", kind: node.kind ?? kind, score: (expanded.nodes ?? []).length };
        } catch {
          return { name: node.name ?? "(unnamed)", kind: node.kind ?? kind, score: 0 };
        }
      })
    );
    scored.push(...results);
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, top);

  return {
    metric: by,
    kind,
    scope: path,
    results: results.map(r => ({ name: r.name, kind: r.kind, score: r.score })),
    summary: { evaluated: candidates.length, returned: results.length },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
