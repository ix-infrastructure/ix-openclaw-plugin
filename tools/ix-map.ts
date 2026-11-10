// Copyright 2026 Ix Infrastructure Inc.

import { runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { readRegions, readStats, readSubsystemNames, readSubsystemTarget } from "./cli-records.ts";

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
    const parsed = await runIxJson<unknown>(
      scope ? ["subsystems", scope, "--format", "json"] : ["subsystems", "--format", "json"],
      { cwd: dir }
    );
    // A scoped answer carries the scope's regions as `children` and the
    // resolved region as `target`.
    const regions = readRegions(parsed);
    const target = scope ? readSubsystemTarget(parsed) : undefined;
    if (regions.length === 0) {
      if (target) return `**Subsystems in ${target}:** none — it has no sub-regions.`;
      return "**Subsystems:** none found. Run `ix map` to build the graph.";
    }

    const lines = [
      `**Subsystems${target ? ` in ${target}` : ""}** (${regions.length}):`,
      "",
      "| Subsystem | Files | Cohesion | Coupling |",
      "|-----------|-------|----------|----------|",
    ];

    for (const region of regions) {
      const flag =
        (region.cohesion !== undefined && region.cohesion < 0.4) ||
        (region.coupling !== undefined && region.coupling > 0.5)
          ? " ⚠"
          : "";
      lines.push(
        `| ${region.label}${flag} | ${region.files ?? "—"} | ${region.cohesion?.toFixed(2) ?? "—"} | ${region.coupling?.toFixed(2) ?? "—"} |`
      );
    }

    return lines.join("\n");
  } catch (error) {
    return `**Subsystems:** unavailable — ${getErrorMessage(error)}`;
  }
}

async function fetchSubsystemList(dir: string): Promise<string> {
  try {
    const parsed = await runIxJson<unknown>(["subsystems", "--list", "--format", "json"], { cwd: dir });
    const names = readSubsystemNames(parsed);
    return names.length > 0 ? `**Subsystem names:** ${names.join(", ")}` : "";
  } catch {
    return "";
  }
}

async function fetchStats(dir: string): Promise<string> {
  try {
    const stats = readStats(await runIxJson<unknown>(["stats", "--format", "json"], { cwd: dir }));
    const parts: string[] = [];
    if (stats.files !== undefined) parts.push(`${stats.files} files`);
    if (stats.nodes !== undefined) parts.push(`${stats.nodes} nodes`);
    if (stats.edges !== undefined) parts.push(`${stats.edges} edges`);
    return parts.length > 0 ? `**Codebase:** ${parts.join(" · ")}` : "";
  } catch {
    return "";
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
