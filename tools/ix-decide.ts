// Copyright 2026 Ix Infrastructure Inc.

import { runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-decide";
export const description =
  "Get a policy verdict before editing files. Returns ALLOW, REVIEW, or BLOCK with required actions and blast radius evidence. Used by the pre-edit hook and by ix-plan for high-risk changes.";

export const parameters = {
  type: "object",
  properties: {
    touched_paths: {
      type: "array",
      items: { type: "string" },
      description: "File paths that will be edited",
    },
    intent: {
      type: "string",
      description: "What kind of change: edit, refactor, delete, or add. Default: edit",
      enum: ["edit", "refactor", "delete", "add"],
      default: "edit",
    },
    risk_tolerance: {
      type: "string",
      description: "Risk tolerance for the verdict. Default: medium",
      enum: ["low", "medium", "high"],
      default: "medium",
    },
  },
  required: ["touched_paths"],
} as const;

interface Params {
  touched_paths: string[];
  intent?: "edit" | "refactor" | "delete" | "add";
  risk_tolerance?: "low" | "medium" | "high";
}

interface ImpactResult {
  risk?: string;
  dependentCount?: number;
  transitiveCount?: number;
  subsystems?: string[];
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const intent = params.intent ?? "edit";
  const riskTolerance = params.risk_tolerance ?? "medium";

  return formatImpactVerdict(params.touched_paths, intent, riskTolerance, dir);
}

async function formatImpactVerdict(
  paths: string[],
  intent: string,
  riskTolerance: string,
  dir: string
): Promise<string> {
  const impacts: Array<{ path: string; result: ImpactResult | null }> = [];

  for (const filePath of paths.slice(0, 5)) {
    try {
      const result = await runIxJson<ImpactResult>(
        ["impact", filePath, "--format", "json"],
        { cwd: dir }
      );
      impacts.push({ path: filePath, result });
    } catch {
      impacts.push({ path: filePath, result: null });
    }
  }

  let maxRisk = "low";
  let totalDependents = 0;
  const subsystems = new Set<string>();

  for (const impact of impacts) {
    if (!impact.result) continue;
    const risk = (impact.result.risk ?? "low").toLowerCase();
    if (risk === "critical" || (risk === "high" && maxRisk !== "critical")) {
      maxRisk = risk;
    } else if (risk === "medium" && maxRisk === "low") {
      maxRisk = risk;
    }
    totalDependents += impact.result.dependentCount ?? 0;
    for (const subsystem of impact.result.subsystems ?? []) {
      subsystems.add(subsystem);
    }
  }

  const toleranceMultiplier = riskTolerance === "low" ? 0.5 : riskTolerance === "high" ? 2 : 1;
  const reviewThreshold = Math.round(5 * toleranceMultiplier);
  const blockThreshold = Math.round(20 * toleranceMultiplier);

  let verdict: string;
  let requiredAction: string;

  if (maxRisk === "critical" || totalDependents >= blockThreshold) {
    verdict = "BLOCK";
    requiredAction = "Run `/ix-plan` to generate a sequenced change plan before proceeding.";
  } else if (maxRisk === "high" || maxRisk === "medium" || totalDependents >= reviewThreshold) {
    verdict = "REVIEW";
    requiredAction = "Review callers and run tests after this change.";
  } else {
    verdict = "ALLOW";
    requiredAction = "Safe to proceed. Verify affected callers after the change.";
  }

  const lines = [
    `## ix-decide: ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
    "",
    `**Verdict:** ${verdict}`,
    `**Risk:** ${maxRisk.toUpperCase()}`,
    `**Total dependents:** ${totalDependents}`,
  ];

  if (subsystems.size > 0) {
    lines.push(`**Subsystems affected:** ${Array.from(subsystems).join(", ")}`);
  }
  if (intent !== "edit") lines.push(`**Intent:** ${intent}`);

  lines.push("", `**Required action:** ${requiredAction}`);

  if (paths.length > 1) {
    lines.push("", "**Per-file breakdown:**");
    for (const impact of impacts) {
      lines.push(
        `- \`${impact.path}\` — ${(impact.result?.risk ?? "unknown").toUpperCase()}, ${impact.result?.dependentCount ?? 0} dependents`
      );
    }
  }

  lines.push("", "_[Verdict synthesized from ix impact]_");
  return lines.join("\n");
}
