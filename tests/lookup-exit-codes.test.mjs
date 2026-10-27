// Copyright 2026 Ix Infrastructure Inc.

// Ix#853: a graph lookup exits 2 (ambiguous target), 3 (not found) or 4
// (workspace not mapped) with its record on stdout. That is ix answering, not
// ix failing, so the tools show what ix said -- the candidates to pick from, the
// suggestions, how to map -- instead of "ix unavailable". An older ix exits 1
// with the same records, and is read the same way.
//
// The record shapes below follow the contract in Ix#853; the candidate and
// suggestion fields (name, kind, path, line, pick) are the ones the formatter
// reads.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { impactRecord, installFakeIx } from "./fake-ix.mjs";
import { IxCommandError, lookupOutcome, runIx } from "../dist/tools/base.js";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import * as ixQuery from "../dist/tools/ix-query.js";
import * as ixExplain from "../dist/tools/ix-explain.js";
import * as ixImpact from "../dist/tools/ix-impact.js";
import * as ixTrace from "../dist/tools/ix-trace.js";
import * as ixInventory from "../dist/tools/ix-inventory.js";
import * as ixLocate from "../dist/tools/ix-locate.js";
import * as ixNeighbors from "../dist/tools/ix-neighbors.js";
import * as ixDecide from "../dist/tools/ix-decide.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";

const CANDIDATES = [
  { name: "parse", kind: "function", path: "src/config/parse.ts", line: 12, pick: 1 },
  { name: "parse", kind: "method", path: "src/json/reader.ts", line: 40, pick: 2 },
];
const AMBIGUOUS = { error: "ambiguous_target", message: '"parse" matches 2 entities.', candidates: CANDIDATES };
// `locate` reports ambiguity under `code`, with no `error` key.
const LOCATE_AMBIGUOUS = { code: "ambiguous_target", candidates: CANDIDATES };
const NOT_FOUND = {
  error: "unresolved_target",
  message: 'No graph entity matches "pasre".',
  suggestions: [{ name: "parse", kind: "function", path: "src/config/parse.ts" }, "parseArgs"],
};
const NOT_MAPPED = { error: "workspace_not_mapped", message: "No workspace covers this directory. Run ix map." };
const BACKEND_ERROR = { error: "backend_error", message: "fetch failed" };

// Every tool the task covers, the target its lookup is keyed on, and its params.
const TOOLS = [
  ["ix-query", ixQuery, "parse", { symbol: "parse" }],
  ["ix-explain", ixExplain, "parse", { symbol: "parse" }],
  ["ix-impact", ixImpact, "parse", { target: "parse" }],
  ["ix-trace", ixTrace, "parse", { symbol: "parse" }],
  ["ix-inventory", ixInventory, "src/parse", { path: "src/parse" }],
  ["ix-locate", ixLocate, "parse", { pattern: "parse" }],
  ["ix-neighbors", ixNeighbors, "parse", { symbol: "parse" }],
];

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

function bodyFor(toolName, body) {
  // ix-query asks `locate`, which reports ambiguity in its own shape.
  return toolName === "ix-query" && body === AMBIGUOUS ? LOCATE_AMBIGUOUS : body;
}

function assertAmbiguous(out, label) {
  assert.doesNotMatch(out, /ix unavailable/i, `${label}:\n${out}`);
  assert.match(out, /ambiguous/i, `${label}:\n${out}`);
  assert.ok(out.includes("--pick 1") && out.includes("--pick 2"), `${label} must number the candidates:\n${out}`);
  assert.ok(out.includes("src/config/parse.ts:12"), `${label} must show path:line:\n${out}`);
  assert.ok(out.includes("src/json/reader.ts:40"), `${label} must show every candidate:\n${out}`);
  assert.match(out, /\(function\)/, `${label} must show the kind:\n${out}`);
  assert.match(out, /--pick <n>/, `${label} must say how to retry:\n${out}`);
  assert.match(out, /--path/, `${label} must offer --path:\n${out}`);
}

function assertNotFound(out, label) {
  assert.doesNotMatch(out, /ix unavailable/i, `${label}:\n${out}`);
  assert.match(out, /not found/i, `${label}:\n${out}`);
  assert.ok(out.includes("parseArgs"), `${label} must show the suggestions:\n${out}`);
  assert.ok(out.includes("src/config/parse.ts"), `${label} must show where a suggestion is:\n${out}`);
}

function assertNotMapped(out, label) {
  assert.doesNotMatch(out, /ix unavailable/i, `${label}:\n${out}`);
  assert.match(out, /not indexed/i, `${label}:\n${out}`);
  assert.match(out, /`ix map`/, `${label} must say how to map:\n${out}`);
  assert.doesNotMatch(out, /not found/i, `${label}:\n${out}`);
}

for (const [toolName, tool, target, params] of TOOLS) {
  test(`${toolName}: exit 2 lists ix's candidates with --pick numbers`, withFake(async (ix) => {
    ix.setLookup({ [target]: { exit: 2, body: bodyFor(toolName, AMBIGUOUS) } });
    const out = await tool.execute(params, { directory: ix.dir });
    assert.match(out, new RegExp(`^## ${toolName}: `), out);
    assertAmbiguous(out, toolName);
  }));

  test(`${toolName}: exit 3 says not found and shows the suggestions`, withFake(async (ix) => {
    ix.setLookup({ [target]: { exit: 3, body: NOT_FOUND } });
    const out = await tool.execute(params, { directory: ix.dir });
    assertNotFound(out, toolName);
  }));

  test(`${toolName}: exit 4 says the workspace is not mapped`, withFake(async (ix) => {
    ix.setLookup({ [target]: { exit: 4, body: NOT_MAPPED } });
    const out = await tool.execute(params, { directory: ix.dir });
    assertNotMapped(out, toolName);
  }));

  test(`${toolName}: an older ix's exit 1 with the same records reads the same`, withFake(async (ix) => {
    ix.setLookup({ [target]: { exit: 1, body: bodyFor(toolName, AMBIGUOUS) } });
    assertAmbiguous(await tool.execute(params, { directory: ix.dir }), `${toolName}@exit1`);
    ix.setLookup({ [target]: { exit: 1, body: NOT_MAPPED } });
    assertNotMapped(await tool.execute(params, { directory: ix.dir }), `${toolName}@exit1`);
  }));

  test(`${toolName}: exit 1 with any other record is still "ix unavailable"`, withFake(async (ix) => {
    ix.setLookup({ [target]: { exit: 1, body: BACKEND_ERROR } });
    const out = await tool.execute(params, { directory: ix.dir });
    assert.match(out, /unavailable/i, out);
  }));
}

test("a lookup that fails with nothing on stdout is still \"ix unavailable\"", withFake(async (ix) => {
  ix.setUnreachable();
  for (const [toolName, tool, , params] of TOOLS) {
    if (toolName === "ix-locate") continue; // `ix text` works without a backend.
    const out = await tool.execute(params, { directory: ix.dir });
    assert.match(out, /unavailable/i, `${toolName}:\n${out}`);
    assert.doesNotMatch(out, /ambiguous|not indexed/i, `${toolName}:\n${out}`);
  }
}));

test("tools say \"ix unavailable\" when ix is not installed", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "no-ix-"));
  const previous = process.env.PATH;
  process.env.PATH = [empty, "/usr/bin", "/bin"].join(path.delimiter);
  resetLlmVersionCache();
  try {
    for (const [toolName, tool, , params] of TOOLS) {
      const out = await tool.execute(params, { directory: empty });
      assert.match(out, /unavailable/i, `${toolName}:\n${out}`);
      assert.match(out, /ENOENT/, `${toolName}:\n${out}`);
    }
  } finally {
    process.env.PATH = previous;
    rmSync(empty, { recursive: true, force: true });
    resetLlmVersionCache();
  }
});

test("exit 2 whose stdout is not a record is still \"ix unavailable\"", async () => {
  const stub = mkdtempSync(path.join(tmpdir(), "ix-stub-"));
  writeFileSync(path.join(stub, "ix"), "#!/bin/sh\necho 'something went wrong'\nexit 2\n");
  chmodSync(path.join(stub, "ix"), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = [stub, "/usr/bin", "/bin"].join(path.delimiter);
  try {
    const out = await ixExplain.execute({ symbol: "parse" }, { directory: stub });
    assert.match(out, /ix unavailable/, out);
  } finally {
    process.env.PATH = previous;
    rmSync(stub, { recursive: true, force: true });
  }
});

test("lookupOutcome: a timed-out ix is a failure even when it printed a record", async () => {
  const stub = mkdtempSync(path.join(tmpdir(), "ix-stub-"));
  // `exec` so the kill reaches the process holding stdout.
  writeFileSync(path.join(stub, "ix"), `#!/bin/sh\necho '${JSON.stringify(AMBIGUOUS)}'\nexec sleep 30\n`);
  chmodSync(path.join(stub, "ix"), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = [stub, "/usr/bin", "/bin"].join(path.delimiter);
  try {
    let caught;
    await assert.rejects(runIx(["explain", "parse"], { cwd: stub, timeoutMs: 300 }), (error) => {
      caught = error;
      return error instanceof IxCommandError;
    });
    assert.equal(lookupOutcome(caught), null);
  } finally {
    process.env.PATH = previous;
    rmSync(stub, { recursive: true, force: true });
  }
});

test("lookupOutcome reads the exit code and the record", () => {
  const err = (exitCode, body) => new IxCommandError("Command failed", JSON.stringify(body), exitCode);
  assert.equal(lookupOutcome(err(2, AMBIGUOUS))?.kind, "ambiguous");
  assert.equal(lookupOutcome(err(2, LOCATE_AMBIGUOUS))?.kind, "ambiguous");
  assert.equal(lookupOutcome(err(3, NOT_FOUND))?.kind, "not_found");
  assert.equal(lookupOutcome(err(4, NOT_MAPPED))?.kind, "not_mapped");
  assert.equal(lookupOutcome(err(1, NOT_FOUND))?.kind, "not_found");
  assert.equal(lookupOutcome(err(1, BACKEND_ERROR)), null);
  assert.equal(lookupOutcome(err(5, NOT_FOUND)), null);
  assert.equal(lookupOutcome(err("ENOENT", NOT_FOUND)), null);
  assert.equal(lookupOutcome(new Error("plain")), null);
});

// ix-decide gates edits. An ambiguous or unresolved target is not a
// measurement, so it neither raises nor lowers the verdict, but the verdict
// shows what ix said instead of calling the file merely unassessed.
test("ix-decide shows the candidates for an ambiguous target", withFake(async (ix) => {
  ix.setLookup({ "src/a.ts": { exit: 2, body: AMBIGUOUS } });
  const out = await ixDecide.execute({ touched_paths: ["src/a.ts"] }, { directory: ix.dir });
  assert.match(out, /Verdict:\*\* ALLOW/, out);
  assert.match(out, /Risk:\*\* UNKNOWN/, out);
  assert.ok(out.includes("--pick 1") && out.includes("src/json/reader.ts:40"), out);
  assert.match(out, /--pick <n>/, out);
  assert.doesNotMatch(out, /Ix unavailable/, out);
}));

test("ix-decide shows the suggestions for a target ix could not resolve", withFake(async (ix) => {
  ix.setLookup({ "src/a.ts": { exit: 3, body: NOT_FOUND } });
  const out = await ixDecide.execute({ touched_paths: ["src/a.ts"] }, { directory: ix.dir });
  assert.match(out, /Verdict:\*\* ALLOW/, out);
  assert.match(out, /not found/i, out);
  assert.ok(out.includes("parseArgs"), out);
  assert.doesNotMatch(out, /Ix unavailable/, out);
}));

test("ix-decide still reads a new file on exit 3 and an unmapped workspace on exit 4", withFake(async (ix) => {
  ix.setLookup({
    "src/new.ts": { exit: 3, body: { error: "unresolved_target", message: "not ingested", reason: "file_not_in_graph" } },
    "src/b.ts": { exit: 4, body: NOT_MAPPED },
  });
  const created = await ixDecide.execute({ touched_paths: ["src/new.ts"] }, { directory: ix.dir });
  assert.ok(created.includes("**New (not in the graph yet):** `src/new.ts`"), created);
  const unmapped = await ixDecide.execute({ touched_paths: ["src/b.ts"] }, { directory: ix.dir });
  assert.match(unmapped, /Not assessed \(Ix unavailable\):\*\* `src\/b\.ts`/, unmapped);
  assert.match(unmapped, /`workspace_not_mapped`/, unmapped);
}));

test("ix-docs-tool shows the candidates for an ambiguous target", withFake(async (ix) => {
  ix.setLookup({ parse: { exit: 2, body: AMBIGUOUS } });
  const out = await ixDocsTool.execute({ target: "parse", depth: "brief" }, { directory: ix.dir });
  assert.match(out, /^## ix-docs-tool: parse/, out);
  assertAmbiguous(out, "ix-docs-tool");
}));

test("ix-docs-tool shows the candidates when only locate's record says ambiguous", async () => {
  const stub = mkdtempSync(path.join(tmpdir(), "ix-stub-"));
  writeFileSync(
    path.join(stub, "ix"),
    `#!/bin/sh\ncase "$1" in\n  locate) echo '${JSON.stringify(LOCATE_AMBIGUOUS)}'; exit 2 ;;\n  *) exit 1 ;;\nesac\n`
  );
  chmodSync(path.join(stub, "ix"), 0o755);
  const previous = process.env.PATH;
  process.env.PATH = [stub, "/usr/bin", "/bin"].join(path.delimiter);
  try {
    const out = await ixDocsTool.execute({ target: "parse", depth: "brief" }, { directory: stub });
    assertAmbiguous(out, "ix-docs-tool");
    assert.doesNotMatch(out, /## Context:/, out);
  } finally {
    process.env.PATH = previous;
    rmSync(stub, { recursive: true, force: true });
  }
});

test("ix-docs-tool shows the suggestions for a target that is not found", withFake(async (ix) => {
  ix.setLookup({ parse: { exit: 3, body: NOT_FOUND } });
  const out = await ixDocsTool.execute({ target: "parse", depth: "brief" }, { directory: ix.dir });
  assertNotFound(out, "ix-docs-tool");
}));

test("ix-decide keeps the required action ahead of the candidates", withFake(async (ix) => {
  // The pre-edit hook shows the first 500 characters of a REVIEW.
  ix.setImpact({ "src/hub.ts": impactRecord({ riskLevel: "high", importers: 3, memberCallers: 2 }) });
  ix.setLookup({ "src/a.ts": { exit: 2, body: AMBIGUOUS } });
  const out = await ixDecide.execute({ touched_paths: ["src/hub.ts", "src/a.ts"] }, { directory: ix.dir });
  assert.match(out, /Verdict:\*\* REVIEW/, out);
  assert.ok(out.indexOf("**Required action:**") < out.indexOf("**Not resolved by Ix:**"), out);
  assert.match(out, /`src\/a\.ts` — AMBIGUOUS, 2 candidates/, out);
}));
