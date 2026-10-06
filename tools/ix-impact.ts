// Copyright 2026 Ix Infrastructure Inc.

import {
  ixUnavailableMessage,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";
import { ImpactRecord, readImpact } from "./impact-record.ts";

export const name = "ix-impact";
export const description =
  "Analyze the blast radius and change risk for a symbol or file. Returns risk level, direct dependents, key callers, and a go/no-go verdict. Depth scales with risk.";

export const parameters = {
  type: "object",
  properties: {
    target: {
      type: "string",
      description: "Symbol name or file path to assess",
    },
  },
  required: ["target"],
} as const;

interface Params {
  target: string;
}

/**
 * One row of `ix callers <target> --format json` (`results[]`, from
 * formatEdgeResults in ix-cli/src/cli/format.ts). A caller ix could not
 * resolve to a name has none and is skipped.
 */
interface CallerRow {
  name?: string;
  kind?: string;
  path?: string;
}

interface CallersResult {
  results?: CallerRow[];
}

interface Caller {
  name: string;
  path?: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  let record: ImpactRecord;
  try {
    record = await runIxJson<ImpactRecord>(["impact", params.target, "--format", "json"], {
      cwd: dir,
    });
  } catch (error) {
    return ixUnavailableMessage(`ix-impact: ${params.target}`, undefined, getErrorMessage(error));
  }

  const { level: risk, dependents, regions, atRiskBehavior } = readImpact(record);
  const base = {
    target: params.target,
    risk,
    riskSummary: typeof record.riskSummary === "string" ? record.riskSummary : undefined,
    dependents,
    regions,
    atRiskBehavior,
  };
  if (risk === "low" && dependents < 3) {
    return formatReport({ ...base, verdict: "SAFE TO PROCEED", callers: [] });
  }

  let callers: Caller[] = [];
  try {
    const result = await runIxJson<CallersResult>(
      ["callers", params.target, "--limit", "20", "--format", "json"],
      { cwd: dir }
    );
    callers = (Array.isArray(result.results) ? result.results : [])
      .filter((row): row is CallerRow & { name: string } => typeof row?.name === "string" && row.name.length > 0)
      .map((row) => ({ name: row.name, path: typeof row.path === "string" && row.path ? row.path : undefined }));
  } catch {
    // Non-fatal.
  }

  const verdict =
    risk === "low"
      ? "SAFE TO PROCEED"
      : risk === "medium"
        ? "REVIEW CALLERS FIRST"
        : risk === "unknown"
          ? "RISK NOT ASSESSED"
          : "NEEDS CHANGE PLAN";

  return formatReport({ ...base, verdict, callers });
}

function formatReport(report: {
  target: string;
  risk: string;
  riskSummary?: string;
  verdict: string;
  dependents: number;
  regions: string[];
  atRiskBehavior: string[];
  callers: Caller[];
}): string {
  const lines = [
    `## Impact: ${report.target}`,
    "",
    `**Risk level:** ${report.risk.toUpperCase()}`,
    `**Verdict:** ${report.verdict}`,
  ];
  if (report.riskSummary) lines.push(`**Why:** ${report.riskSummary}`);

  lines.push("", "**Blast radius:**", `- Direct dependents: ${report.dependents}`);
  if (report.regions.length > 0) {
    lines.push(`- Subsystems affected: ${report.regions.join(", ")}`);
  }

  if (report.callers.length > 0) {
    lines.push("", "**Key callers:**");
    for (const caller of report.callers.slice(0, 5)) {
      lines.push(`- \`${caller.name}\`${caller.path ? ` (${caller.path})` : ""}`);
    }
  }

  if (report.atRiskBehavior.length > 0) {
    lines.push("", "**At-risk behaviors:**");
    for (const behavior of report.atRiskBehavior) {
      lines.push(`- ${behavior}`);
    }
  }

  lines.push("", "**Recommended action:**");
  if (report.risk === "low") {
    lines.push("- Safe to proceed. Verify callers after change.");
  } else if (report.risk === "medium") {
    lines.push(
      report.callers.length > 0
        ? `- Test ${report.callers.slice(0, 3).map((caller) => `\`${caller.name}\``).join(", ")} after change.`
        : "- Review the direct dependents and test them after change."
    );
  } else if (report.risk === "unknown") {
    lines.push("- Ix withheld the risk level (the graph may be incomplete). Run `ix status`, then `ix map` if needed, and re-check.");
  } else {
    lines.push("- Run `/ix-plan` before editing. This change needs a sequenced plan.");
  }

  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
