import { callRuntime } from "../runtime/client.ts";
import {
  ixUnavailableMessage,
  previewMarkdown,
  runIxJson,
  ToolContext,
  toolDirectory,
} from "./base.ts";

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

interface ImpactResult {
  target?: string;
  risk?: string;
  dependentCount?: number;
  transitiveCount?: number;
  atRiskBehaviors?: string[];
  subsystems?: string[];
}

interface CallersResult {
  items?: Array<{ name: string; subsystem?: string; file?: string }>;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  const runtimeResult = await callRuntime(
    "/v2/ix_query",
    {
      query: {
        mode: "impact",
        targets: [{ kind: "path", value: params.target }],
      },
    },
    { dir }
  );
  const runtimeMarkdown = previewMarkdown(runtimeResult);
  if (runtimeMarkdown) return runtimeMarkdown;

  let impact: ImpactResult;
  try {
    impact = await runIxJson<ImpactResult>(["impact", params.target, "--format", "json"], {
      cwd: dir,
    });
  } catch (error) {
    return ixUnavailableMessage(`ix-impact: ${params.target}`, undefined, getErrorMessage(error));
  }

  const risk = (impact.risk ?? "unknown").toLowerCase();
  const dependentCount = impact.dependentCount ?? 0;
  if (risk === "low" && dependentCount < 3) {
    return formatReport({
      target: params.target,
      risk,
      verdict: "SAFE TO PROCEED",
      dependentCount,
      transitiveCount: impact.transitiveCount,
      atRiskBehaviors: impact.atRiskBehaviors,
      callers: [],
      subsystems: impact.subsystems,
    });
  }

  let callers: Array<{ name: string; subsystem?: string; file?: string }> = [];
  try {
    const result = await runIxJson<CallersResult>(
      ["callers", params.target, "--limit", "20", "--format", "json"],
      { cwd: dir }
    );
    callers = result.items ?? [];
  } catch {
    // Non-fatal.
  }

  const verdict =
    risk === "low" ? "SAFE TO PROCEED" : risk === "medium" ? "REVIEW CALLERS FIRST" : "NEEDS CHANGE PLAN";

  return formatReport({
    target: params.target,
    risk,
    verdict,
    dependentCount,
    transitiveCount: impact.transitiveCount,
    atRiskBehaviors: impact.atRiskBehaviors,
    callers,
    subsystems: impact.subsystems,
  });
}

function formatReport(report: {
  target: string;
  risk: string;
  verdict: string;
  dependentCount: number;
  transitiveCount?: number;
  atRiskBehaviors?: string[];
  callers: Array<{ name: string; subsystem?: string; file?: string }>;
  subsystems?: string[];
}): string {
  const lines = [
    `## Impact: ${report.target}`,
    "",
    `**Risk level:** ${report.risk.toUpperCase()}`,
    `**Verdict:** ${report.verdict}`,
    "",
    "**Blast radius:**",
    `- Direct dependents: ${report.dependentCount}`,
  ];

  if (typeof report.transitiveCount === "number") {
    lines.push(`- Transitive (depth 2): ${report.transitiveCount}`);
  }
  if (report.subsystems && report.subsystems.length > 0) {
    lines.push(`- Subsystems affected: ${report.subsystems.join(", ")}`);
  }

  if (report.callers.length > 0) {
    lines.push("", "**Key callers:**");
    for (const caller of report.callers.slice(0, 5)) {
      lines.push(`- \`${caller.name}\`${caller.subsystem ? ` [${caller.subsystem}]` : ""}`);
    }
  }

  if (report.atRiskBehaviors && report.atRiskBehaviors.length > 0) {
    lines.push("", "**At-risk behaviors:**");
    for (const behavior of report.atRiskBehaviors) {
      lines.push(`- ${behavior}`);
    }
  }

  lines.push("", "**Recommended action:**");
  if (report.risk === "low") {
    lines.push("- Safe to proceed. Verify callers after change.");
  } else if (report.risk === "medium") {
    lines.push(
      `- Test ${report.callers.slice(0, 3).map((caller) => `\`${caller.name}\``).join(", ")} after change.`
    );
  } else {
    lines.push("- Run `/ix-plan` before editing. This change needs a sequenced plan.");
  }

  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
