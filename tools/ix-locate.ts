import { ixHttpPost, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-locate";
export const description =
  "Search for a text pattern or keyword across the indexed codebase. Returns ranked file hits with location and snippet. Use when you have a pattern, not an exact symbol name — for exact names use ix-query.";

export const parameters = {
  type: "object",
  properties: {
    pattern: {
      type: "string",
      description: "Text pattern or keyword to search for",
    },
    limit: {
      type: "number",
      description: "Max results to return. Default: 20, max: 100",
      default: 20,
    },
    path: {
      type: "string",
      description: "Optional: restrict search to a directory path prefix",
    },
    language: {
      type: "string",
      description: "Optional: restrict to a specific language (e.g. 'typescript', 'python')",
    },
  },
  required: ["pattern"],
} as const;

interface Params {
  pattern: string;
  limit?: number;
  path?: string;
  language?: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const limit = Math.min(params.limit ?? 20, 100);
  const args = ["text", params.pattern, "--limit", String(limit), "--format", "json"];
  if (params.path) args.push("--path", params.path);
  if (params.language) args.push("--language", params.language);

  let hits: any[];
  try {
    const nodes = await ixHttpPost<any[]>("/v1/search", {
      term: params.pattern,
      limit,
      ...(params.language ? { language: params.language } : {}),
    });
    // Transform API nodes [{id, kind, name, attrs, provenance}] → hits [{path, line_start, language}]
    const raw = Array.isArray(nodes) ? nodes : [];
    hits = raw
      .filter((n: any) => !params.path || (n.provenance?.sourceUri ?? "").includes(params.path))
      .map((n: any) => ({
        path: n.provenance?.sourceUri ?? n.name ?? "",
        line_start: n.attrs?.line_start ?? null,
        language: n.attrs?.language ?? null,
        snippet: null,
      }));
  } catch {
    try {
      const parsed = await runIxJson<any>(args, { cwd: dir });
      hits = Array.isArray(parsed) ? parsed : parsed.hits ?? [];
    } catch (error) {
      return ixUnavailableMessage(`ix-locate: ${params.pattern}`, "**ix unavailable.** Ensure the ix CLI is installed and the graph is indexed.", getErrorMessage(error));
    }
  }

  if (hits.length === 0) {
    return `## ix-locate: ${params.pattern}\n\nNo matches found${params.path ? ` in \`${params.path}\`` : ""}. Try a broader pattern or check that the graph is indexed.`;
  }

  const lines = [
    `## ix-locate: ${params.pattern}`,
    "",
    `**${hits.length} match${hits.length === 1 ? "" : "es"}${params.path ? ` in \`${params.path}\`` : ""}:**`,
    "",
  ];

  for (const hit of hits) {
    lines.push(`**\`${hit.path ?? "?"}${typeof hit.line_start === "number" ? `:${hit.line_start}` : ""}\`**${hit.language ? ` (${hit.language})` : ""}`);
    if (hit.snippet) {
      lines.push("```", String(hit.snippet).trim().slice(0, 300), "```");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
