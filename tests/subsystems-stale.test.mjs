// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import * as ixSubsystems from "../dist/tools/ix-subsystems.js";

// Since Ix #841 the architecture map can lag recent edits: automatic maps
// defer, and region readers answer from the last map (refreshing it in the
// background unless that is off, failed or could not start). `ix subsystems` says so with `map_stale: true` (+
// `regions_as_of`) in JSON and a `diagnostic code=map_stale` record in llm.
// ix-subsystems turns either into one line under its heading. An ix that
// does not emit them (fresh map, or an older CLI) must give exactly the
// output the tool gave before.

function withFake(fn) {
  return async () => {
    const ix = installFakeIx();
    try {
      await fn(ix);
    } finally {
      ix.restore();
    }
  };
}

const context = () => ({ directory: process.cwd() });

const FRESH_JSON = {
  regions: [
    { label: "Core", label_kind: "module", level: 1, files: 12, children: 2, interfaces: 3, confidence: 0.912 },
    { label: "Tools", label_kind: "subsystem", level: 2, files: 5, children: 0, interfaces: 1, confidence: 0.7 },
  ],
  file_count: 17,
  levels: 2,
};

// The tool's output for FRESH_JSON as it was before stale handling existed.
const FRESH_JSON_OUTPUT = [
  "## ix-subsystems",
  "",
  "**2 subsystems** — 17 files, 2 levels",
  "",
  "| Subsystem | Kind | Level | Files | Children | Interfaces | Confidence |",
  "|-----------|------|-------|-------|----------|------------|------------|",
  "| Core | module | 1 | 12 | 2 | 3 | 0.91 |",
  "| Tools | subsystem | 2 | 5 | 0 | 1 | 0.70 |",
].join("\n");

const STALE_LINE_AT =
  "_Map is stale (regions as of 2026-10-24 09:30 UTC); recent edits may not be reflected — run `ix map --remap` to refresh it now._";
const STALE_LINE =
  "_Map is stale; recent edits may not be reflected — run `ix map --remap` to refresh it now._";

const withStaleLine = (output, line) =>
  output.replace("## ix-subsystems\n\n", `## ix-subsystems\n\n${line}\n\n`);

const LLM_RECORDS = [
  "region label=Core kind=module level=1 files=12 children=2 interfaces=3 confidence=0.91",
  "region label=Tools kind=subsystem level=2 files=5 children=0 interfaces=1 confidence=0.70",
].join("\n");

const STALE_DIAGNOSTIC =
  'diagnostic code=map_stale regions_as_of="2026-10-24T09:30:00Z" message="Stale map: not recomputed after this edit. Run ix map --remap to recompute it now."';

// --- JSON path (no llm answer) ---------------------------------------------

test("JSON path: no map_stale gives the same output as before", withFake(async (ix) => {
  ix.setSubsystems({ json: FRESH_JSON });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, FRESH_JSON_OUTPUT);
}));

test("JSON path: map_stale false gives the same output as before", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: false, regions_as_of: "2026-10-24T09:30:00Z" } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, FRESH_JSON_OUTPUT);
}));

test("JSON path: map_stale true with regions_as_of adds one line under the heading", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of: "2026-10-24T09:30:00Z" } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_AT));
}));

test("JSON path: map_stale true without regions_as_of still says the map is stale", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE));
}));

test("JSON path: an unreadable regions_as_of is shown as given, an odd type is dropped", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of: "last tuesday" } });
  let out = await ixSubsystems.execute({}, context());
  assert.match(out, /^## ix-subsystems\n\n_Map is stale \(regions as of last tuesday\); /);

  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of: { when: "now" } } });
  out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE));
}));

test("JSON path: a stale map with no regions keeps the stale line and the no-subsystems hint", withFake(async (ix) => {
  ix.setSubsystems({ json: { regions: [], map_stale: true, regions_as_of: "2026-10-24T09:30:00Z" } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(
    out,
    ["## ix-subsystems", "", STALE_LINE_AT, "", "**No subsystems found.** Run `ix map` to build the graph."].join("\n"),
  );
}));

test("JSON path: no regions and no map_stale gives the same output as before", withFake(async (ix) => {
  ix.setSubsystems({ json: { regions: [] } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, ["## ix-subsystems", "", "**No subsystems found.** Run `ix map` to build the graph."].join("\n"));
}));

// --- llm fast path -----------------------------------------------------------

test("llm path: no diagnostic passes the records through unchanged", withFake(async (ix) => {
  ix.setSubsystems({ llm: LLM_RECORDS + "\n" });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${LLM_RECORDS}`);
}));

test("llm path: a map_stale diagnostic becomes the stale line, not a raw record", withFake(async (ix) => {
  for (const llm of [
    `${STALE_DIAGNOSTIC}\n${LLM_RECORDS}\n`,
    `${LLM_RECORDS}\n${STALE_DIAGNOSTIC}\n`,
  ]) {
    ix.setSubsystems({ llm });
    const out = await ixSubsystems.execute({}, context());
    assert.equal(out, `## ix-subsystems\n\n${STALE_LINE_AT}\n\n${LLM_RECORDS}`);
    assert.doesNotMatch(out, /code=map_stale/);
  }
}));

test("llm path: an unquoted or missing regions_as_of is tolerated", withFake(async (ix) => {
  ix.setSubsystems({ llm: `diagnostic code=map_stale regions_as_of=yesterday\n${LLM_RECORDS}\n` });
  let out = await ixSubsystems.execute({}, context());
  assert.match(out, /^## ix-subsystems\n\n_Map is stale \(regions as of yesterday\); /);

  // tryLlm's secret scrubber reads an unquoted `regions_as_of=<ISO time>` as
  // one high-entropy token and redacts it. The record still becomes the stale
  // line, without the time and without the redaction marker.
  ix.setSubsystems({ llm: `diagnostic code=map_stale regions_as_of=2026-10-24T09:30:00Z\n${LLM_RECORDS}\n` });
  out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${STALE_LINE}\n\n${LLM_RECORDS}`);

  ix.setSubsystems({ llm: `diagnostic code=map_stale\n${LLM_RECORDS}\n` });
  out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${STALE_LINE}\n\n${LLM_RECORDS}`);
}));

test("llm path: other diagnostics are left in the body", withFake(async (ix) => {
  const other = 'diagnostic code=low_confidence message="Few files mapped."';
  ix.setSubsystems({ llm: `${other}\n${LLM_RECORDS}\n` });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${other}\n${LLM_RECORDS}`);
}));

test("llm path: a stale diagnostic alone falls back to the JSON answer", withFake(async (ix) => {
  ix.setSubsystems({
    llm: `${STALE_DIAGNOSTIC}\n`,
    json: { regions: [], map_stale: true, regions_as_of: "2026-10-24T09:30:00Z" },
  });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(
    out,
    ["## ix-subsystems", "", STALE_LINE_AT, "", "**No subsystems found.** Run `ix map` to build the graph."].join("\n"),
  );
}));

// --- regions_as_of formats and record matching -----------------------------

test("JSON path: epoch seconds and milliseconds both read as the same UTC time", withFake(async (ix) => {
  for (const regions_as_of of [1792834200, 1792834200000, "1792834200"]) {
    ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of } });
    const out = await ixSubsystems.execute({}, context());
    assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_AT), `regions_as_of=${regions_as_of}`);
  }
}));

test("JSON path: a date-time with no zone is shown as written, not labelled UTC", withFake(async (ix) => {
  for (const regions_as_of of ["2026-10-24 09:30:00", "2026-10-24T09:30"]) {
    ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of } });
    const out = await ixSubsystems.execute({}, context());
    assert.equal(
      out,
      withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_AT.replace("09:30 UTC", "09:30")),
      `regions_as_of=${regions_as_of}`,
    );
  }
}));

test("llm path: a quoted epoch regions_as_of is read as seconds", withFake(async (ix) => {
  ix.setSubsystems({ llm: `diagnostic code=map_stale regions_as_of="1792834200"\n${LLM_RECORDS}\n` });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${STALE_LINE_AT}\n\n${LLM_RECORDS}`);
}));

test("llm path: code=map_stale inside another diagnostic's message is not a stale record", withFake(async (ix) => {
  const other = 'diagnostic code=low_confidence message="see code=map_stale docs"';
  ix.setSubsystems({ llm: `${other}\n${LLM_RECORDS}\n` });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${other}\n${LLM_RECORDS}`);
}));

test("llm path: a stale diagnostic alone keeps the stale line when the JSON omits map_stale", withFake(async (ix) => {
  ix.setSubsystems({ llm: `${STALE_DIAGNOSTIC}\n`, json: FRESH_JSON });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_AT));
}));

// --- Ix's own regions_as_of: {map_rev, file_count} --------------------------

const STALE_LINE_REV =
  "_Map is stale (regions as of map rev 7, 42 files); recent edits may not be reflected — run `ix map --remap` to refresh it now._";

// Ix's map_stale record names the last map only in its message.
const IX_STALE_RECORD =
  'diagnostic code=map_stale message="Stale map: not recomputed after this edit. Every count and region here is from the last map (map rev 7, 42 files). Run ix map --remap to recompute it now; region views refresh it in the background."';

test("JSON path: regions_as_of {map_rev, file_count} names the map", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of: { map_rev: 7, file_count: 42 } } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_REV));
}));

test("JSON path: a 1-file map says \"1 file\"", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true, regions_as_of: { map_rev: 3, file_count: 1 } } });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, withStaleLine(FRESH_JSON_OUTPUT, STALE_LINE_REV.replace("map rev 7, 42 files", "map rev 3, 1 file")));
}));

test("llm path: the map named in Ix's record message is read, first record wins", withFake(async (ix) => {
  const second = 'diagnostic code=map_stale message="Stale map (map rev 9, 50 files)."';
  ix.setSubsystems({ llm: `${LLM_RECORDS.split("\n")[0]}\n${IX_STALE_RECORD}\n${second}\n${LLM_RECORDS.split("\n")[1]}\n` });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${STALE_LINE_REV}\n\n${LLM_RECORDS}`);
  assert.doesNotMatch(out, /code=map_stale/);
}));

test("llm path: a 1-file map in the record message says \"1 file\"", withFake(async (ix) => {
  ix.setSubsystems({ llm: `diagnostic code=map_stale message="Stale map (map rev 3, 1 file)."\n${LLM_RECORDS}\n` });
  const out = await ixSubsystems.execute({}, context());
  assert.equal(out, `## ix-subsystems\n\n${STALE_LINE_REV.replace("map rev 7, 42 files", "map rev 3, 1 file")}\n\n${LLM_RECORDS}`);
}));

test("the stale line does not promise a background refresh", withFake(async (ix) => {
  ix.setSubsystems({ json: { ...FRESH_JSON, map_stale: true } });
  const out = await ixSubsystems.execute({}, context());
  assert.doesNotMatch(out, /background refresh/);
}));
