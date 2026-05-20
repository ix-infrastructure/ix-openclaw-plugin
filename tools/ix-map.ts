import { callRuntime } from "../runtime/client.ts";
import { previewMarkdown, runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-map";
export const description =
  "Get the architectural map of the codebase: all subsystems, their cohesion/coupling scores, and top components. Use for orientation before deeper exploration.";

export const parameters = {
  type: "object",
  properties: {
    scope: {
      type: "string",
      description: "Optional: scope to a specific subsystem name or path prefix",
    },
    include_stats: {
      type: "boolean",
      description: "Include codebase stats (file count, nodes, edges). Default: true",
      default: true,
    },
  },
  required: [],
} as const;

interface Params {
  scope?: string;
  include_stats?: boolean;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const runtimeResult = await callRuntime(
    "/v2/ix_query",
    {
      query: {
        mode: "understand",
        depth: "shallow",
        targets: params.scope ? [{ kind: "path", value: params.scope }] : [],
      },
    },
    { dir }
  );
  const runtimeMarkdown = previewMarkdown(runtimeResult);
  if (runtimeMarkdown) return runtimeMarkdown;

  const includeStats = params.include_stats !== false;
  const [subsystems, subsystemList, stats] = await Promise.all([
    fetchSubsystems(dir, params.scope),
    fetchSubsystemList(dir),
    includeStats ? fetchStats(dir) : Promise.resolve(""),
  ]);

  const sections = [`## ix-map${params.scope ? `: ${params.scope}` : ""}`, ""];
  if (stats) sections.push(stats, "");
  sections.push(subsystems);
  if (subsystemList) sections.push("", subsystemList);
  return sections.join("\n");
}

async function fetchSubsystems(dir: string, scope?: string): Promise<string> {
  try {
    const parsed = await runIxJson<any>(
      scope ? ["subsystems", scope, "--format", "json"] : ["subsystems", "--format", "json"],
      { cwd: dir }
    );
    const systems = parsed.systems ?? parsed.regions ?? parsed.subsystems ?? [];
    if (!Array.isArray(systems) || systems.length === 0) {
      return "**Subsystems:** none found. Run `ix map` to build the graph.";
    }

    const lines = [
      `**Subsystems** (${systems.length}):`,
      "",
      "| Subsystem | Path | Files | Cohesion | Coupling |",
      "|-----------|------|-------|----------|----------|",
    ];

    for (const system of systems) {
      const cohesion = typeof system.cohesion === "number" ? system.cohesion.toFixed(2) : "—";
      const coupling =
        typeof system.externalCoupling === "number" ? system.externalCoupling.toFixed(2) : "—";
      const flag =
        (typeof system.cohesion === "number" && system.cohesion < 0.4) ||
        (typeof system.externalCoupling === "number" && system.externalCoupling > 0.5)
          ? " ⚠"
          : "";
      lines.push(
        `| ${system.name ?? "unknown"}${flag} | ${system.path ?? "—"} | ${system.fileCount ?? "—"} | ${cohesion} | ${coupling} |`
      );
    }

    return lines.join("\n");
  } catch (error) {
    return `**Subsystems:** unavailable — ${getErrorMessage(error)}`;
  }
}

async function fetchSubsystemList(dir: string): Promise<string> {
  try {
    const parsed = await runIxJson<{ names?: string[]; list?: string[] }>(
      ["subsystems", "--list", "--format", "json"],
      { cwd: dir }
    );
    const names = parsed.names ?? parsed.list ?? [];
    return names.length > 0 ? `**Subsystem names:** ${names.join(", ")}` : "";
  } catch {
    return "";
  }
}

async function fetchStats(dir: string): Promise<string> {
  try {
    const parsed = await runIxJson<any>(["stats", "--format", "json"], { cwd: dir });
    const parts: string[] = [];
    if (parsed.files !== undefined) parts.push(`${parsed.files} files`);
    if (parsed.nodes !== undefined) parts.push(`${parsed.nodes} nodes`);
    if (parsed.edges !== undefined) parts.push(`${parsed.edges} edges`);
    if (parsed.language) parts.push(`language: ${parsed.language}`);
    return parts.length > 0 ? `**Codebase:** ${parts.join(" · ")}` : "";
  } catch {
    return "";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
