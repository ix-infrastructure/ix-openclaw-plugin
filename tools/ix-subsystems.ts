// Copyright 2026 Ix Infrastructure Inc.

import { ixUnavailableMessage, parseIxJson, runIxWithStderr, ToolContext, toolDirectory } from "./base.ts";
import { tryLlmRun } from "../runtime/llm.ts";
import { mapStaleFromJson, mapStaleFromLlm, mapStaleNote } from "../runtime/map-stale.ts";

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

  const fast = await tryLlmRun(["subsystems"], dir);
  if (fast) {
    // A map deferred after an edit (Ix#841): the regions are the last map's.
    const stale = mapStaleFromLlm(fast.text, fast.stderr);
    return stale
      ? `## ix-subsystems\n\n${mapStaleNote(stale)}\n\n${fast.text}`
      : `## ix-subsystems\n\n${fast.text}`;
  }

  let raw: any;
  let stderr = "";
  try {
    // `runIxJson`, keeping stderr for the stale-map line (Ix#841).
    const run = await runIxWithStderr(["subsystems", "--format", "json"], { cwd: dir });
    stderr = run.stderr;
    raw = parseIxJson<any>(run.stdout);
  } catch (error) {
    return ixUnavailableMessage(
      "ix-subsystems",
      "**ix unavailable.** Ensure the ix CLI is installed and `ix map` has been run.",
      getErrorMessage(error)
    );
  }

  const regions = raw.regions ?? [];
  if (regions.length === 0) {
    return ["## ix-subsystems", "", "**No subsystems found.** Run `ix map` to build the graph."].join("\n");
  }

  const lines = [
    "## ix-subsystems",
    "",
    `**${regions.length} subsystem${regions.length === 1 ? "" : "s"}** — ${raw.file_count ?? "?"} files, ${raw.levels ?? "?"} level${raw.levels === 1 ? "" : "s"}`,
  ];
  // A map deferred after an edit (Ix#841): the counts are the last map's.
  const stale = mapStaleFromJson(raw, stderr);
  if (stale) lines.push(mapStaleNote(stale));
  lines.push(
    "",
    "| Subsystem | Kind | Level | Files | Children | Interfaces | Confidence |",
    "|-----------|------|-------|-------|----------|------------|------------|",
  );

  for (const region of regions) {
    lines.push(
      `| ${region.label ?? "unknown"} | ${region.label_kind ?? "—"} | ${region.level ?? "—"} | ${region.files ?? "—"} | ${region.children ?? 0} | ${region.interfaces ?? 0} | ${typeof region.confidence === "number" ? region.confidence.toFixed(2) : "—"} |`
    );
  }
  if (raw.outcome) lines.push("", `_Outcome: ${raw.outcome}_`);
  return lines.join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
