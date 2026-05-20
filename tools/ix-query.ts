import { callRuntime } from "../runtime/client.ts";
import {
  ixUnavailableMessage,
  previewMarkdown,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";

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

interface LocateResult {
  results?: Array<{ name: string; kind: string; file: string }>;
}

interface ExplainResult {
  name?: string;
  kind?: string;
  file?: string;
  role?: string;
  importance?: string;
  callerCount?: number;
  calleeCount?: number;
  confidence?: number;
  subsystem?: string;
  summary?: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  const runtimeResult = await callRuntime(
    "/v2/ix_query",
    {
      query: {
        mode: "investigate",
        targets: [{ kind: "symbol", value: params.symbol }],
        constraints: { max_raw_reads: 1 },
      },
    },
    { dir }
  );

  const runtimeMarkdown = previewMarkdown(runtimeResult);
  if (runtimeMarkdown) return runtimeMarkdown;

  const locateArgs = ["locate", params.symbol, "--format", "json"];
  if (params.kind) locateArgs.push("--kind", params.kind);
  if (params.path) locateArgs.push("--path", params.path);

  let locate: LocateResult;
  try {
    locate = await runIxJson<LocateResult>(locateArgs, { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage(`ix-query: ${params.symbol}`, undefined, getErrorMessage(error));
  }

  const results = locate.results ?? [];
  if (results.length === 0) {
    return [
      `## ix-query: ${params.symbol}`,
      "",
      "No matches found in the graph. The symbol may not be indexed yet. Try `ix map` to refresh.",
    ].join("\n");
  }

  try {
    const explain = await runIxJson<ExplainResult>(
      ["explain", results[0].name, "--format", "json"],
      { cwd: dir }
    );
    return formatQuery(params.symbol, results, explain);
  } catch {
    return formatLocateOnly(params.symbol, results);
  }
}

function formatLocateOnly(
  symbol: string,
  results: Array<{ name: string; kind: string; file: string }>
): string {
  const lines = [`## ix-query: ${symbol}`, "", "**Matches found:**"];
  for (const result of results.slice(0, 5)) {
    lines.push(`- \`${result.name}\` (${result.kind}) — ${result.file}`);
  }
  lines.push("", "_explain data unavailable — run `ix map` to refresh graph_");
  return lines.join("\n");
}

function formatQuery(
  symbol: string,
  results: Array<{ name: string; kind: string; file: string }>,
  explain: ExplainResult
): string {
  const primary = results[0];
  const confidence = explain.confidence ?? 1;
  const lines = [
    `## ix-query: ${symbol}`,
    "",
    `**Name:** \`${explain.name ?? primary.name}\``,
    `**Kind:** ${explain.kind ?? primary.kind}`,
    `**File:** ${explain.file ?? primary.file}`,
  ];

  if (explain.subsystem) lines.push(`**Subsystem:** ${explain.subsystem}`);
  if (explain.role) lines.push(`**Role:** ${explain.role}`);
  if (explain.importance) lines.push(`**Importance:** ${explain.importance}`);
  if (typeof explain.callerCount === "number") lines.push(`**Callers:** ${explain.callerCount}`);
  if (typeof explain.calleeCount === "number") lines.push(`**Callees:** ${explain.calleeCount}`);
  if (explain.summary) lines.push("", explain.summary);
  if (confidence < 0.7) {
    lines.push("", "⚠ [uncertain — confidence < 0.7, run `ix map` to refresh]");
  }
  if (results.length > 1) {
    lines.push("", `_${results.length - 1} other match(es) — use --kind or --path to narrow_`);
  }

  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
