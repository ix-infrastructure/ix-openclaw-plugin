// Copyright 2026 Ix Infrastructure Inc.

// Ix#841 (CL-13): after an incremental `ix map`, Ix defers the architecture
// map and serves the last map's regions until a region view refreshes it. It
// says so with `map_stale` / `regions_as_of` (json), `map_stale=true
// regions_as_of_rev=N regions_as_of_files=F` on the llm `map` record, and one
// stderr line from a region view (which answers from the last map and starts a
// background refresh), plus a `diagnostic code=map_stale` llm record.
// ix-subsystems labels its counts then; with the fields absent (older Ix) or
// fresh, its output is exactly what it was.
import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import * as ixSubsystems from "../dist/tools/ix-subsystems.js";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import { mapStaleFromJson, mapStaleFromLlm, mapStaleNote } from "../dist/runtime/map-stale.js";

// `ix subsystems --format json` / `--format llm` in the shape v0.12.0 prints.
const SUBSYSTEMS = {
  file_count: 38,
  region_count: 2,
  levels: 2,
  map_rev: 9,
  outcome: "full_local_completed",
  regions: [
    { label: "Tools", label_kind: "system", level: 2, files: 24, children: 1, parent_id: null, confidence: 0.78, signals: ["calls"], interfaces: 3 },
    { label: "Runtime", label_kind: "module", level: 1, files: 8, children: 0, parent_id: "t", confidence: 0.4, signals: ["path"], interfaces: 2 },
  ],
};
const LLM = [
  "map files=38 regions=2 levels=2 rev=9 outcome=full_local_completed",
  "region id=aaaa1111 kind=system label=Tools level=2 files=24 confidence=0.78 signals=calls",
  "region id=bbbb2222 kind=module label=Runtime level=1 files=8 parent=aaaa1111 confidence=0.40 signals=path",
  "",
].join("\n");
const LLM_STALE = LLM.replace(/^(map [^\n]*)/, "$1 map_stale=true regions_as_of_rev=7 regions_as_of_files=36");

const STDERR_LINE =
  "ix: architecture map is stale (another ix map is running); regions shown may predate recent edits. Run ix map --remap to refresh.";
const NOTE_NAMED = "_Stale map: regions as of map rev 7, 36 files; the map is refreshing — re-run after it completes._";
const NOTE_PLAIN = "_Stale map: regions are from the previous map; the map is refreshing — re-run after it completes._";
// The stderr line for a refresh that was debounced or failed (Ix#841 `ensureFreshMap`).
const staleLine = (why) =>
  `ix: architecture map is stale (${why}); regions shown may predate recent edits. Run ix map --remap to refresh.`;
const NOTE_REMAP_NAMED =
  "_Stale map: regions as of map rev 7, 36 files; not recomputed since recent edits — run `ix map --remap` to refresh._";
const NOTE_REMAP_PLAIN =
  "_Stale map: regions are from the previous map; not recomputed since recent edits — run `ix map --remap` to refresh._";

// The JSON-path output as it was before Ix#841.
const UNCHANGED = [
  "## ix-subsystems",
  "",
  "**2 subsystems** — 38 files, 2 levels",
  "",
  "| Subsystem | Kind | Level | Files | Children | Interfaces | Confidence |",
  "|-----------|------|-------|-------|----------|------------|------------|",
  "| Tools | system | 2 | 24 | 1 | 3 | 0.78 |",
  "| Runtime | module | 1 | 8 | 0 | 2 | 0.40 |",
  "",
  "_Outcome: full_local_completed_",
].join("\n");

async function run(answer, { llm = false } = {}) {
  const ix = installFakeIx();
  const previous = process.env.IX_DISABLE_LLM_FORMAT;
  process.env.IX_DISABLE_LLM_FORMAT = llm ? "" : "1";
  resetLlmVersionCache();
  try {
    ix.setSubsystems(answer);
    return await ixSubsystems.execute({}, { directory: ix.dir });
  } finally {
    if (previous === undefined) delete process.env.IX_DISABLE_LLM_FORMAT;
    else process.env.IX_DISABLE_LLM_FORMAT = previous;
    resetLlmVersionCache();
    ix.restore();
  }
}

test("mapStale helpers: absent or fresh is null, stale names the map when Ix did", () => {
  assert.equal(mapStaleFromJson(SUBSYSTEMS), null);
  assert.equal(mapStaleFromJson({ ...SUBSYSTEMS, map_stale: false, regions_as_of: null }), null);
  assert.equal(mapStaleFromJson(SUBSYSTEMS, "some other warning\n"), null);
  assert.equal(mapStaleFromLlm(LLM), null);
  assert.deepEqual(mapStaleFromJson({ map_stale: true, regions_as_of: { map_rev: 7, file_count: 36 } }), { rev: 7, files: 36 });
  assert.deepEqual(mapStaleFromJson({ regions_as_of: { map_rev: 7, file_count: 36 } }), { rev: 7, files: 36 });
  assert.deepEqual(mapStaleFromJson(SUBSYSTEMS, `\u001b[2m${STDERR_LINE}\u001b[22m\n`), {
    rev: undefined,
    files: undefined,
    reason: "another ix map is running",
  });
  assert.deepEqual(mapStaleFromLlm(LLM_STALE), { rev: 7, files: 36 });
  assert.deepEqual(mapStaleFromLlm(LLM, STDERR_LINE), { rev: undefined, files: undefined, reason: "another ix map is running" });
  assert.equal(mapStaleNote({ rev: 7, files: 36 }), NOTE_NAMED);
  assert.equal(mapStaleNote({}), NOTE_PLAIN);
  assert.equal(mapStaleNote({ reason: "another ix map is running" }), NOTE_PLAIN);
});

test("mapStale helpers: a refresh under way says re-run shortly", () => {
  for (const why of ["refreshing in background", "another ix map is running"]) {
    const stale = mapStaleFromJson(SUBSYSTEMS, `${staleLine(why)}\n`);
    assert.deepEqual(stale, { rev: undefined, files: undefined, reason: why });
    assert.equal(mapStaleNote(stale), NOTE_PLAIN);
    assert.equal(mapStaleNote(mapStaleFromLlm(LLM, `\u001b[2m${staleLine(why)}\u001b[22m\n`)), NOTE_PLAIN);
    assert.equal(mapStaleNote({ rev: 7, files: 36, reason: why }), NOTE_NAMED);
  }
});

test("mapStale helpers: a debounced, failed, unstartable or disabled refresh points to ix map --remap, not a re-run", () => {
  for (const why of [
    "its last background refresh failed",
    "its refresh could not start",
    "its refresh failed",
    "a refresh was tried moments ago",
    "background refresh is off",
    // Older #841 builds; still harmless.
    "its refresh did not complete",
    "files changed while it was refreshed",
    // A reason this plugin does not know yet: the same as today.
    "some future reason",
  ]) {
    const stale = mapStaleFromJson(SUBSYSTEMS, `${staleLine(why)}\n`);
    assert.deepEqual(stale, { rev: undefined, files: undefined, reason: why });
    assert.equal(mapStaleNote(stale), NOTE_REMAP_PLAIN);
    assert.equal(mapStaleNote(mapStaleFromLlm(LLM, `\u001b[2m${staleLine(why)}\u001b[22m\n`)), NOTE_REMAP_PLAIN);
  }
  assert.equal(mapStaleNote({ rev: 7, files: 36, reason: "its refresh failed" }), NOTE_REMAP_NAMED);
});

test("ix-subsystems json: absent and fresh fields leave the output byte-identical", async () => {
  assert.equal(await run({ json: SUBSYSTEMS }), UNCHANGED);
  assert.equal(await run({ json: { ...SUBSYSTEMS, map_stale: false, regions_as_of: null } }), UNCHANGED);
});

test("ix-subsystems json: a stale map labels the counts", async () => {
  const stale = await run({ json: { ...SUBSYSTEMS, map_stale: true, regions_as_of: { map_rev: 7, file_count: 36 } } });
  assert.equal(stale, UNCHANGED.replace("2 levels\n", `2 levels\n${NOTE_NAMED}\n`));
  const viaStderr = await run({ json: SUBSYSTEMS, stderr: STDERR_LINE });
  assert.equal(viaStderr, UNCHANGED.replace("2 levels\n", `2 levels\n${NOTE_PLAIN}\n`));
});

test("ix-subsystems: a debounced or failed refresh points to ix map --remap", async () => {
  const json = await run({ json: SUBSYSTEMS, stderr: staleLine("a refresh was tried moments ago") });
  assert.equal(json, UNCHANGED.replace("2 levels\n", `2 levels\n${NOTE_REMAP_PLAIN}\n`));
  const llm = await run({ llm: LLM_STALE, stderr: staleLine("its refresh failed") }, { llm: true });
  assert.equal(llm, `## ix-subsystems\n\n${NOTE_REMAP_NAMED}\n\n${LLM_STALE.trim()}`);
});

test("ix-subsystems llm: unchanged when fresh, labelled when stale", async () => {
  assert.equal(await run({ llm: LLM }, { llm: true }), `## ix-subsystems\n\n${LLM.trim()}`);
  assert.equal(await run({ llm: LLM_STALE }, { llm: true }), `## ix-subsystems\n\n${NOTE_NAMED}\n\n${LLM_STALE.trim()}`);
  assert.equal(await run({ llm: LLM, stderr: STDERR_LINE }, { llm: true }), `## ix-subsystems\n\n${NOTE_PLAIN}\n\n${LLM.trim()}`);
});

const DIAGNOSTIC =
  'diagnostic code=map_stale message="Stale map: not recomputed after this edit. Every count and region here is from the last map (map rev 7, 36 files). Run ix map --remap to recompute it now; region views refresh it in the background."';

test("mapStale helpers: a diagnostic code=map_stale record counts as the map record's flag", () => {
  const withDiag = LLM_STALE.replace(/^(map [^\n]*)/, `$1\n${DIAGNOSTIC}`);
  assert.deepEqual(mapStaleFromLlm(withDiag), { rev: 7, files: 36 });
  assert.deepEqual(mapStaleFromLlm(LLM.replace(/^(map [^\n]*)/, `$1\n${DIAGNOSTIC}`)), { rev: undefined, files: undefined });
  assert.equal(mapStaleFromLlm(LLM.replace(/^(map [^\n]*)/, '$1\ndiagnostic code=other message="map_stale"')), null);
});

test("ix-subsystems llm: a diagnostic code=map_stale record is kept and parsed without breaking", async () => {
  const withDiag = LLM_STALE.replace(/^(map [^\n]*)/, `$1\n${DIAGNOSTIC}`);
  const out = await run({ llm: withDiag, stderr: staleLine("refreshing in background") }, { llm: true });
  assert.equal(out, `## ix-subsystems\n\n${NOTE_NAMED}\n\n${withDiag.trim()}`);
});

test("ix-subsystems: each stderr reason picks its note", async () => {
  for (const why of ["refreshing in background", "another ix map is running"]) {
    assert.equal(await run({ llm: LLM, stderr: staleLine(why) }, { llm: true }), `## ix-subsystems\n\n${NOTE_PLAIN}\n\n${LLM.trim()}`);
    assert.equal(await run({ json: SUBSYSTEMS, stderr: staleLine(why) }), UNCHANGED.replace("2 levels\n", `2 levels\n${NOTE_PLAIN}\n`));
  }
  for (const why of ["its last background refresh failed", "its refresh could not start", "background refresh is off"]) {
    assert.equal(await run({ llm: LLM, stderr: staleLine(why) }, { llm: true }), `## ix-subsystems\n\n${NOTE_REMAP_PLAIN}\n\n${LLM.trim()}`);
    assert.equal(await run({ json: SUBSYSTEMS, stderr: staleLine(why) }), UNCHANGED.replace("2 levels\n", `2 levels\n${NOTE_REMAP_PLAIN}\n`));
  }
});
