import { runIxJson, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-history";
export const description =
  "Get change history, recorded decisions, and known bugs for a symbol or workspace. Requires Ix Pro. Returns empty results gracefully if Pro is unavailable.";

export const parameters = {
  type: "object",
  properties: {
    topic: {
      type: "string",
      description: "Optional: symbol or topic to filter history/decisions to.",
    },
    include: {
      type: "array",
      items: {
        type: "string",
        enum: ["decisions", "bugs", "changes", "briefing"],
      },
      description: "What to fetch. Default: ['briefing']",
      default: ["briefing"],
    },
  },
  required: [],
} as const;

interface Params {
  topic?: string;
  include?: Array<"decisions" | "bugs" | "changes" | "briefing">;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const include = params.include ?? ["briefing"];

  let proAvailable = false;
  let briefingData: any = {};

  if (include.includes("briefing") || !params.topic) {
    try {
      briefingData = await runIxJson<any>(["briefing", "--format", "json"], { cwd: dir });
      proAvailable = Boolean(briefingData.revision);
    } catch {
      // Pro not available.
    }
  }

  if (!proAvailable) {
    return [
      `## ix-history${params.topic ? `: ${params.topic}` : ""}`,
      "",
      "**Ix Pro not available.** History, decisions, and bug tracking require Ix Pro.",
      "",
      "_Graph-based features (ix-query, ix-neighbors, ix-impact, ix-map) work without Pro._",
    ].join("\n");
  }

  const sections = [
    `## ix-history${params.topic ? `: ${params.topic}` : ""}`,
    "",
    `**Revision:** ${briefingData.revision}`,
    "",
  ];

  if (include.includes("decisions") || include.includes("briefing")) {
    if (params.topic) {
      try {
        const parsed = await runIxJson<any>(["decisions", "--topic", params.topic, "--format", "json"], {
          cwd: dir,
        });
        sections.push(formatDecisions(parsed.decisions ?? []));
      } catch {
        sections.push(formatDecisions(briefingData.recentDecisions ?? []));
      }
    } else {
      sections.push(formatDecisions(briefingData.recentDecisions ?? []));
    }
  }

  if (include.includes("bugs") || include.includes("briefing")) {
    sections.push(formatBugs(briefingData.openBugs ?? []));
  }
  if (include.includes("changes") || include.includes("briefing")) {
    sections.push(formatChanges(briefingData.recentChanges ?? []));
  }
  if (include.includes("briefing")) {
    if (Array.isArray(briefingData.activeGoals) && briefingData.activeGoals.length > 0) {
      sections.push(formatGoals(briefingData.activeGoals));
    }
    if (Array.isArray(briefingData.activePlans) && briefingData.activePlans.length > 0) {
      sections.push(formatPlans(briefingData.activePlans));
    }
  }

  return sections.join("\n");
}

function formatDecisions(decisions: Array<{ title?: string; summary?: string; date?: string }>): string {
  if (decisions.length === 0) return "**Recent decisions:** none\n";
  const lines = [`**Recent decisions** (${decisions.length}):`];
  for (const decision of decisions.slice(0, 5)) {
    lines.push(`- ${decision.title ?? "(untitled)"}${decision.date ? ` — ${decision.date}` : ""}`);
    if (decision.summary) lines.push(`  ${decision.summary}`);
  }
  return lines.join("\n") + "\n";
}

function formatBugs(bugs: Array<{ title?: string; severity?: string; affects?: string }>): string {
  if (bugs.length === 0) return "**Open bugs:** none\n";
  const lines = [`**Open bugs** (${bugs.length}):`];
  for (const bug of bugs.slice(0, 5)) {
    lines.push(
      `- ${bug.title ?? "(untitled)"}${bug.severity ? ` [${bug.severity}]` : ""}${bug.affects ? ` — affects \`${bug.affects}\`` : ""}`
    );
  }
  return lines.join("\n") + "\n";
}

function formatChanges(changes: Array<{ summary?: string; date?: string; author?: string }>): string {
  if (changes.length === 0) return "**Recent changes:** none\n";
  const lines = [`**Recent changes** (${changes.length}):`];
  for (const change of changes.slice(0, 5)) {
    lines.push(
      `- ${change.summary ?? "(no summary)"}${change.author ? ` by ${change.author}` : ""}${change.date ? ` (${change.date})` : ""}`
    );
  }
  return lines.join("\n") + "\n";
}

function formatGoals(goals: Array<{ title?: string; id?: string }>): string {
  const lines = ["**Active goals:**"];
  for (const goal of goals) {
    lines.push(`- ${goal.title ?? "(untitled)"}${goal.id ? ` (${goal.id})` : ""}`);
  }
  return lines.join("\n") + "\n";
}

function formatPlans(plans: Array<{ title?: string; id?: string; status?: string }>): string {
  const lines = ["**Active plans:**"];
  for (const plan of plans) {
    lines.push(
      `- ${plan.title ?? "(untitled)"}${plan.id ? ` (${plan.id})` : ""}${plan.status ? ` [${plan.status}]` : ""}`
    );
  }
  return lines.join("\n") + "\n";
}
