// Copyright 2026 Ix Infrastructure Inc.

import { IxCommandError, parseIxJson, runIx, stripAnsi, ToolContext, toolDirectory } from "./base.ts";

export const name = "ix-decide";
export const description =
  "Get a policy verdict before editing files. Returns ALLOW or REVIEW (flagged high risk when the change is critical or widely depended on) with required actions and blast radius evidence. Used by the pre-edit hook and by ix-plan for high-risk changes.";

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

/**
 * The fields of `ix impact <file> --format json` that the verdict reads, as
 * the released CLI prints them (ix-cli/src/cli/commands/impact.ts, the same
 * from v0.12.0 to main). A file resolves as a container, so its `summary`
 * carries the container counts; a symbol target would carry the leaf counts
 * (`callers`/`callees`) instead, accepted here so a non-file path still reads.
 * No released ix ever printed the `risk`/`dependentCount`/`subsystems` this
 * tool used to read, so there is no older shape to fall back to.
 */
interface ImpactResult {
  riskLevel?: string;
  summary?: {
    members?: number;
    directImporters?: number;
    directDependents?: number;
    memberLevelCallers?: number;
    callers?: number;
  };
  propagationBuckets?: Array<{ region?: string; count?: number }>;
}

/** The parts of one impact record the verdict uses. */
interface Reading {
  risk: string;
  dependents: number;
  regions: string[];
}

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);

function readImpact(result: ImpactResult): Reading {
  const level = typeof result.riskLevel === "string" ? result.riskLevel.toLowerCase() : "";
  // ix withholds the level as "unknown" only on a degraded graph, which assess()
  // already sorts out as unassessed; anything else unrecognised reads as low,
  // and the dependent count below can still raise the verdict.
  const risk = RISK_LEVELS.has(level) ? level : "low";

  const summary = result.summary ?? {};
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  // Importers and direct dependents are disjoint edge sets into the file node
  // (IMPORTS vs CALLS/REFERENCES), so they add. Member-level callers are the
  // callers of the file's functions and classes: mostly the same code as the
  // importers, seen a level down (six files importing two functions they each
  // call give 6 importers and 12 member callers). Adding them would count each
  // dependent twice, so the larger of the two views is taken instead.
  const fileLevel = count(summary.directImporters) + count(summary.directDependents);
  const dependents = Math.max(fileLevel, count(summary.memberLevelCallers), count(summary.callers));

  // ix has no "subsystems" field: the regions its dependents fall in are the
  // propagation buckets, so those are the subsystems a change reaches.
  const regions = (result.propagationBuckets ?? [])
    .map((bucket) => bucket?.region)
    .filter((region): region is string => typeof region === "string" && region.length > 0);

  return { risk, dependents, regions };
}

/**
 * What `ix impact` said about one file. Three different answers, because they
 * call for different verdicts:
 *
 * - measured: ix answered with an impact; its risk drives the verdict.
 * - new: ix answered that the file is not in the graph (or not on disk yet).
 *   Nothing in the graph can depend on it, so it is low risk.
 * - unassessed: ix could not answer at all (not installed, backend down,
 *   workspace not mapped, graph empty or hollowed). That says nothing about
 *   the file, so it neither raises nor lowers the verdict; the output says so.
 */
type Assessment =
  | { kind: "measured"; path: string; result: ImpactResult }
  | { kind: "new"; path: string }
  | { kind: "unassessed"; path: string; reason: string };

/** `ix impact` calls in flight at once. Each is a ~0.3 s node process. */
const IMPACT_CONCURRENCY = 4;

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
  // Every path is measured. This used to stop at the first five, and the rest
  // were neither measured nor reported, so a large patch could be ALLOWed on
  // the strength of its first five files. A bounded pool keeps a big
  // apply_patch from spawning one ix per file at once.
  const unique = Array.from(new Set(paths));
  const assessments = await mapPool(unique, IMPACT_CONCURRENCY, (filePath) => assess(filePath, dir));

  const measured = assessments.filter((a): a is Extract<Assessment, { kind: "measured" }> => a.kind === "measured");
  const newFiles = assessments.filter((a) => a.kind === "new").map((a) => a.path);
  const unassessed = assessments.filter((a): a is Extract<Assessment, { kind: "unassessed" }> => a.kind === "unassessed");

  let maxRisk = "low";
  let totalDependents = 0;
  const subsystems = new Set<string>();
  const readings = new Map<string, Reading>();

  for (const { path, result } of measured) {
    const reading = readImpact(result);
    readings.set(path, reading);
    const risk = reading.risk;
    if (risk === "critical" || (risk === "high" && maxRisk !== "critical")) {
      maxRisk = risk;
    } else if (risk === "medium" && maxRisk === "low") {
      maxRisk = risk;
    }
    totalDependents += reading.dependents;
    for (const region of reading.regions) subsystems.add(region);
  }

  const toleranceMultiplier = riskTolerance === "low" ? 0.5 : riskTolerance === "high" ? 2 : 1;
  const reviewThreshold = Math.round(5 * toleranceMultiplier);
  const highRiskThreshold = Math.round(20 * toleranceMultiplier);

  let verdict: string;
  let requiredAction: string;
  let reason: string | null = null;

  // Only an answer from ix can raise the verdict. A REVIEW makes OpenClaw stop
  // and ask the user, so it is kept for changes ix measured as risky: failing
  // closed on "ix could not answer" put that prompt on every edit wherever Ix
  // was missing, down or not mapped, and on every new file.
  //
  // Nothing is blocked outright. What used to be a BLOCK (a critical file, or
  // more dependents than the high-risk threshold) is a REVIEW that says it is
  // high risk: the user can see why and still approve it, where a block left
  // the agent no way forward but to stop.
  const highRisk = maxRisk === "critical" || totalDependents >= highRiskThreshold;
  if (highRisk) {
    verdict = "REVIEW";
    // "High risk" leads the reason: the pre-edit hook keys the prompt's
    // severity on it, and it is what the user reads first in the prompt.
    const why = [
      maxRisk === "critical" ? "Ix rates this a critical file" : null,
      totalDependents >= highRiskThreshold ? `${totalDependents} dependents (high-risk threshold ${highRiskThreshold})` : null,
    ].filter(Boolean);
    reason = `High risk: ${why.join("; ")}.`;
    requiredAction = "Approve only if this change was planned; run `/ix-plan` for a sequenced change plan first.";
  } else if (maxRisk === "high" || maxRisk === "medium" || totalDependents >= reviewThreshold) {
    verdict = "REVIEW";
    reason =
      maxRisk === "low"
        ? `${totalDependents} dependents (review threshold ${reviewThreshold}).`
        : `Ix rates this ${maxRisk} risk; ${totalDependents} dependents.`;
    requiredAction = "Review callers and run tests after this change.";
  } else {
    verdict = "ALLOW";
    if (unassessed.length > 0) {
      const scope =
        unassessed.length === assessments.length
          ? "this edit"
          : `${unassessed.length} of ${assessments.length} files`;
      requiredAction =
        `Ix unavailable: it could not assess ${scope} (${unassessed[0].reason}). ` +
        "Allowed without an Ix check, so review callers yourself. " +
        "Check `ix status` (run `ix map` if the project is not mapped).";
    } else if (measured.length === 0 && newFiles.length > 0) {
      requiredAction = "Safe to proceed: new files have no dependents in the graph yet.";
    } else {
      requiredAction = "Safe to proceed. Verify affected callers after the change.";
    }
  }

  const lines = [
    `## ix-decide: ${paths.length === 1 ? paths[0] : `${paths.length} files`}`,
    "",
    `**Verdict:** ${verdict}`,
    ...(reason ? [`**Reason:** ${reason}`] : []),
    // Nothing measured and nothing new means ix said nothing; "LOW" would be
    // a reading it never gave.
    `**Risk:** ${measured.length === 0 && newFiles.length === 0 ? "UNKNOWN" : maxRisk.toUpperCase()}`,
    `**Total dependents:** ${totalDependents}`,
  ];

  if (subsystems.size > 0) {
    lines.push(`**Subsystems affected:** ${Array.from(subsystems).join(", ")}`);
  }
  if (newFiles.length > 0) {
    lines.push(`**New (not in the graph yet):** ${newFiles.map((p) => `\`${p}\``).join(", ")}`);
  }
  if (unassessed.length > 0) {
    lines.push(`**Not assessed (Ix unavailable):** ${unassessed.map((a) => `\`${a.path}\``).join(", ")}`);
  }
  if (intent !== "edit") lines.push(`**Intent:** ${intent}`);

  lines.push("", `**Required action:** ${requiredAction}`);

  if (assessments.length > 1) {
    lines.push("", "**Per-file breakdown:**");
    for (const a of assessments) {
      const detail =
        a.kind === "measured"
          ? `${readings.get(a.path)!.risk.toUpperCase()}, ${readings.get(a.path)!.dependents} dependents`
          : a.kind === "new"
            ? "NEW, not in the graph yet"
            : `NOT ASSESSED, ${a.reason}`;
      lines.push(`- \`${a.path}\` — ${detail}`);
    }
  }

  lines.push("", "_[Verdict synthesized from ix impact]_");
  return lines.join("\n");
}

/** Ask `ix impact` about one file and sort its answer into an Assessment. */
async function assess(filePath: string, dir: string): Promise<Assessment> {
  let raw: string;
  try {
    raw = await runIx(["impact", filePath, "--format", "json"], { cwd: dir });
  } catch (error) {
    // ix exits 1 with its record on stdout for a miss (and for an unmapped
    // workspace); with nothing on stdout, the failure itself is the reason.
    const stdout = error instanceof IxCommandError ? error.stdout : "";
    if (!stdout.trim()) return { kind: "unassessed", path: filePath, reason: failureReason(error) };
    raw = stdout;
  }

  let record: unknown;
  try {
    record = parseIxJson<unknown>(raw);
  } catch {
    return { kind: "unassessed", path: filePath, reason: "ix gave an answer that is not JSON" };
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { kind: "unassessed", path: filePath, reason: "ix gave an answer that is not an impact record" };
  }

  const fields = record as Record<string, unknown>;
  // `graph` is set when ix found the workspace's graph empty or hollowed. A
  // miss or a "low risk" read from such a graph says nothing about the file.
  const graph = graphProblem(fields.graph);

  if (typeof fields.error === "string") {
    // ix v0.12.0 (resolve.ts fileMiss): a file target that resolves to nothing
    // is `unresolved_target` with reason `file_not_in_graph` (on disk, not
    // ingested) or `file_not_found` (not on disk either: a file about to be
    // written). Both are a new file, as long as the graph itself is healthy.
    const reason = typeof fields.reason === "string" ? fields.reason : "";
    if (!graph && fields.error === "unresolved_target" && (reason === "file_not_in_graph" || reason === "file_not_found")) {
      return { kind: "new", path: filePath };
    }
    return { kind: "unassessed", path: filePath, reason: graph ?? `\`${fields.error}\`` };
  }

  if (graph) return { kind: "unassessed", path: filePath, reason: graph };
  return { kind: "measured", path: filePath, result: fields as ImpactResult };
}

function graphProblem(graph: unknown): string | null {
  if (!graph || typeof graph !== "object") return null;
  const status = (graph as { status?: unknown }).status;
  return `the workspace graph is ${typeof status === "string" ? status : "degraded"}`;
}

/** One line on why ix produced nothing, for the verdict's note. */
function failureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT" || /\bENOENT\b/.test(message)) return "ix is not installed (not on PATH)";
  const line = stripAnsi(message).split("\n").map((l) => l.trim()).find(Boolean);
  return line ? line.slice(0, 160) : "ix failed without saying why";
}

/** `fn` over `items` with at most `limit` in flight; results in input order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
