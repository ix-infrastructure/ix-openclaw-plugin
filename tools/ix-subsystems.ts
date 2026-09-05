import { ixHttpGet, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-subsystems";
export const description =
  "List all graph-derived subsystems with file counts, hierarchy levels, confidence signals, and interface counts. Use for top-level architectural orientation before deeper exploration.";

export const parameters = {
  type: "object",
  properties: {},
  required: [],
} as const;

export async function execute(
  _params: Record<string, never>,
  context: ToolContext
): Promise<string> {
  const dir = toolDirectory(context);

  const fast = await tryLlm(["subsystems"], dir);
  if (fast) return `## ix-subsystems\n\n${fast}`;

  let raw: any;
  try {
    raw = await ixHttpGet<any>("/v1/subsystems/map");
    // Normalize API field names to match CLI --format json output.
    if (Array.isArray(raw.regions)) {
      raw.regions = raw.regions.map((r: any) => ({
        ...r,
        files: r.files ?? r.file_count,
        children: r.children ?? r.child_region_count,
        interfaces: r.interfaces ?? r.interface_node_count,
      }));
    }
  } catch {
    try {
      raw = await runIxJson<any>(["subsystems", "--format", "json"], { cwd: dir });
    } catch (error) {
      return ixUnavailableMessage(
        "ix-subsystems",
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  const regions = raw.regions ?? [];
  if (regions.length === 0) {
    return ["## ix-subsystems", "", "**No subsystems found.** Run `ix map` to build the graph."].join("\n");
  }

  const lines = [
    "## ix-subsystems",
    "",
    `**${regions.length} subsystem${regions.length === 1 ? "" : "s"}** — ${raw.file_count ?? "?"} files, ${raw.levels ?? "?"} level${raw.levels === 1 ? "" : "s"}`,
    "",
    "| Subsystem | Kind | Level | Files | Children | Interfaces | Confidence |",
    "|-----------|------|-------|-------|----------|------------|------------|",
  ];

  for (const region of regions) {
    lines.push(
      `| ${region.label ?? "unknown"} | ${region.label_kind ?? "—"} | ${region.level ?? "—"} | ${region.files ?? "—"} | ${region.children ?? 0} | ${region.interfaces ?? 0} | ${typeof region.confidence === "number" ? region.confidence.toFixed(2) : "—"} |`
    );
  }
  if (raw.outcome) lines.push("", `_Outcome: ${raw.outcome}_`);
  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
