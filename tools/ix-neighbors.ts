// Copyright 2026 Ix Infrastructure Inc.

import { formatLookupOutcome, LookupOutcome, lookupOutcome, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { GraphEntity, readDependsTree, readResultList, TreeNode } from "./cli-records.ts";

export const name = "ix-neighbors";
export const description =
  "Get the neighborhood of a symbol: who calls it, what it calls, and what depends on it. Graph-based, no source reads.";

export const parameters = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: "Symbol, class, or file to get neighbors for",
    },
    direction: {
      type: "string",
      description: "Which neighbors to fetch. 'all' fetches callers + callees. Default: all",
      enum: ["callers", "callees", "depends", "imported-by", "all"],
      default: "all",
    },
    limit: {
      type: "number",
      description: "Max results per direction. Default: 15",
      default: 15,
    },
    depth: {
      type: "number",
      description: "Traversal depth for 'depends'. Default: 2, max: 3",
      default: 2,
    },
  },
  required: ["symbol"],
} as const;

interface Params {
  symbol: string;
  direction?: "callers" | "callees" | "depends" | "imported-by" | "all";
  limit?: number;
  depth?: number;
}

const DIRECTIONS: readonly string[] = ["callers", "callees", "depends", "imported-by"];

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const direction = params.direction ?? "all";
  const limit = Math.min(params.limit ?? 15, 30);
  const depth = Math.min(params.depth ?? 2, 3);

  const directions = direction === "all" ? ["callers", "callees"] : DIRECTIONS.includes(direction) ? [direction] : [];
  const sections = [`## ix-neighbors: ${params.symbol}`, ""];
  for (const name of directions) {
    const section = await fetchSection(dir, name, params.symbol, limit, name === "depends" ? depth : undefined);
    // Every direction resolves the same target, so an ambiguous, unknown or
    // unmapped target is one answer for all of them: show it once and stop.
    if (typeof section !== "string") return formatLookupOutcome(`ix-neighbors: ${params.symbol}`, section);
    sections.push(section);
  }

  return sections.join("\n");
}

async function fetchSection(
  dir: string,
  direction: string,
  symbol: string,
  limit: number,
  depth?: number
): Promise<string | LookupOutcome> {
  try {
    const parsed = await runIxJson<unknown>(
      direction === "depends" && depth !== undefined
        ? ["depends", symbol, "--depth", String(depth), "--format", "json"]
        : [direction, symbol, "--limit", String(limit), "--format", "json"],
      { cwd: dir }
    );

    // `ix depends` answers with a tree, the list lookups with `results` rows.
    if (direction === "depends") {
      const tree = readDependsTree(parsed);
      if (tree.length === 0) return `**${direction}:** none\n`;
      const lines = [`**${capitalize(direction)}**${depth !== undefined ? ` (depth ${depth})` : ""}:`];
      renderTree(tree, lines, "", limit);
      return lines.join("\n") + "\n";
    }

    const result = readResultList(parsed);
    const { rows, unresolved } = result;
    if (rows.length === 0 && unresolved === 0) return `**${direction}:** none\n`;
    const shown = rows.slice(0, limit);
    // ix applied --limit already; summary.total is the count before it.
    const listed = rows.length + unresolved;
    const total = Math.max(result.total ?? listed, listed);
    const truncated = result.truncated || total > shown.length + unresolved;
    // With no graph edges ix answers callers from a text search: those rows
    // are source lines that mention the symbol, not resolved callers.
    const textSearch = result.source !== undefined && result.source !== "graph";
    const heading = textSearch
      ? `**${capitalize(direction)}: text matches** (${total}, from a text search, not the graph`
      : `**${capitalize(direction)}** (${total}`;
    const lines = [`${heading}${truncated ? `, showing ${shown.length}` : ""}):`];
    for (const row of shown) lines.push(`- ${textSearch ? `\`${row.name}\`` : formatEntity(row)}`);
    if (unresolved > 0) {
      lines.push(`- ${unresolved} unresolved ${unresolved === 1 ? "reference" : "references"} (no graph entity)`);
    }
    if (truncated) {
      const more = total - shown.length - unresolved;
      lines.push(`- … ${more > 0 ? `${more} more` : "more"} — raise \`limit\` to see them`);
    }
    return lines.join("\n") + "\n";
  } catch (error) {
    const outcome = lookupOutcome(error);
    if (outcome) return outcome;
    return `**${direction}:** unavailable — ${getErrorMessage(error)}\n`;
  }
}

function formatEntity(entity: GraphEntity): string {
  return `\`${entity.name}\`${entity.kind ? ` (${entity.kind})` : ""}${entity.path ? ` — ${entity.path}` : ""}`;
}

/**
 * The tree, indented two spaces a level, at most `budget` entity lines and
 * then one `…`. Returns the budget left; -1 once it ran out.
 */
function renderTree(nodes: TreeNode[], lines: string[], indent: string, budget: number): number {
  for (const node of nodes) {
    if (budget <= 0) {
      if (budget === 0) lines.push(`${indent}- …`);
      return -1;
    }
    lines.push(`${indent}- ${formatEntity(node)}`);
    budget = renderTree(node.children, lines, indent + "  ", budget - 1);
  }
  return budget;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
