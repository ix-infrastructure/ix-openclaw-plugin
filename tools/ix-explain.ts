import { ixHttpPost, ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-explain";
export const description =
  "Get a full explanation of a symbol: its role, importance level, caller/callee counts, top dependents, and a plain-English description from the graph. More complete than ix-query.";

export const parameters = {
  type: "object",
  properties: {
    symbol: {
      type: "string",
      description: "Symbol name to explain (class, function, file, or module)",
    },
  },
  required: ["symbol"],
} as const;

interface Params {
  symbol: string;
}

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);

  // Tier 5: gated to ix >= 0.9.2, not 0.7.0. Before that release `explain`
  // accepted `--format llm` and rendered *text* — no error, exit 0 — so an
  // ungated call here would hand the model prose dressed as records.
  const fast = await tryLlm(["explain", params.symbol], dir);
  if (fast) return `## ix-explain: ${params.symbol}\n\n${fast}`;

  let raw: any;
  try {
    raw = await explainViaHttp(params.symbol);
  } catch {
    try {
      raw = await runIxJson<any>(["explain", params.symbol, "--format", "json"], { cwd: dir });
    } catch (error) {
      return ixUnavailableMessage(
        `ix-explain: ${params.symbol}`,
        "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
        getErrorMessage(error)
      );
    }
  }

  if (!raw.resolvedTarget && !raw.facts) {
    return [
      `## ix-explain: ${params.symbol}`,
      "",
      "Not found in graph. Try `ix map` to refresh, or check the exact symbol name with ix-query.",
    ].join("\n");
  }

  const lines = [`## ix-explain: ${params.symbol}`, ""];
  if (raw.resolvedTarget?.kind) lines.push(`**Kind:** ${raw.resolvedTarget.kind}`);
  if (raw.resolvedTarget?.path) lines.push(`**Path:** \`${raw.resolvedTarget.path}\``);
  if (raw.role?.role) {
    lines.push(`**Role:** ${raw.role.role}${raw.role.confidence ? ` (${raw.role.confidence} confidence)` : ""}`);
    if (Array.isArray(raw.role.reasons) && raw.role.reasons.length > 0) {
      lines.push(`  _${raw.role.reasons.slice(0, 2).join("; ")}_`);
    }
  }
  if (raw.importance?.level) {
    lines.push(`**Importance:** ${raw.importance.level}${raw.importance.category ? ` — ${raw.importance.category}` : ""}`);
  }

  if (raw.facts) {
    const graphFacts: string[] = [];
    if (typeof raw.facts.callerCount === "number") graphFacts.push(`callers: ${raw.facts.callerCount}`);
    if (typeof raw.facts.calleeCount === "number") graphFacts.push(`callees: ${raw.facts.calleeCount}`);
    if (typeof raw.facts.dependentCount === "number") graphFacts.push(`dependents: ${raw.facts.dependentCount}`);
    if (typeof raw.facts.memberCount === "number") graphFacts.push(`members: ${raw.facts.memberCount}`);
    if (graphFacts.length > 0) lines.push(`**Graph:** ${graphFacts.join(" · ")}`);
    if (Array.isArray(raw.facts.topCallers) && raw.facts.topCallers.length > 0) {
      lines.push(`**Top callers:** ${raw.facts.topCallers.slice(0, 5).map((item: string) => `\`${item}\``).join(", ")}`);
    }
    if (Array.isArray(raw.facts.topDependents) && raw.facts.topDependents.length > 0) {
      lines.push(`**Top dependents:** ${raw.facts.topDependents.slice(0, 5).map((item: string) => `\`${item}\``).join(", ")}`);
    }
    if (raw.facts.stale) lines.push("\n⚠ Data may be stale — run `ix map` to refresh.");
  }

  if (raw.rendered?.explanation) lines.push("", raw.rendered.explanation);
  if (raw.rendered?.whyItMatters) lines.push("", `**Why it matters:** ${raw.rendered.whyItMatters}`);
  if (raw.rendered?.usedBy) lines.push(`**Used by:** ${raw.rendered.usedBy}`);
  if (Array.isArray(raw.rendered?.notes) && raw.rendered.notes.length > 0) {
    lines.push("", ...raw.rendered.notes.map((note: string) => `_${note}_`));
  }

  return lines.join("\n");
}

async function explainViaHttp(symbol: string): Promise<any> {
  // Step 1: find the entity by name.
  const candidates = await ixHttpPost<any[]>("/v1/search", { term: symbol, nameOnly: true, limit: 5 });
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error("not found");

  const target = candidates.find((n: any) => n.name === symbol) ?? candidates[0];

  // Step 2: expand the entity to get its neighborhood.
  const expanded = await ixHttpPost<any>("/v1/expand", {
    nodeId: target.id,
    direction: "both",
    predicates: ["CALLS", "IMPORTS", "REFERENCES", "CONTAINS"],
    hops: 1,
  });

  const edges: any[] = expanded.edges ?? [];
  const nodes: any[] = expanded.nodes ?? [];
  const nodeMap = new Map(nodes.map((n: any) => [n.id, n]));

  const callerEdges = edges.filter((e: any) => e.dst === target.id && (e.predicate === "CALLS" || e.predicate === "REFERENCES"));
  const calleeEdges = edges.filter((e: any) => e.src === target.id && (e.predicate === "CALLS" || e.predicate === "REFERENCES"));
  const dependentEdges = edges.filter((e: any) => e.dst === target.id);
  const memberEdges = edges.filter((e: any) => e.src === target.id && e.predicate === "CONTAINS");

  const topCallers = callerEdges.map((e: any) => nodeMap.get(e.src)?.name ?? "").filter(Boolean).slice(0, 5);
  const topDependents = dependentEdges.map((e: any) => nodeMap.get(e.src)?.name ?? "").filter(Boolean).slice(0, 5);

  return {
    resolvedTarget: {
      kind: target.kind,
      path: target.provenance?.sourceUri ?? "",
      name: target.name,
    },
    facts: {
      callerCount: callerEdges.length,
      calleeCount: calleeEdges.length,
      dependentCount: dependentEdges.length,
      memberCount: memberEdges.length,
      topCallers,
      topDependents,
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
