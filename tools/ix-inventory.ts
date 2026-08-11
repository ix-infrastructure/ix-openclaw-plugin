import { ixHttpPost, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-inventory";
export const description =
  "List all files or symbols within a directory path scope from the graph. Use to explore what's inside a subsystem or directory without reading files.";

export const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Directory path prefix to enumerate (e.g. 'src/auth', 'services/')",
    },
    kind: {
      type: "string",
      description: "What to enumerate. Default: file",
      enum: ["file", "class", "function", "interface", "module"],
      default: "file",
    },
  },
  required: ["path"],
} as const;

interface Params {
  path: string;
  kind?: "file" | "class" | "function" | "interface" | "module";
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const kind = params.kind ?? "file";

  const fast = await tryLlm(["inventory", "--kind", kind, "--path", params.path], dir);
  if (fast) return `## ix-inventory: ${params.path}\n\n${fast}`;

  let raw: any;
  try {
    const nodes = await ixHttpPost<any[]>("/v1/list", { kind, limit: 5000 });
    if (!Array.isArray(nodes)) throw new Error("Unexpected list response");
    const filtered = nodes.filter((n: any) =>
      (n.provenance?.sourceUri ?? "").includes(params.path)
    );
    // Build CLI-compatible {byFile, total, scope} format.
    const byFileMap = new Map<string, string[]>();
    for (const node of filtered) {
      const filePath = node.provenance?.sourceUri ?? "";
      if (kind === "file") {
        if (!byFileMap.has(filePath)) byFileMap.set(filePath, []);
      } else {
        const items = byFileMap.get(filePath) ?? [];
        items.push(node.name ?? "(unnamed)");
        byFileMap.set(filePath, items);
      }
    }
    const byFile = kind === "file"
      ? filtered.map((n: any) => ({ path: n.provenance?.sourceUri ?? n.name }))
      : Array.from(byFileMap.entries()).map(([path, items]) => ({ path, items }));
    raw = { byFile, total: kind === "file" ? filtered.length : filtered.length, scope: params.path };
  } catch {
    try {
      raw = await runIxJson<any>(
        ["inventory", "--kind", kind, "--path", params.path, "--format", "json"],
        { cwd: dir }
      );
    } catch (error) {
      return ixUnavailableMessage(
        `ix-inventory: ${params.path}`,
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  const entries = raw.byFile ?? [];
  const total = raw.total ?? entries.reduce((count: number, entry: any) => count + (entry.items?.length ?? 1), 0);
  if (entries.length === 0) {
    return [`## ix-inventory: ${params.path}`, "", `No ${kind}s found under \`${params.path}\`.`].join("\n");
  }

  const lines = [
    `## ix-inventory: ${params.path}`,
    "",
    `**${total} ${kind}${total === 1 ? "" : "s"}** under \`${raw.scope ?? params.path}\`:`,
    "",
  ];

  if (kind === "file") {
    for (const entry of entries) lines.push(`- \`${entry.path ?? "?"}\``);
  } else {
    for (const entry of entries) {
      if (!Array.isArray(entry.items) || entry.items.length === 0) continue;
      lines.push(`**\`${entry.path ?? "?"}\`**`);
      for (const item of entry.items) {
        lines.push(`  - \`${item}\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
