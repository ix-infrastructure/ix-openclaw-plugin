// Copyright 2026 Ix Infrastructure Inc.

import { resolve } from "node:path";

import { ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { graphIngested, readStatus } from "./cli-records.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-smells";
export const description =
  "Report code quality and architecture smells across the graph: orphan files, high coupling, low cohesion, dead code, and other structural issues. Use during architecture review or before a large refactor. By default it reads the smell results already stored in the graph and runs nothing. Set `detect: true` to re-run smell detection; that is a full analysis that writes a new set of smell results to the Ix backend, so use it only when the stored results are out of date.";

export const parameters = {
  type: "object",
  properties: {
    limit: {
      type: "number",
      description: "Max results to return. Default: 50, max: 200",
      default: 50,
    },
    detect: {
      type: "boolean",
      description:
        "Re-run smell detection instead of reading the stored results. Slow, and it writes: the new results replace the stored ones in the Ix backend. Default: false (detection still runs once when the graph is mapped and no results are stored yet).",
      default: false,
    },
  },
  required: [],
} as const;

interface Params {
  limit?: number;
  detect?: boolean;
}

const UNAVAILABLE = "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.";
const REDETECT_HINT = "Pass `detect: true` to re-run detection (it writes new results to the Ix backend).";

// Directories where this process has already run detection. `ix smells --list`
// cannot tell "never detected" from "detected, found nothing" (both print
// `count: 0` and no rows), so without this a clean graph would re-run
// detection, a backend write, on every default call.
const detectedDirs = new Set<string>();

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const limit = Math.min(params.limit ?? 50, 200);
  // `ix smells` has no path filter; it always reports on the whole graph.

  if (params.detect === true) {
    return detect(dir, limit, "_Ran smell detection (`ix smells`), as asked; it stored these results in the Ix backend._");
  }

  // `ix smells --list` reads the stored smell claims and runs nothing. Plain
  // `ix smells` re-runs detection and stores a new set: a backend write.
  // Its JSON is {count, inference_version, smells: [{smell, entity_id, confidence}]}.
  let stored: any;
  try {
    stored = await runIxJson<any>(["smells", "--list", "--format", "json"], { cwd: dir });
  } catch (error) {
    // A failed read never turns into a write.
    return ixUnavailableMessage("ix-smells", UNAVAILABLE, getErrorMessage(error));
  }

  const rows = readRows(stored, "smells");
  const total = readCount(stored, rows);

  if (rows.length > 0 || total > 0) {
    const source = `_Stored smell results from the last detection run, read with \`ix smells --list\`; nothing was re-run. ${REDETECT_HINT}_`;
    return render(rows, total, limit, undefined, source);
  }

  if (detectedDirs.has(resolve(dir))) {
    return [
      "## ix-smells",
      "",
      `_No smell results are stored, and smell detection already ran for this workspace in this session; it was not re-run. ${REDETECT_HINT}_`,
      "",
      "No code smells detected. Architecture looks clean.",
    ].join("\n");
  }

  // Nothing stored. Detect once, but only on a graph that has been mapped:
  // on an empty graph detection has nothing to analyse.
  let mapped = false;
  try {
    mapped = graphIngested(readStatus(await runIxJson<unknown>(["status", "--format", "json"], { cwd: dir })));
  } catch {
    mapped = false;
  }
  if (!mapped) {
    return [
      "## ix-smells",
      "",
      "**No stored smell results**, and Ix does not report a mapped graph here, so detection was not run.",
      "Run `ix map` first, then call ix-smells again.",
    ].join("\n");
  }
  return detect(dir, limit, "_No stored smell results, so this ran smell detection (`ix smells`) once; it stored these results in the Ix backend. Later calls read them back and do not re-run it._");
}

/** Run `ix smells` (detection, which stores its results) and render it under `source`. */
async function detect(dir: string, limit: number, source: string): Promise<string> {
  // Recorded before the run: a failed or slow detection is not retried by
  // later default calls either; `detect: true` always runs.
  detectedDirs.add(resolve(dir));
  const fast = await tryLlm(["smells"], dir);
  if (fast) return `## ix-smells\n\n${source}\n\n${fast}`;

  let raw: any;
  try {
    raw = await runIxJson<any>(["smells", "--format", "json"], { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage("ix-smells", UNAVAILABLE, getErrorMessage(error));
  }
  // Detection's JSON is {run_at, count, candidates: [{smell, file, confidence, signals}]}.
  const candidates = readRows(raw, "candidates");
  return render(candidates, readCount(raw, candidates), limit, readRunAt(raw), source);
}

function render(allCandidates: any[], total: number, limit: number, runAt: string | undefined, source: string): string {
  const candidates = allCandidates.slice(0, limit);

  if (candidates.length === 0) {
    return [
      "## ix-smells",
      "",
      source,
      "",
      total > 0
        ? `ix reported ${total} smell${total === 1 ? "" : "s"} but sent no rows this tool can read.`
        : "No code smells detected. Architecture looks clean.",
      ...(runAt ? ["", `_Analysis run at: ${runAt}_`] : []),
    ].join("\n");
  }

  const lines = [
    "## ix-smells",
    "",
    source,
    "",
    `**${total} smell${total === 1 ? "" : "s"} detected**${candidates.length < total ? ` (showing ${candidates.length} of ${total})` : ""}`,
    "",
  ];

  const bySmell = new Map<string, any[]>();
  for (const candidate of candidates) {
    const smell = candidate.smell ?? "unknown";
    const items = bySmell.get(smell) ?? [];
    items.push(candidate);
    bySmell.set(smell, items);
  }

  for (const [smell, items] of bySmell) {
    lines.push(`### ${smell} (${items.length})`);
    for (const item of items.slice(0, 10)) {
      lines.push(`- ${rowLabel(item)}${typeof item.confidence === "number" ? ` — confidence: ${item.confidence.toFixed(2)}` : ""}`);
      if (item.signals && Object.keys(item.signals).length > 0) {
        const signalStr = Object.entries(item.signals)
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${value}`)
          .join(", ");
        lines.push(`  _signals: ${signalStr}_`);
      }
    }
    if (items.length > 10) lines.push(`  _...and ${items.length - 10} more_`);
    lines.push("");
  }
  if (runAt) lines.push(`_Analysis run at: ${runAt}_`);
  return lines.join("\n");
}

function readRows(raw: any, field: "candidates" | "smells"): any[] {
  return Array.isArray(raw?.[field]) ? raw[field] : [];
}

/** A detection row names its file; a stored (`--list`) row only its entity id. */
function rowLabel(item: any): string {
  if (typeof item?.file === "string" && item.file) return `\`${item.file}\``;
  if (typeof item?.entity_id === "string" && item.entity_id) return `entity \`${item.entity_id}\``;
  return "`?`";
}

function readCount(raw: any, candidates: any[]): number {
  return typeof raw?.count === "number" && Number.isFinite(raw.count) ? raw.count : candidates.length;
}

function readRunAt(raw: any): string | undefined {
  const value = raw?.run_at;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
