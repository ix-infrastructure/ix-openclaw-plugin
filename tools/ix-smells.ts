// Copyright 2026 Ix Infrastructure Inc.

import { ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { ixVersionAtLeast, tryLlm } from "../runtime/llm.ts";

export const name = "ix-smells";
export const description =
  "Report code quality and architecture smells across the graph: orphan files, high coupling, low cohesion, dead code, and other structural issues. Use during architecture review or before a large refactor. By default it reads the smell results already stored in the graph and runs nothing. Set `detect: true` to run smell detection; that is a full analysis that writes a new set of smell results to the Ix backend, so set it only when the user explicitly asks for detection to run. Never set it on your own, not even when no results are stored or they look out of date; report that and let the user decide.";

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
        "Run smell detection instead of reading the stored results. Slow, and it writes: the new results replace the stored ones in the Ix backend. Default: false (the tool never runs detection unless this is true).",
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
const REDETECT_HINT = "If the user asks for fresh results, `detect: true` re-runs detection (it writes new results to the Ix backend).";

// `ix smells --list` takes `--limit` from ix v0.14.0. Older releases (CI pins
// v0.12.0) reject the unknown option, so it is sent only to a CLI known to
// accept it; otherwise the tool caps the rows itself. The version is probed
// once per process, so a CLI downgraded under a running host can still be sent
// `--limit`: when ix rejects the option, the read is retried without it.
const LIST_LIMIT_SINCE: [number, number, number] = [0, 14, 0];
const UNKNOWN_LIMIT_OPTION = /unknown option ['"`]?--limit/i;
// An ix older than `ix smells --list` rejects the option the same way. That is
// not an unavailable ix, and `ix map` does not fix it, so it gets its own message.
const UNKNOWN_LIST_OPTION = /unknown option ['"`]?--list/i;

export async function execute(params: Params, context: ToolContext): Promise<string> {
  const dir = toolDirectory(context);
  const limit = clampLimit(params.limit);
  // `ix smells` has no path filter; it always reports on the whole graph.

  if (params.detect === true) {
    return detect(dir, limit, "_Ran smell detection (`ix smells`), as asked; it stored these results in the Ix backend._");
  }

  // `ix smells --list` reads the stored smell claims and runs nothing. Plain
  // `ix smells` re-runs detection and stores a new set: a backend write, so it
  // runs only when the caller passes `detect: true`.
  // Its JSON is {count, [shown, truncated,] inference_version, smells: [{smell, entity_id}]}:
  // `smell` is the claim kind ("has_smell.orphan_file"), `entity_id` a 12-character
  // prefix. The backend keeps confidence, file and signals inside the claim's
  // value, which --list does not print.
  const plainList = ["smells", "--list", "--format", "json"];
  const sendLimit = await ixVersionAtLeast(LIST_LIMIT_SINCE, dir);

  let stored: any;
  try {
    try {
      stored = await runIxJson<any>(sendLimit ? ["smells", "--list", "--limit", String(limit), "--format", "json"] : plainList, { cwd: dir });
    } catch (error) {
      if (!sendLimit || !UNKNOWN_LIMIT_OPTION.test(getErrorMessage(error))) throw error;
      // This ix predates `--limit`; the rows are capped below either way.
      stored = await runIxJson<any>(plainList, { cwd: dir });
    }
  } catch (error) {
    // A failed read never turns into a write.
    const message = getErrorMessage(error);
    if (UNKNOWN_LIST_OPTION.test(message)) return listUnsupportedMessage(message);
    return ixUnavailableMessage("ix-smells", UNAVAILABLE, message);
  }

  const rows = readRows(stored, "smells");
  const total = readCount(stored, rows);

  if (rows.length > 0 || total > 0) {
    const source = `_Stored smell results from the last detection run, read with \`ix smells --list\`; nothing was re-run. ix does not record when that run was, so these may predate the latest \`ix map\`. Stored rows name the graph entity (a 12-character id), not its file, so they cannot be narrowed to a path. Detection rows name the file. ${REDETECT_HINT}_`;
    return render(rows, total, limit, undefined, source);
  }

  // Nothing stored. `--list` cannot tell "never detected" from "detected and
  // found nothing" (both print count 0 and no rows), so say exactly that and
  // leave detection, a write, to the caller.
  return [
    "## ix-smells",
    "",
    "**No smell results are stored** in the graph (read with `ix smells --list`; nothing was run).",
    "Either smell detection has not been run on this graph, or its last run found nothing; ix does not say which.",
    "",
    "If the user asks for it, `detect: true` runs smell detection. It is slow and writes a new set of smell results to the Ix backend. If the graph is not mapped yet, run `ix map` first.",
  ].join("\n");
}

/** The installed ix has no `ix smells --list`: say so, and that upgrading ix fixes it. */
function listUnsupportedMessage(error: string): string {
  return [
    "## ix-smells",
    "",
    "**This ix CLI cannot read stored smell results:** it rejected `ix smells --list`, which older releases do not have. Nothing was run.",
    "",
    "Upgrade the ix CLI to read stored results. If the user asks for fresh detection, `detect: true` runs it on this ix; it is slow and writes a new set of smell results to the Ix backend.",
    "",
    `Error: ${error}`,
  ].join("\n");
}

/** Run `ix smells` (detection, which stores its results) and render it under `source`. */
async function detect(dir: string, limit: number, source: string): Promise<string> {
  const fast = await tryLlm(["smells"], dir);
  if (fast) return `## ix-smells\n\n${source}\n\n${fast}`;

  let raw: any;
  try {
    raw = await runIxJson<any>(["smells", "--format", "json"], { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage("ix-smells", UNAVAILABLE, getErrorMessage(error));
  }
  // Detection's JSON is {rev, run_at, count, inference_version, candidates: [{file, smell, confidence, signals}]}.
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
    const smell = smellLabel(candidate.smell);
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

/** "has_smell.orphan_file" -> "orphan_file": the claim kind without its namespace. */
function smellLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "unknown";
  return value.trim().replace(/^has_smell\./, "") || "unknown";
}

/** A whole number from 1 to 200; 50 when unset or not a number. */
function clampLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 50;
  return Math.min(Math.max(n, 1), 200);
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
