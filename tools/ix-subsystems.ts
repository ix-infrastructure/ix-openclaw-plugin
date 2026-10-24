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
  if (raw?.map_stale === true) heading.push(staleMapLine(raw.regions_as_of), "");

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

/** The one line a stale architecture map adds under the heading. */
function staleMapLine(regionsAsOf: unknown): string {
  const asOf = formatAsOf(regionsAsOf);
  return `_Map is stale${asOf ? ` (regions as of ${asOf})` : ""}; recent edits may not be reflected — a background refresh is running._`;
}

/** A timestamp as `YYYY-MM-DD HH:MM UTC`; text ix sent that is not one, as given. */
function formatAsOf(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!text) return null;
  const date = new Date(typeof value === "number" ? value : text);
  if (Number.isNaN(date.getTime())) return text.replace(/\s+/g, " ").slice(0, 80);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const STALE_DIAGNOSTIC = /^diagnostic\s.*\bcode=map_stale(\s|$)/;
const REGIONS_AS_OF = /\bregions_as_of=(?:"((?:[^"\\]|\\.)*)"|(\S+))/;

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
        staleLine = staleMapLine(match ? (match[1] ?? match[2])?.replace(/\\(.)/g, "$1") : undefined);
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
