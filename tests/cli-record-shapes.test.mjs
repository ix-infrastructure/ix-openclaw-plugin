// Copyright 2026 Ix Infrastructure Inc.

// Issue #67: seven tools read `ix ... --format json` fields the ix CLI never
// printed, so a successful answer rendered as "not found", "none", "unknown"
// or "[object Object]". Each test below feeds a tool one record in the shape
// the CLI prints and asserts on a value taken from that record.
//
// The records follow the field names recorded from ix v0.12.0 in issue #67:
//   locate     {resolvedTarget, lineRange, container, systemPath, ...}
//   callers    {results: [{name, kind, path, site}]}   (callees the same)
//   depends    {resolvedTarget, tree}
//   subsystems {regions: [{label, files, cohesion, coupling, ...}]}
//   subsystems --list  {scores: [{name, level, health, files}]}
//   stats      {nodes: {total, byKind}, edges: {total, byPredicate: [{predicate, count}]}}
//   status     {graphCompleted, mapCompleted, currentRev, staleFiles, lastIngestAt}
//   overview   {keyItems, childrenByKind, ...}
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installFakeIx } from "./fake-ix.mjs";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";
import * as ixHealth from "../dist/tools/ix-health.js";
import * as ixIngest from "../dist/tools/ix-ingest.js";
import * as ixMap from "../dist/tools/ix-map.js";
import * as ixNeighbors from "../dist/tools/ix-neighbors.js";
import * as ixQuery from "../dist/tools/ix-query.js";
import * as ixStats from "../dist/tools/ix-stats.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { directory: projectRoot };

const LOCATE = {
  resolvedTarget: { id: "8c1d2e", kind: "function", name: "runIx", path: "tools/base.ts" },
  resolutionMode: "exact",
  lineRange: { start: 47, end: 63 },
  container: { id: "77ab01", kind: "file", name: "base.ts" },
  systemPath: [{ name: "Tools", kind: "region" }],
  diagnostics: [],
};

const EXPLAIN = {
  resolvedTarget: { kind: "function", name: "runIx", path: "tools/base.ts" },
  role: { role: "utility", confidence: "high", reasons: ["called from many files"] },
  importance: { level: "high", category: "shared" },
  facts: { callerCount: 14, calleeCount: 2 },
};

const CALLERS = {
  results: [
    { name: "runIxJson", kind: "function", path: "tools/base.ts", site: { line: 70 } },
    { name: "execute", kind: "function", path: "tools/ix-ingest.ts", site: { line: 59 } },
  ],
  resultSource: "graph",
};

const CALLEES = {
  results: [{ name: "spawn", kind: "function", path: "node:child_process", site: { line: 50 } }],
  resultSource: "graph",
};

const DEPENDS = {
  resolvedTarget: { kind: "function", name: "runIx", path: "tools/base.ts" },
  tree: [
    {
      name: "runIxJson",
      kind: "function",
      path: "tools/base.ts",
      children: [{ name: "execute", kind: "function", path: "tools/ix-map.ts", children: [] }],
    },
  ],
};

const SUBSYSTEMS = {
  regions: [
    { label: "Tools", label_kind: "module", level: 1, files: 19, children: 0, interfaces: 4, confidence: 0.82, cohesion: 0.71, coupling: 0.22 },
    { label: "Runtime", label_kind: "module", level: 1, files: 6, children: 0, interfaces: 2, confidence: 0.64, cohesion: 0.31, coupling: 0.58 },
  ],
  file_count: 25,
  levels: 1,
};

const SUBSYSTEM_SCORES = {
  scores: [
    { name: "Tools", level: 1, health: 0.8, files: 19 },
    { name: "Runtime", level: 1, health: 0.6, files: 6 },
  ],
};

const STATS = {
  nodes: { total: 812, byKind: [{ kind: "file", count: 41 }, { kind: "function", count: 390 }] },
  edges: { total: 2104, byPredicate: [{ predicate: "CALLS", count: 1300 }, { predicate: "IMPORTS", count: 210 }] },
};

const STATUS = {
  graphCompleted: true,
  mapCompleted: true,
  currentRev: 42,
  staleFiles: 3,
  lastIngestAt: "2026-11-09T10:12:00Z",
};

const OVERVIEW = {
  resolvedTarget: { kind: "file", name: "base.ts", path: "tools/base.ts" },
  keyItems: [
    { name: "runIx", kind: "function" },
    { name: "parseIxJson", kind: "function" },
  ],
  childrenByKind: { function: 12, class: 1 },
};

const CRASH = /\[object Object\]|undefined|NaN/;

function withFake(fn) {
  return async () => {
    const ix = installFakeIx();
    resetLlmVersionCache();
    try {
      await fn(ix);
    } finally {
      ix.restore();
      resetLlmVersionCache();
    }
  };
}

test("ix-query prints the kind and path of a symbol ix locate resolved", withFake(async (ix) => {
  ix.setRecord("locate", LOCATE);
  ix.setRecord("explain", EXPLAIN);
  const out = await ixQuery.execute({ symbol: "runIx" }, ctx);
  assert.doesNotMatch(out, /No matches found/, out);
  assert.match(out, /\*\*Kind:\*\* function/, out);
  assert.match(out, /\*\*Path:\*\* tools\/base\.ts:47/, out);
  assert.match(out, /\*\*Subsystem:\*\* Tools/, out);
  assert.match(out, /\*\*Role:\*\* utility/, out);
  assert.match(out, /\*\*Callers:\*\* 14/, out);
  assert.doesNotMatch(out, CRASH, out);
  // Explain is asked about the entity locate resolved.
  const explain = ix.calls().find((call) => call.argv[0] === "explain");
  assert.equal(explain?.argv[1], "runIx");
}));

test("ix-query still shows what locate resolved when explain has nothing", withFake(async (ix) => {
  ix.setRecord("locate", LOCATE);
  const out = await ixQuery.execute({ symbol: "runIx" }, ctx);
  assert.match(out, /\*\*Kind:\*\* function/, out);
  assert.match(out, /\*\*Path:\*\* tools\/base\.ts:47/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-query says not found only when locate resolved nothing", withFake(async (ix) => {
  // The fake's default locate answer is {resolvedTarget: null}.
  const out = await ixQuery.execute({ symbol: "nope" }, ctx);
  assert.match(out, /No matches found/, out);
}));

test("ix-query shows the candidates of an ambiguous locate that exits 0", withFake(async (ix) => {
  ix.setRecord("locate", {
    code: "ambiguous_target",
    candidates: [
      { name: "parse", kind: "function", path: "src/config/parse.ts", line: 12, pick: 1 },
      { name: "parse", kind: "method", path: "src/json/reader.ts", line: 40, pick: 2 },
    ],
  });
  const out = await ixQuery.execute({ symbol: "parse" }, ctx);
  assert.match(out, /Ambiguous target/, out);
  assert.ok(out.includes("src/json/reader.ts:40"), out);
}));

test("ix-neighbors lists the rows ix callers and ix callees return", withFake(async (ix) => {
  ix.setRecord("callers", CALLERS);
  ix.setRecord("callees", CALLEES);
  const out = await ixNeighbors.execute({ symbol: "runIx" }, ctx);
  assert.doesNotMatch(out, /\*\*callers:\*\* none/, out);
  assert.match(out, /\*\*Callers\*\* \(2\):/, out);
  assert.match(out, /- `runIxJson` \(function\) — tools\/base\.ts/, out);
  assert.match(out, /- `execute` \(function\) — tools\/ix-ingest\.ts/, out);
  assert.match(out, /\*\*Callees\*\* \(1\):/, out);
  assert.match(out, /- `spawn` \(function\) — node:child_process/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-neighbors says none when ix callers returns no rows", withFake(async (ix) => {
  ix.setRecord("callers", { results: [], resultSource: "graph" });
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "callers" }, ctx);
  assert.match(out, /\*\*callers:\*\* none/, out);
}));

test("ix-neighbors renders the dependency tree ix depends returns", withFake(async (ix) => {
  ix.setRecord("depends", DEPENDS);
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "depends", depth: 2 }, ctx);
  assert.match(out, /\*\*Depends\*\*/, out);
  assert.match(out, /- `runIxJson` \(function\) — tools\/base\.ts/, out);
  assert.match(out, / {2}- `execute` \(function\) — tools\/ix-map\.ts/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-map prints region labels, file counts and the codebase totals", withFake(async (ix) => {
  ix.setRecord("subsystems", SUBSYSTEMS);
  ix.setRecord("subsystems --list", SUBSYSTEM_SCORES);
  ix.setRecord("stats", STATS);
  const out = await ixMap.execute({}, ctx);
  assert.match(out, /\| Tools \| 19 \| 0\.71 \| 0\.22 \|/, out);
  // Low cohesion and high coupling are flagged.
  assert.match(out, /\| Runtime ⚠ \| 6 \| 0\.31 \| 0\.58 \|/, out);
  assert.match(out, /\*\*Subsystem names:\*\* Tools, Runtime/, out);
  assert.match(out, /\*\*Codebase:\*\* 41 files · 812 nodes · 2104 edges/, out);
  assert.doesNotMatch(out, /unknown/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-ingest status reads the fields ix status prints", withFake(async (ix) => {
  ix.setRecord("status", STATUS);
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Graph ingested:\*\* yes/, out);
  assert.match(out, /\*\*Architecture map:\*\* built/, out);
  assert.match(out, /\*\*Revision:\*\* 42/, out);
  assert.match(out, /\*\*Last ingest:\*\* 2026-11-09T10:12:00Z/, out);
  assert.match(out, /\*\*Freshness:\*\* 3 stale files/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-ingest status says to map when ix status reports no graph", withFake(async (ix) => {
  ix.setRecord("status", { graphCompleted: false, mapCompleted: false, currentRev: 0, staleFiles: 0 });
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Graph ingested:\*\* no — run `ix map`/, out);
  assert.match(out, /\*\*Architecture map:\*\* not built/, out);
}));

test("ix-ingest falls back to the subsystem scores when ix status has no JSON", withFake(async (ix) => {
  ix.setRecord("subsystems --list", SUBSYSTEM_SCORES);
  // The fake's status prints JSON; make it print text only.
  ix.setRecord("status", "not json");
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Subsystems found:\*\* 2 \(Tools, Runtime\)/, out);
}));

test("ix-health reads the fields ix status prints", withFake(async (ix) => {
  ix.setRecord("status", STATUS);
  const out = await ixHealth.execute({}, ctx);
  assert.match(out, /\*\*Status:\*\* OK/, out);
  assert.match(out, /\*\*Graph:\*\* indexed \(rev 42\)/, out);
  assert.match(out, /\*\*Freshness:\*\* 3 stale files/, out);
  assert.match(out, /\*\*Last ingest:\*\* 2026-11-09T10:12:00Z/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-health reports a degraded graph when ix status says the graph is not built", withFake(async (ix) => {
  ix.setRecord("status", { graphCompleted: false, mapCompleted: false, currentRev: 0, staleFiles: 0 });
  const out = await ixHealth.execute({}, ctx);
  assert.match(out, /\*\*Status:\*\* DEGRADED/, out);
}));

test("ix-docs-tool reads stats totals and the overview's key items", withFake(async (ix) => {
  ix.setRecord("locate", LOCATE);
  ix.setRecord("overview", OVERVIEW);
  ix.setRecord("stats", STATS);
  ix.setRecord("explain", EXPLAIN);
  const out = await ixDocsTool.execute({ target: "tools/base.ts" }, ctx);
  assert.match(out, /_41 files · 812 nodes_/, out);
  assert.match(out, /\*\*Key Components:\*\*/, out);
  assert.match(out, /- `runIx` \(14 callers\) — utility/, out);
  assert.match(out, /- `parseIxJson`/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-stats lists edges by the predicate ix prints", withFake(async (ix) => {
  ix.setRecord("stats", STATS);
  const out = await ixStats.execute({}, ctx);
  assert.match(out, /- Files indexed: 41/, out);
  assert.match(out, /- CALLS: 1300/, out);
  assert.match(out, /- IMPORTS: 210/, out);
}));
