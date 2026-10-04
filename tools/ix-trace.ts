// Copyright 2026 Ix Infrastructure Inc.

import { ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-trace";
export const description =
  "Trace execution paths through a symbol — upstream callers and downstream callees. Use to understand the full call chain, not just immediate neighbors. Optionally trace to a specific target symbol.";

export const parameters = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: "Symbol to trace execution paths for",
    },
    to: {
      type: "string",
      description: "Optional: trace only paths from `symbol` to this specific target",
    },
  },
  required: ["symbol"],
} as const;

interface Params {
  symbol: string;
  to?: string;
}

interface TraceNode {
  name?: string;
  kind?: string;
  path?: string;
  cycle?: boolean;
  children?: TraceNode[];
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const llmArgs = ["trace", params.symbol];
  if (params.to) llmArgs.push("--to", params.to);
  const fast = await tryLlm(llmArgs, dir);
  if (fast) return `## ix-trace: ${params.symbol}\n\n${fast}`;

  const args = ["trace", params.symbol, "--format", "json"];
  if (params.to) args.push("--to", params.to);

  let raw: any;
  try {
    raw = await runIxJson<any>(args, { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage(
      `ix-trace: ${params.symbol}`,
      "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
      getErrorMessage(error)
    );
  }

  const upstream = raw.upstream ?? {};
  const downstream = raw.downstream ?? {};
  const upNodes = upstream.summary?.nodes_visited ?? 0;
  const downNodes = downstream.summary?.nodes_visited ?? 0;
  if (upNodes === 0 && downNodes === 0) {
    return [`## ix-trace: ${params.symbol}`, "", "No trace paths found. The symbol may be a root entry point or not indexed."].join("\n");
  }

  const lines = [`## ix-trace: ${params.symbol}`, ""];
  if (raw.target?.kind) lines.push(`**Kind:** ${raw.target.kind}`);
  if (raw.target?.path) lines.push(`**Path:** \`${raw.target.path}\``);
  if (raw.target) lines.push("");
  if (params.to) lines.push(`**Tracing path to:** \`${params.to}\``, "");

  if (upNodes > 0) {
    lines.push(`**Upstream** (${upNodes} node${upNodes === 1 ? "" : "s"}, depth ${upstream.summary?.max_depth ?? "?"}):`);
    renderTree(upstream.tree ?? [], lines, "  ");
    lines.push("");
  }
  if (downNodes > 0) {
    lines.push(`**Downstream** (${downNodes} node${downNodes === 1 ? "" : "s"}, depth ${downstream.summary?.max_depth ?? "?"}):`);
    renderTree(downstream.tree ?? [], lines, "  ");
  }

  return lines.join("\n");
}

function renderTree(nodes: TraceNode[], lines: string[], indent: string, depth = 0): void {
  if (depth > 4) {
    lines.push(`${indent}... (truncated)`);
    return;
  }
  for (const node of nodes.slice(0, 10)) {
    lines.push(`${indent}- \`${node.name ?? "?"}\`${node.kind ? ` (${node.kind})` : ""}${node.cycle ? " ↺ (cycle)" : ""}`);
    if (Array.isArray(node.children) && node.children.length > 0) {
      renderTree(node.children, lines, indent + "  ", depth + 1);
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
