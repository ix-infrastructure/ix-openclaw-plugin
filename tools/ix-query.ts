// Copyright 2026 Ix Infrastructure Inc.

import {
  formatLookupOutcome,
  lookupFailureMessage,
  lookupRecord,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";
import { LocateReading, readLocate, readLocateTextMatches } from "./cli-records.ts";

export const name = "ix-query";
export const description =
  "Look up a symbol, class, file, or subsystem in the Ix graph. Returns role, connections, and importance from the graph without reading source code.";

export const parameters = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: "Symbol name, file path, or subsystem name to look up",
    },
    kind: {
      type: "string",
      description: "Optional: narrow to a specific kind (function, class, file, module)",
      enum: ["function", "class", "file", "module"],
    },
    path: {
      type: "string",
      description: "Optional: narrow results to a specific directory path",
    },
  },
  required: ["symbol"],
} as const;

interface Params {
  symbol: string;
  kind?: string;
  path?: string;
}

/**
 * The parts of `ix explain --format json` this tool shows, in the shape
 * ix-explain reads: `role` and `importance` are objects, the counts sit
 * under `facts`.
 */
interface ExplainResult {
  role?: { role?: unknown; confidence?: unknown };
  importance?: { level?: unknown };
  facts?: { callerCount?: unknown; calleeCount?: unknown; stale?: unknown };
}

/** ix-query passes `kind` and `path` on to `ix locate`. */
const QUERY_NARROWING = ["path", "kind"] as const;

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  const locateArgs = ["locate", params.symbol, "--format", "json"];
  if (params.kind) locateArgs.push("--kind", params.kind);
  if (params.path) locateArgs.push("--path", params.path);

  let raw: unknown;
  try {
    raw = await runIxJson<unknown>(locateArgs, { cwd: dir });
  } catch (error) {
    return lookupFailureMessage(`ix-query: ${params.symbol}`, error, undefined, QUERY_NARROWING);
  }

  const located = readLocate(raw);
  if (!located) {
    // An older ix reports an ambiguous or unknown target on exit 0.
    const outcome = lookupRecord(JSON.stringify(raw));
    if (outcome) return formatLookupOutcome(`ix-query: ${params.symbol}`, outcome, QUERY_NARROWING);
    // No entity, but locate fell back to a text search and found the name in source.
    const textMatches = readLocateTextMatches(raw);
    if (textMatches.length > 0) return formatTextMatches(params.symbol, textMatches);
    return [
      `## ix-query: ${params.symbol}`,
      "",
      "No matches found in the graph. The symbol may not be indexed yet. Try `ix map` to refresh.",
    ].join("\n");
  }

  let explain: ExplainResult | null = null;
  try {
    explain = await runIxJson<ExplainResult>(["explain", located.target.name, "--format", "json"], { cwd: dir });
  } catch {
    // Show what locate resolved without the explain facts.
  }
  return formatQuery(params.symbol, located, explain);
}

const MAX_TEXT_MATCHES = 10;

function formatTextMatches(symbol: string, matches: string[]): string {
  const lines = [
    `## ix-query: ${symbol}`,
    "",
    `**Not a graph entity.** Ix found ${matches.length} source-text match${matches.length === 1 ? "" : "es"}:`,
  ];
  for (const match of matches.slice(0, MAX_TEXT_MATCHES)) lines.push(`- \`${match}\``);
  if (matches.length > MAX_TEXT_MATCHES) lines.push(`- … ${matches.length - MAX_TEXT_MATCHES} more`);
  lines.push("", "These are text hits, not resolved symbols. If the code is new, run `ix map` to index it.");
  return lines.join("\n");
}

function formatQuery(symbol: string, located: LocateReading, explain: ExplainResult | null): string {
  const { target, line, container, systemPath } = located;
  const lines = [`## ix-query: ${symbol}`, "", `**Name:** \`${target.name}\``];
  if (target.kind) lines.push(`**Kind:** ${target.kind}`);
  if (target.path) lines.push(`**Path:** ${target.path}${line !== undefined ? `:${line}` : ""}`);
  if (container) lines.push(`**Container:** \`${container}\``);
  if (systemPath.length > 0) lines.push(`**Subsystem:** ${systemPath.join(" › ")}`);

  if (!explain) {
    lines.push("", "_explain data unavailable — run `ix map` to refresh graph_");
    return lines.join("\n");
  }
  const role = explain.role?.role;
  if (typeof role === "string" && role) {
    const confidence = explain.role?.confidence;
    lines.push(`**Role:** ${role}${typeof confidence === "string" && confidence ? ` (${confidence} confidence)` : ""}`);
  }
  const importance = explain.importance?.level;
  if (typeof importance === "string" && importance) lines.push(`**Importance:** ${importance}`);
  const callers = explain.facts?.callerCount;
  const callees = explain.facts?.calleeCount;
  if (typeof callers === "number") lines.push(`**Callers:** ${callers}`);
  if (typeof callees === "number") lines.push(`**Callees:** ${callees}`);
  if (explain.facts?.stale === true) lines.push("", "⚠ Data may be stale — run `ix map` to refresh.");
  return lines.join("\n");
}
