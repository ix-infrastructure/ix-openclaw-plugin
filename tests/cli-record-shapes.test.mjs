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
// and, read from the ix CLI's smells command at v0.12.0 and v0.14.0 (issue #71):
//   smells --list  {count, inference_version, smells: [{smell, entity_id}]}
//                  `smell` is the claim kind ("has_smell.orphan_file"), `entity_id`
//                  12 characters. The CLI maps `s.confidence`, but the backend
//                  keeps it inside the claim's value, so JSON drops it. No file
//                  and no run_at; only a detection run prints those.
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
import * as ixSmells from "../dist/tools/ix-smells.js";
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

const SMELLS_LIST = {
  count: 2,
  inference_version: "smell_v1",
  smells: [
    { smell: "has_smell.orphan_file", entity_id: "a1b2c3d4e5f6" },
    { smell: "has_smell.orphan_file", entity_id: "0f9e8d7c6b5a" },
  ],
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

// Review of #75: the answers below are the other shapes those commands print.

test("ix-map lists the regions of a scope ix subsystems <scope> resolved", withFake(async (ix) => {
  // `ix subsystems <scope> --format json` prints the scope as `target` and its
  // regions under `children`, not `regions`.
  ix.setRecord("subsystems", {
    target: { label: "Tools", label_kind: "module", level: 1, files: 19, cohesion: 0.71, coupling: 0.22 },
    parent: null,
    summary: { files: 19, regions: 2 },
    hierarchy: [{ label: "Tools", level: 1 }],
    children: [
      { label: "Graph tools", label_kind: "subsystem", level: 2, files: 12, children: 0, cohesion: 0.66, coupling: 0.3 },
      { label: "Lookup", label_kind: "subsystem", level: 2, files: 7, children: 0, cohesion: 0.35, coupling: 0.2 },
    ],
  });
  ix.setRecord("subsystems --list", SUBSYSTEM_SCORES);
  const out = await ixMap.execute({ scope: "Tools", include_stats: false }, ctx);
  assert.doesNotMatch(out, /none found/, out);
  assert.match(out, /\*\*Subsystems in Tools\*\* \(2\):/, out);
  assert.match(out, /\| Graph tools \| 12 \| 0\.66 \| 0\.30 \|/, out);
  assert.match(out, /\| Lookup ⚠ \| 7 \| 0\.35 \| 0\.20 \|/, out);
  assert.doesNotMatch(out, CRASH, out);
  const scoped = ix.calls().find((call) => call.argv[0] === "subsystems" && !call.argv.includes("--list"));
  assert.equal(scoped?.argv[1], "Tools");
}));

test("ix-map says a resolved scope has no sub-regions instead of asking for a map", withFake(async (ix) => {
  ix.setRecord("subsystems", { target: { label: "Lookup", level: 2, files: 7 }, parent: { label: "Tools" }, children: [] });
  const out = await ixMap.execute({ scope: "Lookup", include_stats: false }, ctx);
  assert.match(out, /\*\*Subsystems in Lookup:\*\* none/, out);
  assert.doesNotMatch(out, /Run `ix map`/, out);
}));

test("ix-neighbors reports summary.total and says when ix truncated the callers", withFake(async (ix) => {
  ix.setRecord("callers", {
    results: CALLERS.results,
    resultSource: "graph",
    summary: { total: 42, truncated: true },
  });
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "callers", limit: 2 }, ctx);
  assert.match(out, /\*\*Callers\*\* \(42, showing 2\):/, out);
  assert.match(out, /- … 40 more/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-neighbors counts the caller rows ix could not resolve", withFake(async (ix) => {
  ix.setRecord("callers", {
    results: [
      CALLERS.results[0],
      { kind: "function", resolved: false, path: "tools/ix-map.ts", site: { line: 12 } },
      { kind: "function", resolved: false, path: "tools/ix-map.ts", site: { line: 30 } },
    ],
    resultSource: "graph",
    summary: { total: 3, truncated: false },
  });
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "callers" }, ctx);
  assert.match(out, /\*\*Callers\*\* \(3\):/, out);
  assert.match(out, /- `runIxJson` \(function\)/, out);
  assert.match(out, /- 2 unresolved references/, out);
  assert.doesNotMatch(out, /more/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-neighbors shows only unresolved callers instead of none", withFake(async (ix) => {
  ix.setRecord("callers", { results: [{ resolved: false, site: { line: 4 } }], resultSource: "graph" });
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "callers" }, ctx);
  assert.doesNotMatch(out, /\*\*callers:\*\* none/, out);
  assert.match(out, /- 1 unresolved reference /, out);
}));

test("ix-neighbors labels the text-search fallback as text matches, not callers", withFake(async (ix) => {
  ix.setRecord("callers", {
    results: [
      { name: "tools/base.ts:70", kind: "text-match", path: "tools/base.ts" },
      { name: "README.md:12", kind: "text-match", path: "README.md" },
    ],
    resultSource: "text",
    summary: { total: 2, truncated: false },
  });
  const out = await ixNeighbors.execute({ symbol: "runIx", direction: "callers" }, ctx);
  assert.match(out, /\*\*Callers: text matches\*\* \(2, from a text search, not the graph\):/, out);
  assert.match(out, /- `tools\/base\.ts:70`/, out);
  assert.doesNotMatch(out, /\(text-match\)/, out);
  assert.doesNotMatch(out, /\*\*Callers\*\* \(/, out);
}));

test("ix-ingest status shows no freshness for a graph that was never ingested", withFake(async (ix) => {
  // ix status prints staleFiles: 0 with no ingest baseline.
  ix.setRecord("status", { graphCompleted: false, mapCompleted: false, currentRev: 0, staleFiles: 0 });
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Graph ingested:\*\* no/, out);
  assert.doesNotMatch(out, /Freshness/, out);
}));

test("ix-ingest status still says up to date for an ingested graph with no stale files", withFake(async (ix) => {
  ix.setRecord("status", { ...STATUS, staleFiles: 0 });
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Freshness:\*\* up to date/, out);
}));

test("ix-query shows the source-text matches of a locate that fell back to text", withFake(async (ix) => {
  ix.setRecord("locate", {
    resolvedTarget: null,
    resolutionMode: "text",
    results: [
      { name: "tools/base.ts:47", kind: "text-match", path: "tools/base.ts" },
      { name: "docs/notes.md:3", kind: "text-match", path: "docs/notes.md" },
    ],
  });
  const out = await ixQuery.execute({ symbol: "runIx" }, ctx);
  assert.doesNotMatch(out, /No matches found/, out);
  assert.match(out, /Ix found 2 source-text matches/, out);
  assert.match(out, /- `tools\/base\.ts:47`/, out);
  assert.match(out, /- `docs\/notes\.md:3`/, out);
  assert.doesNotMatch(out, CRASH, out);
  // A text hit is not an entity: explain is not asked about it.
  assert.equal(ix.calls().some((call) => call.argv[0] === "explain"), false);
}));

test("ix-docs-tool's overview reads the target and child counts ix overview prints", withFake(async (ix) => {
  ix.setRecord("locate", LOCATE);
  ix.setRecord("overview", OVERVIEW);
  const out = await ixDocsTool.execute({ target: "tools/base.ts", depth: "brief" }, ctx);
  assert.match(out, /\*\*Kind:\*\* file/, out);
  assert.match(out, /\*\*Path:\*\* tools\/base\.ts/, out);
  assert.match(out, /\*\*Contains:\*\* 12 function, 1 class/, out);
  assert.doesNotMatch(out, CRASH, out);
}));

test("ix-smells lists the stored smells ix smells --list prints", withFake(async (ix) => {
  ix.setRecord("smells --list", SMELLS_LIST);
  const out = await ixSmells.execute({}, ctx);
  assert.match(out, /\*\*2 smells detected\*\*/, out);
  assert.match(out, /### orphan_file \(2\)/, out);
  assert.match(out, /- entity `a1b2c3d4e5f6`\n/, out);
  assert.match(out, /- entity `0f9e8d7c6b5a`\n/, out);
  assert.doesNotMatch(out, /has_smell\.|confidence/, out);
  assert.doesNotMatch(out, /sent no rows/, out);
  assert.doesNotMatch(out, CRASH, out);
  // A read: no detection run.
  assert.equal(ix.calls().some((call) => call.argv[0] === "smells" && !call.argv.includes("--list")), false);
}));
