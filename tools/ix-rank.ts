// Copyright 2026 Ix Infrastructure Inc.

import { ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

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

  const llmArgs = ["rank", "--by", by, "--kind", kind, "--top", String(top)];
  if (params.path) llmArgs.push("--path", params.path);
  const fast = await tryLlm(llmArgs, dir);
  if (fast) return `## ix-rank: ${by}/${kind}\n\n${fast}`;

  const args = ["rank", "--by", by, "--kind", kind, "--top", String(top), "--format", "json"];
  if (params.path) args.push("--path", params.path);

  let raw: any;
  try {
    raw = await runIxJson<any>(args, { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage(
      `ix-rank: ${by}/${kind}`,
      "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
      getErrorMessage(error)
    );
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
