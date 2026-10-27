// Copyright 2026 Ix Infrastructure Inc.

import { formatLookupOutcome, LookupOutcome, lookupOutcome, runIxJson, ToolContext, toolDirectory } from "./base.ts";

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
    const parsed = await runIxJson<{ items?: any[]; count?: number }>(
      direction === "depends" && depth !== undefined
        ? ["depends", symbol, "--depth", String(depth), "--format", "json"]
        : [direction, symbol, "--limit", String(limit), "--format", "json"],
      { cwd: dir }
    );
    const items = parsed.items ?? [];
    if (items.length === 0) return `**${direction}:** none\n`;

    const lines = [`**${capitalize(direction)}** (${parsed.count ?? items.length} total, showing ${items.length}):`];
    for (const item of items) {
      const parts = [`\`${item.name ?? "?"}\``];
      if (item.kind) parts.push(`(${item.kind})`);
      if (item.subsystem) parts.push(`[${item.subsystem}]`);
      if (item.file) parts.push(`— ${item.file}`);
      lines.push(`- ${parts.join(" ")}`);
    }

    return lines.join("\n") + "\n";
  } catch (error) {
    const outcome = lookupOutcome(error);
    if (outcome) return outcome;
    return `**${direction}:** unavailable — ${getErrorMessage(error)}\n`;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
