// Copyright 2026 Ix Infrastructure Inc.

/**
 * readSteady (tests/real-ix/live/steady.mjs) pairs a tool's answer with the
 * CLI's record for the same question in the live real-ix tests. Those tests
 * only run in CI against a real backend, so the helper's own behaviour is
 * pinned here with fakes: it re-reads while the record moves, and when the
 * record never holds still it says so in the failure text instead of handing
 * back an unsteady pair without a word.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { llmShape, readSteady, STEADY_TRIES } from "./real-ix/live/steady.mjs";

/** A CLI whose successive reads print `raws` in turn (the last one repeats). */
function fakeCli(raws) {
  let reads = 0;
  const readCli = () => {
    const raw = raws[Math.min(reads, raws.length - 1)];
    reads++;
    return { raw, record: { raw } };
  };
  return { readCli, reads: () => reads };
}

function fakeTool() {
  let runs = 0;
  return { runTool: async () => `answer ${++runs}`, runs: () => runs };
}

test("a record that holds still is read once before and once after the tool", async () => {
  const cli = fakeCli(["A"]);
  const tool = fakeTool();
  const pair = await readSteady(tool.runTool, cli.readCli, { label: "stats", waitMs: 0 });
  assert.equal(pair.steady, true);
  assert.equal(pair.out, "answer 1");
  assert.equal(pair.raw, "A");
  assert.deepEqual(pair.record, { raw: "A" });
  assert.equal(tool.runs(), 1);
  assert.equal(cli.reads(), 2);
  assert.doesNotMatch(pair.why, /NOT STEADY/);
  assert.match(pair.why, /answer 1\n--- ix stats ---\nA$/);
});

test("a record that moved under the tool is read again until it holds still", async () => {
  // Before: A. After run 1: B (moved). After run 2: B (still).
  const cli = fakeCli(["A", "B"]);
  const tool = fakeTool();
  const pair = await readSteady(tool.runTool, cli.readCli, { label: "stats", waitMs: 0 });
  assert.equal(pair.steady, true);
  assert.equal(pair.out, "answer 2");
  assert.equal(pair.raw, "B");
  assert.equal(tool.runs(), 2);
  assert.doesNotMatch(pair.why, /NOT STEADY/);
});

test("a record that never holds still is flagged, and the failure text says so", async () => {
  const raws = Array.from({ length: STEADY_TRIES + 1 }, (_, i) => `R${i}`);
  // Never repeats: every read differs from the one before it.
  let reads = 0;
  const readCli = () => ({ raw: raws[reads] ?? `R${reads}`, n: reads++ });
  const tool = fakeTool();
  const pair = await readSteady(tool.runTool, readCli, { label: "rank --by callers --format json", waitMs: 0 });
  assert.equal(pair.steady, false);
  assert.equal(tool.runs(), STEADY_TRIES);
  assert.equal(pair.out, `answer ${STEADY_TRIES}`);
  assert.equal(pair.raw, `R${STEADY_TRIES}`);
  assert.match(pair.why, /--- NOT STEADY ---/);
  assert.match(pair.why, /`ix rank --by callers --format json` printed a different record on each of 6 reads/);
  assert.match(pair.why, /graph never held still/);
});

test("the number of tries can be set", async () => {
  let reads = 0;
  const readCli = () => ({ raw: `R${reads++}` });
  const tool = fakeTool();
  const pair = await readSteady(tool.runTool, readCli, { label: "x", tries: 2, waitMs: 0 });
  assert.equal(pair.steady, false);
  assert.equal(tool.runs(), 2);
  assert.match(pair.why, /each of 3 reads/);
});

// llmShape: what the live llm checks compare when ix never printed the same
// llm text twice, so a volatile value (a timing, an age) cannot fail them.

test("llmShape: the same records with other values have the same shape", () => {
  const a = '## ix-stats\n\nstats nodes=98 edges=354 took_ms=12\nnote message="as of 3s ago" ok';
  const b = '## ix-stats\n\nstats nodes=99 edges=360 took_ms=7\nnote message="as of \\"5s\\" ago" ok';
  assert.equal(llmShape(a), llmShape(b));
  assert.equal(llmShape(a), "## ix-stats\n\nstats nodes=… edges=… took_ms=…\nnote message=… ok");
});

test("llmShape: a dropped record, a renamed key or a JSON fallback changes the shape", () => {
  const llm = "## ix-rank\n\nrank name=a callers=3\nrank name=b callers=0";
  assert.notEqual(llmShape(llm), llmShape("## ix-rank\n\nrank name=a callers=3"));
  assert.notEqual(llmShape(llm), llmShape("## ix-rank\n\nrank name=a callers=3\nrank label=b callers=0"));
  assert.notEqual(llmShape(llm), llmShape("## ix-rank\n\n| # | Name | Callers |\n| 1 | `a` | 3 |"));
});
