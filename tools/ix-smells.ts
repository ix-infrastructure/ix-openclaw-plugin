import { ixHttpGet, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-smells";
export const description =
  "Detect code quality and architecture smells across the graph: orphan files, high coupling, low cohesion, dead code, and other structural issues. Use during architecture review or before a large refactor.";

export const parameters = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Optional: restrict smell detection to a directory path prefix",
    },
    limit: {
      type: "number",
      description: "Max results to return. Default: 50, max: 200",
      default: 50,
    },
  },
  required: [],
} as const;

interface Params {
  path?: string;
  limit?: number;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const llmArgs = ["smells"];
  if (params.path) llmArgs.push("--path", params.path);
  const fast = await tryLlm(llmArgs, dir);
  if (fast) return `## ix-smells\n\n${fast}`;

  const args = ["smells", "--format", "json"];
  if (params.path) args.push("--path", params.path);

  let raw: any;
  try {
    const apiRaw = await ixHttpGet<any>("/v1/smells");
    // Transform API format {smells: [{entity_id, smell, value}]} →
    // CLI format {candidates: [{smell, file, confidence, signals}], count}
    const smells: any[] = apiRaw.smells ?? [];
    const candidates = smells.map((s: any) => ({
      smell: (s.smell ?? "unknown").replace(/^has_smell\./, ""),
      file: s.value?.file ?? "",
      confidence: s.value?.confidence ?? 0,
      signals: s.value?.signals ?? {},
    }));
    raw = { candidates, count: candidates.length };
  } catch {
    try {
      raw = await runIxJson<any>(args, { cwd: dir });
    } catch (error) {
      return ixUnavailableMessage(
        "ix-smells",
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  const allCandidates = raw.candidates ?? [];
  const total = raw.count ?? allCandidates.length;
  const candidates = allCandidates.slice(0, Math.min(params.limit ?? 50, 200));

  if (candidates.length === 0) {
    return `## ix-smells\n\nNo code smells detected${params.path ? ` in \`${params.path}\`` : ""}. Architecture looks clean.`;
  }

  const lines = [
    "## ix-smells",
    "",
    `**${total} smell${total === 1 ? "" : "s"} detected${params.path ? ` in \`${params.path}\`` : ""}**${candidates.length < total ? ` (showing ${candidates.length} of ${total})` : ""}`,
    "",
  ];

  const bySmell = new Map<string, any[]>();
  for (const candidate of candidates) {
    const smell = candidate.smell ?? "unknown";
    const items = bySmell.get(smell) ?? [];
    items.push(candidate);
    bySmell.set(smell, items);
  }

  for (const [smell, items] of bySmell) {
    lines.push(`### ${smell} (${items.length})`);
    for (const item of items.slice(0, 10)) {
      lines.push(`- \`${item.file ?? "?"}\`${typeof item.confidence === "number" ? ` — confidence: ${item.confidence.toFixed(2)}` : ""}`);
      if (item.signals && Object.keys(item.signals).length > 0) {
        const signalStr = Object.entries(item.signals)
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        lines.push(`  _signals: ${signalStr}_`);
      }
    }
    if (items.length > 10) lines.push(`  _...and ${items.length - 10} more_`);
    lines.push("");
  }
  if (raw.run_at) lines.push(`_Analysis run at: ${raw.run_at}_`);
  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
