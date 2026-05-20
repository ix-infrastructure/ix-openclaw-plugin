import { callRuntime } from "../runtime/client.ts";
import { previewMarkdown, runIx, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-docs-tool";
export const description =
  "Get a condensed architectural context summary for a symbol, subsystem, or file. Returns role, structure, key components, and risk notes. Use to inject graph context before making changes.";

export const parameters = {
  type: "object",
  properties: {
    target: {
      type: "string",
      description: "Symbol name, file path, or subsystem name to summarize",
    },
    depth: {
      type: "string",
      description: "How much detail to fetch. Default: standard",
      enum: ["brief", "standard", "full"],
      default: "standard",
    },
  },
  required: ["target"],
} as const;

interface Params {
  target: string;
  depth?: "brief" | "standard" | "full";
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const depth = params.depth ?? "standard";
  const runtimeResult = await callRuntime(
    "/v2/ix_query",
    {
      query: {
        mode: "docs",
        depth: { brief: "shallow", standard: "medium", full: "deep" }[depth],
        targets: [{ kind: "path", value: params.target }],
      },
    },
    { dir }
  );
  const runtimeMarkdown = previewMarkdown(runtimeResult);
  if (runtimeMarkdown) return runtimeMarkdown;

  const [locateOut, overviewOut, statsOut] = await Promise.all([
    safeRun(["locate", params.target, "--format", "json"], dir),
    safeRun(["overview", params.target, "--format", "json"], dir),
    depth !== "brief" ? safeRun(["stats", "--format", "json"], dir) : Promise.resolve(null),
  ]);

  if (!locateOut && !overviewOut) {
    return [
      `## ix-docs-tool: ${params.target}`,
      "",
      "**Not found in graph.** The target may not be indexed.",
      "",
      "Try: `ix map` to refresh, or `ix locate` to check the exact name.",
    ].join("\n");
  }

  const sections = [`## Context: ${params.target}`, ""];
  if (statsOut) {
    try {
      const stats = JSON.parse(statsOut) as any;
      const parts: string[] = [];
      if (stats.files) parts.push(`${stats.files} files`);
      if (stats.nodes) parts.push(`${stats.nodes} nodes`);
      if (stats.language) parts.push(stats.language);
      if (parts.length > 0) sections.push(`_${parts.join(" · ")}_`, "");
    } catch {
      // Ignore stats parse failures.
    }
  }

  if (overviewOut) {
    try {
      const overview = JSON.parse(overviewOut) as any;
      sections.push(formatOverview(overview));
    } catch {
      // Ignore overview parse failures.
    }
  }

  if (depth === "brief") return sections.join("\n");

  let components: string[] = [];
  if (overviewOut) {
    try {
      const overview = JSON.parse(overviewOut) as any;
      const members = overview.members ?? overview.components ?? [];
      components = members
        .slice(0, depth === "full" ? 8 : 5)
        .map((member: { name?: string }) => member.name ?? "")
        .filter(Boolean);
    } catch {
      // Ignore component expansion failures.
    }
  }

  if (components.length > 0) {
    const explains = await Promise.all(
      components.map((component) => safeRun(["explain", component, "--format", "json"], dir))
    );
    const componentLines = ["**Key Components:**", ""];
    for (let index = 0; index < components.length; index += 1) {
      const explain = explains[index];
      if (!explain) continue;
      try {
        const parsed = JSON.parse(explain) as any;
        componentLines.push(
          `- \`${components[index]}\`${typeof parsed.callerCount === "number" ? ` (${parsed.callerCount} callers)` : ""}${parsed.role ? ` — ${parsed.role}` : ""}`
        );
      } catch {
        componentLines.push(`- \`${components[index]}\``);
      }
    }
    sections.push(componentLines.join("\n"), "");
  }

  if (depth === "full") {
    const impactOut = await safeRun(["impact", params.target, "--format", "json"], dir);
    if (impactOut) {
      try {
        const impact = JSON.parse(impactOut) as any;
        sections.push(
          `**Change risk:** ${(impact.risk ?? "unknown").toUpperCase()} (${impact.dependentCount ?? 0} direct dependents)`,
          ""
        );
      } catch {
        // Ignore impact parse failures.
      }
    }
  }

  return sections.join("\n");
}

function formatOverview(overview: any): string {
  const lines: string[] = [];
  if (overview.kind) lines.push(`**Kind:** ${overview.kind}`);
  if (overview.path) lines.push(`**Path:** ${overview.path}`);
  if (overview.subsystem) lines.push(`**Subsystem:** ${overview.subsystem}`);
  if (typeof overview.fileCount === "number") lines.push(`**Files:** ${overview.fileCount}`);
  if (typeof overview.memberCount === "number") lines.push(`**Members:** ${overview.memberCount}`);
  const summary = overview.summary ?? overview.purpose;
  if (summary) lines.push("", summary);
  return lines.join("\n") + "\n";
}

async function safeRun(args: string[], dir: string): Promise<string | null> {
  try {
    return await runIx(args, { cwd: dir });
  } catch {
    return null;
  }
}
