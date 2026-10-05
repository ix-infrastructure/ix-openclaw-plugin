// Copyright 2026 Ix Infrastructure Inc.

import { IxCommandError, ixUnavailableMessage, runIx, ToolContext, toolDirectory } from "./base.ts";

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
  // Why a call produced nothing at all (ix missing, backend down).
  const runErrors: string[] = [];
  const [locateRaw, overviewRaw, statsRaw] = await Promise.all([
    safeRun(["locate", params.target, "--format", "json"], dir, runErrors),
    safeRun(["overview", params.target, "--format", "json"], dir, runErrors),
    depth !== "brief" ? safeRun(["stats", "--format", "json"], dir) : Promise.resolve(null),
  ]);
  // A failed call's stdout can be ix's error record ({"error": ...}); that is
  // a reason, not data, and used to render as an empty context section.
  const failures = [locateRaw, overviewRaw].map(errorRecord).filter((r): r is IxErrorRecord => r !== null);
  const locateOut = errorRecord(locateRaw) ? null : locateRaw;
  const overviewOut = errorRecord(overviewRaw) ? null : overviewRaw;
  const statsOut = errorRecord(statsRaw) ? null : statsRaw;

  if (!locateOut && !overviewOut && failures.length > 0) {
    const first = failures[0];
    return [
      `## ix-docs-tool: ${params.target}`,
      "",
      `**ix could not answer:** \`${first.error}\`${first.message ? ` — ${first.message}` : ""}`,
      "",
      "Try: `ix status`, then `ix map` if the project is not indexed.",
    ].join("\n");
  }

  // Both calls failed without a record: ix is missing or cannot reach its
  // backend. That is not "not found in graph".
  if (!locateOut && !overviewOut && runErrors.length > 0) {
    return ixUnavailableMessage(
      `ix-docs-tool: ${params.target}`,
      "**ix unavailable.** Ensure the ix CLI is installed and its backend is running (`ix status`).",
      runErrors[0]
    );
  }

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

/**
 * Run an `ix` command, keeping stdout even when it exits non-zero.
 *
 * `runIx` rejects on a non-zero exit, and this used to discard everything with
 * it. Several `ix` commands exit 1 to signal "asked for something that does not
 * exist" while still printing a useful JSON body, and `locate` is about to join
 * them (Ix#539) -- without this the diagnostics vanish and the tool falls back
 * to a generic "Not found in graph", losing the guidance ix supplied.
 *
 * A failure with no output still maps to null, so the ix-unavailable path is
 * unchanged.
 */
interface IxErrorRecord {
  error: string;
  message?: string;
}

/** The error record in an ix JSON answer, or null when it is data (or not JSON). */
function errorRecord(out: string | null): IxErrorRecord | null {
  if (!out) return null;
  try {
    const parsed = JSON.parse(out) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as IxErrorRecord).error === "string") {
      return parsed as IxErrorRecord;
    }
  } catch {
    // Not JSON: not an error record.
  }
  return null;
}

async function safeRun(args: string[], dir: string, errors?: string[]): Promise<string | null> {
  try {
    return await runIx(args, { cwd: dir });
  } catch (error: unknown) {
    const stdout = error instanceof IxCommandError ? error.stdout : "";
    if (stdout.trim()) return stdout;
    errors?.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}
