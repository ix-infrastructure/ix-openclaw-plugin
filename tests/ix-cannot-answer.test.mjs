// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { impactRecord, installFakeIx } from "./fake-ix.mjs";
import * as ixDecide from "../dist/tools/ix-decide.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";

// ix-decide's verdict gates edits: REVIEW makes OpenClaw stop and ask the user
// (allow-once/deny). It is kept for changes ix measured as risky. When ix
// cannot answer, or the file is new, the verdict is ALLOW with a note.
//
// The error records below are the ones ix v0.12.0 prints for `impact --format
// json` (exit 1), checked against the released CLI and a throwaway backend.
const NOT_IN_GRAPH = {
  error: "unresolved_target",
  message: '"src/new.ts" exists on disk but is not in the graph: it has not been ingested yet (run `ix map`), or it is ignored or of a type Ix does not parse.',
  reason: "file_not_in_graph",
};
const NOT_ON_DISK = {
  error: "unresolved_target",
  message: 'No file "src/new.ts" in the graph, and none at that path on disk.',
  reason: "file_not_found",
};
const EMPTY_GRAPH = {
  ...NOT_IN_GRAPH,
  graph: { status: "empty", reason: "no_nodes", fix: "ix map", nodes: 0, edges: 0 },
};

async function decide(paths) {
  return ixDecide.execute({ touched_paths: paths }, { directory: process.cwd() });
}

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

test("ix-decide allows, with a note, when the workspace is not mapped", withFake(async (ix) => {
  ix.setUnmapped();
  const out = await decide(["src/a.ts"]);
  assert.match(out, /Verdict:\*\* ALLOW/);
  assert.match(out, /Risk:\*\* UNKNOWN/);
  assert.match(out, /Not assessed \(Ix unavailable\):\*\* `src\/a\.ts`/);
  assert.match(out, /Ix unavailable: it could not assess this edit \(`workspace_not_mapped`\)/);
  assert.doesNotMatch(out, /Safe to proceed/);
}));

test("ix-decide allows, with a note, when the backend is unreachable", withFake(async (ix) => {
  ix.setUnreachable();
  const out = await decide(["src/a.ts"]);
  assert.match(out, /Verdict:\*\* ALLOW/);
  assert.match(out, /Ix unavailable: it could not assess this edit \(Error: fetch failed \(bad port\)\)/);
  assert.doesNotMatch(out, /\u001b/, "ix's ANSI colour must not reach the model");
}));

test("ix-decide allows, with a note, when ix is not installed", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "no-ix-"));
  const previous = process.env.PATH;
  process.env.PATH = [empty, "/usr/bin", "/bin"].join(path.delimiter);
  try {
    const out = await decide(["src/a.ts"]);
    assert.match(out, /Verdict:\*\* ALLOW/);
    assert.match(out, /ix is not installed/);
  } finally {
    process.env.PATH = previous;
    rmSync(empty, { recursive: true, force: true });
  }
});

test("ix-decide allows a new file as low risk, not as unavailable", withFake(async (ix) => {
  ix.setImpact({ "src/new.ts": NOT_IN_GRAPH, "src/created.ts": NOT_ON_DISK });
  for (const file of ["src/new.ts", "src/created.ts"]) {
    const out = await decide([file]);
    assert.match(out, /Verdict:\*\* ALLOW/, file);
    assert.match(out, /Risk:\*\* LOW/, file);
    assert.ok(out.includes(`**New (not in the graph yet):** \`${file}\``), `${file}:\n${out}`);
    assert.match(out, /new files have no dependents/, file);
    assert.doesNotMatch(out, /unavailable|Not assessed/i, file);
  }
}));

test("ix-decide does not call a miss on an empty graph a new file", withFake(async (ix) => {
  ix.setImpact({ "src/new.ts": EMPTY_GRAPH });
  const out = await decide(["src/new.ts"]);
  assert.match(out, /Verdict:\*\* ALLOW/);
  assert.match(out, /Not assessed \(Ix unavailable\):\*\* `src\/new\.ts`/);
  assert.match(out, /the workspace graph is empty/);
  assert.doesNotMatch(out, /New \(not in the graph yet\)/);
}));

test("ix-decide still reviews a measured risky file beside an unassessed or new one", withFake(async (ix) => {
  ix.setImpact({ "src/hub.ts": impactRecord({ riskLevel: "medium", importers: 2, memberCallers: 6 }), "src/b.ts": "FAIL", "src/new.ts": NOT_IN_GRAPH });
  const out = await decide(["src/hub.ts", "src/b.ts", "src/new.ts"]);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /`src\/hub\.ts` — MEDIUM, 6 dependents/);
  assert.match(out, /`src\/b\.ts` — NOT ASSESSED/);
  assert.match(out, /`src\/new\.ts` — NEW/);
}));

test("ix-decide allows a measured low-risk file and names an unassessed one beside it", withFake(async (ix) => {
  ix.setImpact({ "src/a.ts": impactRecord({ riskLevel: "low", importers: 1, memberCallers: 1 }), "src/b.ts": "FAIL" });
  const one = await decide(["src/a.ts"]);
  assert.match(one, /Verdict:\*\* ALLOW/);
  assert.match(one, /Safe to proceed\. Verify affected callers/);
  const both = await decide(["src/a.ts", "src/b.ts"]);
  assert.match(both, /Verdict:\*\* ALLOW/);
  assert.match(both, /could not assess 1 of 2 files/);
  assert.match(both, /Not assessed \(Ix unavailable\):\*\* `src\/b\.ts`/);
}));

test("ix-decide measures every path, not just the first five", withFake(async (ix) => {
  const files = Array.from({ length: 9 }, (_, i) => `src/f${i}.ts`);
  // Only the eighth file is risky; it used to go unmeasured and unreported.
  ix.setImpact({ "src/f7.ts": impactRecord({ riskLevel: "high", importers: 3, memberCallers: 2 }) });
  const out = await decide(files);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /`src\/f7\.ts` — HIGH, 3 dependents/);
  const measured = ix.calls().filter((call) => call.argv[0] === "impact").map((call) => call.argv[1]);
  assert.deepEqual(measured.sort(), [...files].sort());
}));

test("ix-docs-tool reports ix's error record instead of an empty section", async () => {
  const ix = installFakeIx();
  try {
    ix.setUnmapped();
    const out = await ixDocsTool.execute({ target: "tools/base.ts", depth: "brief" }, { directory: ix.dir });
    assert.match(out, /ix could not answer:\*\* `workspace_not_mapped`/);
    assert.doesNotMatch(out, /## Context:/);
  } finally {
    ix.restore();
  }
});

test("ix-docs-tool says ix is unavailable, not \"not found\", when the backend is down", async () => {
  const ix = installFakeIx();
  try {
    ix.setUnreachable();
    const out = await ixDocsTool.execute({ target: "tools/base.ts", depth: "brief" }, { directory: ix.dir });
    assert.match(out, /^## ix-docs-tool: tools\/base\.ts/);
    assert.match(out, /ix unavailable/);
    assert.match(out, /fetch failed/);
    assert.doesNotMatch(out, /\u001b/, "ix's ANSI colour must not reach the model");
    assert.doesNotMatch(out, /Not found in graph/);
  } finally {
    ix.restore();
  }
});
