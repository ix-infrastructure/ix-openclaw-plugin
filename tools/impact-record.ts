// Copyright 2026 Ix Infrastructure Inc.

/**
 * Reading `ix impact <target> --format json`, shared by every tool that asks
 * for it (ix-decide, ix-impact, ix-docs-tool).
 *
 * The fields below are the ones the released CLI prints
 * (ix-cli/src/cli/commands/impact.ts, the same from v0.12.0 to main). A file
 * resolves as a container, so its `summary` carries the container counts; a
 * symbol resolves as a leaf and carries `callers`/`callees` instead. The
 * regions a change reaches are `propagationBuckets[].region`. No released ix
 * ever printed the `risk`/`dependentCount`/`transitiveCount`/`subsystems`
 * these tools used to read, so there is no older shape to fall back to.
 */
export interface ImpactRecord {
  resolvedTarget?: { kind?: string; name?: string };
  riskLevel?: string;
  riskSummary?: string;
  atRiskBehavior?: string[];
  summary?: {
    members?: number;
    directImporters?: number;
    directDependents?: number;
    memberLevelCallers?: number;
    callers?: number;
    callees?: number;
  };
  propagationBuckets?: Array<{ region?: string; count?: number }>;
}

/** The parts of one impact record the tools use. */
export interface ImpactReading {
  /** "low" | "medium" | "high" | "critical", or "unknown" when ix withheld it or sent something else. */
  level: string;
  dependents: number;
  /** The regions the dependents sit in, each once, in ix's order. */
  regions: string[];
  atRiskBehavior: string[];
}

export const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);

export function readImpact(record: ImpactRecord): ImpactReading {
  const raw = typeof record.riskLevel === "string" ? record.riskLevel.toLowerCase() : "";
  // ix withholds the level as "unknown" on a degraded graph.
  const level = RISK_LEVELS.has(raw) ? raw : "unknown";

  const summary = record.summary ?? {};
  const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  // Importers and direct dependents are disjoint edge sets into the file node
  // (IMPORTS vs CALLS/REFERENCES), so they add. Member-level callers are the
  // callers of the file's functions and classes: mostly the same code as the
  // importers, seen a level down (six files importing two functions they each
  // call give 6 importers and 12 member callers). Adding them would count each
  // dependent twice, so the larger of the two views is taken instead. A
  // symbol target has only `callers`.
  const fileLevel = count(summary.directImporters) + count(summary.directDependents);
  const dependents = Math.max(fileLevel, count(summary.memberLevelCallers), count(summary.callers));

  // ix has no "subsystems" field: the regions its dependents fall in are the
  // propagation buckets, so those are the subsystems a change reaches.
  const regions = Array.from(
    new Set(
      (Array.isArray(record.propagationBuckets) ? record.propagationBuckets : [])
        .map((bucket) => bucket?.region)
        .filter((region): region is string => typeof region === "string" && region.length > 0)
    )
  );

  const atRiskBehavior = (Array.isArray(record.atRiskBehavior) ? record.atRiskBehavior : []).filter(
    (behavior): behavior is string => typeof behavior === "string" && behavior.length > 0
  );

  return { level, dependents, regions, atRiskBehavior };
}
