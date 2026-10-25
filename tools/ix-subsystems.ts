// Copyright 2026 Ix Infrastructure Inc.

import { ixUnavailableMessage, runIxJson, ToolContext, toolDirectory } from "./base.ts";
import { tryLlm } from "../runtime/llm.ts";

export const name = "ix-subsystems";
export const description =
  "List all graph-derived subsystems with file counts, hierarchy levels, confidence signals, and interface counts. Use for top-level architectural orientation before deeper exploration.";

export const parameters = {
  type: "object",
  properties: {},
  required: [],
} as const;

export async function execute(
  _params: Record<string, never>,
  context: ToolContext
): Promise<string> {
  const dir = toolDirectory(context);

  // Kept for the JSON fallback: an llm answer that was only the stale
  // record still says the map is stale, even if the JSON omits map_stale.
  let llmStaleLine: string | null = null;
  const fast = await tryLlm(["subsystems"], dir);
  if (fast) {
    // A stale map arrives as a `diagnostic code=map_stale` record. It becomes
    // the stale line under the heading instead of a second, raw copy in the
    // body. A body that was nothing but that record falls through to JSON,
    // as an empty llm answer would.
    const { body, staleLine } = splitStaleDiagnostic(fast);
    if (body) {
      return staleLine ? `## ix-subsystems\n\n${staleLine}\n\n${body}` : `## ix-subsystems\n\n${body}`;
    }
    llmStaleLine = staleLine;
  }

  let raw: any;
  try {
    raw = await runIxJson<any>(["subsystems", "--format", "json"], { cwd: dir });
  } catch (error) {
    return ixUnavailableMessage(
      "ix-subsystems",
      "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
      getErrorMessage(error)
    );
  }

  // Ix sets map_stale only when the map lags recent edits; an older CLI
  // never sends it, and then the output is exactly what it always was.
  const heading = ["## ix-subsystems", ""];
  const staleLine = raw?.map_stale === true ? staleMapLine(raw.regions_as_of) : llmStaleLine;
  if (staleLine) heading.push(staleLine, "");

  const regions = raw.regions ?? [];
  if (regions.length === 0) {
    return [...heading, "**No subsystems found.** Run `ix map` to build the graph."].join("\n");
  }

  const lines = [
    ...heading,
    `**${regions.length} subsystem${regions.length === 1 ? "" : "s"}** — ${raw.file_count ?? "?"} files, ${raw.levels ?? "?"} level${raw.levels === 1 ? "" : "s"}`,
    "",
    "| Subsystem | Kind | Level | Files | Children | Interfaces | Confidence |",
    "|-----------|------|-------|-------|----------|------------|------------|",
  ];

  for (const region of regions) {
    lines.push(
      `| ${region.label ?? "unknown"} | ${region.label_kind ?? "—"} | ${region.level ?? "—"} | ${region.files ?? "—"} | ${region.children ?? 0} | ${region.interfaces ?? 0} | ${typeof region.confidence === "number" ? region.confidence.toFixed(2) : "—"} |`
    );
  }
  if (raw.outcome) lines.push("", `_Outcome: ${raw.outcome}_`);
  return lines.join("\n");
}

/**
 * The one line a stale architecture map adds under the heading. It does not
 * say a background refresh is under way: Ix also reports a stale map when
 * background refresh is off (IX_MAP_BACKGROUND_REFRESH=0), failed or could
 * not start. It carries the remedy Ix's own llm record gives, which this tool
 * drops from the body.
 */
function staleMapLine(regionsAsOf: unknown): string {
  const asOf = formatMapRev(regionsAsOf) ?? formatAsOf(regionsAsOf);
  return `_Map is stale${asOf ? ` (regions as of ${asOf})` : ""}; recent edits may not be reflected — run \`ix map --remap\` to refresh it now._`;
}

/** Ix's `regions_as_of` (`{map_rev, file_count}`) as `map rev N, M files`. */
function formatMapRev(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { map_rev: rev, file_count: files } = value as Record<string, unknown>;
  if (typeof rev !== "number" || !Number.isFinite(rev)) return null;
  if (typeof files !== "number" || !Number.isFinite(files)) return null;
  return `map rev ${rev}, ${files} file${files === 1 ? "" : "s"}`;
}

/**
 * A timestamp as `YYYY-MM-DD HH:MM UTC`; text ix sent that is not one, as given.
 * Epoch numbers below 1e11 are seconds (1e11 s is the year 5138), larger ones
 * milliseconds. A date-time with no zone is shown as written, without `UTC`,
 * rather than being read in this host's local time zone.
 */
function formatAsOf(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(text)) {
    const epoch = Number(text);
    const date = new Date(epoch < 1e11 ? epoch * 1000 : epoch);
    if (Number.isFinite(epoch) && !Number.isNaN(date.getTime())) return toUtcMinute(date);
    return text.slice(0, 80);
  }
  const local = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/);
  if (local) return `${local[1]} ${local[2]}`;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace(/\s+/g, " ").slice(0, 80);
  return toUtcMinute(date);
}

function toUtcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// `code=map_stale` must be one of the record's own fields: quoted values are
// skipped whole, so a message that mentions `code=map_stale` does not match.
const STALE_DIAGNOSTIC = /^diagnostic(?:\s+(?:[^\s="]+=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)|[^\s="]+))*?\s+code=map_stale(\s|$)/;
const REGIONS_AS_OF = /\bregions_as_of=(?:"((?:[^"\\]|\\.)*)"|(\S+))/;
// Ix's record names the last map only in its message: `(map rev N, M files)`.
const MESSAGE_MAP_REV = /\(map rev (\d+), (\d+) files?\)/;

/**
 * Pull `diagnostic code=map_stale` records out of `ix subsystems --format llm`
 * text. Returns the remaining records and, when there was one, the stale line.
 */
function splitStaleDiagnostic(text: string): { body: string; staleLine: string | null } {
  let staleLine: string | null = null;
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (STALE_DIAGNOSTIC.test(line.trim())) {
      if (staleLine === null) {
        const match = line.match(REGIONS_AS_OF);
        const rev = match ? null : line.match(MESSAGE_MAP_REV);
        staleLine = staleMapLine(
          match
            ? (match[1] ?? match[2])?.replace(/\\(.)/g, "$1")
            : rev
              ? { map_rev: Number(rev[1]), file_count: Number(rev[2]) }
              : undefined,
        );
      }
      continue;
    }
    kept.push(line);
  }
  if (staleLine === null) return { body: text, staleLine: null };
  return { body: kept.join("\n").trim(), staleLine };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
