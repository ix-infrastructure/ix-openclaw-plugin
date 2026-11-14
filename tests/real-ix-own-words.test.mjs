// Copyright 2026 Ix Infrastructure Inc.

/**
 * ownWords (tests/real-ix/live/own-words.mjs) blanks ix's own strings out of a
 * tool's answer before the live real-ix tests look in it for "not found",
 * "undefined" and the like. Those tests only run in CI against a real backend,
 * so the helper is pinned here: ix's prose, copied into the answer as is, no
 * longer fails the check, and a failure the tool wrote itself still does.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installFakeIx } from "./fake-ix.mjs";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import * as ixExplain from "../dist/tools/ix-explain.js";
import { CRASH, NO_ANSWER, NONE, ownWords, recordStrings } from "./real-ix/live/own-words.mjs";

const ctx = { directory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") };

// An `ix explain` record whose prose says things the patterns look for.
const EXPLAIN = {
  resolvedTarget: { kind: "function", name: "readCoreValue", path: "src/read-core.ts" },
  facts: { callerCount: 3 },
  rendered: {
    explanation: "Doubles n. Returns undefined behaviour for NaN? No: callers are not found to pass one.",
    whyItMatters: "No results elsewhere depend on it.",
    usedBy: "readUse1, readUse2, readUse3",
    notes: ["Could not answer whether it is pure: Graph is empty of effects data."],
  },
};

async function explainWith(record) {
  const ix = installFakeIx();
  resetLlmVersionCache();
  try {
    ix.setRecord("explain", record);
    return await ixExplain.execute({ symbol: "readCoreValue" }, ctx);
  } finally {
    ix.restore();
    resetLlmVersionCache();
  }
}

test("ix's prose, copied into the answer, is not the tool's words", async () => {
  const out = await explainWith(EXPLAIN);
  // The tool did copy the prose, so the patterns alone would fail falsely.
  assert.ok(out.includes(EXPLAIN.rendered.explanation), out);
  assert.match(out, NO_ANSWER, out);
  assert.match(out, CRASH, out);

  const own = ownWords(out, EXPLAIN);
  assert.doesNotMatch(own, NO_ANSWER, own);
  assert.doesNotMatch(own, CRASH, own);
  assert.doesNotMatch(own, NONE, own);
  // What the tool wrote around ix's values is still there to be checked.
  assert.match(own, /^## ix-explain: \u0000/, own);
  assert.match(own, /\*\*Kind:\*\* \u0000/, own);
  assert.match(own, /\*\*Graph:\*\* callers: 3/, own);
});

test("a failure the tool wrote itself is still caught", async () => {
  // No target and no facts: the tool says "Not found in graph" in its own words.
  const record = { rendered: { explanation: "readCoreValue" } };
  const out = await explainWith(record);
  assert.match(ownWords(out, record), NO_ANSWER, out);

  // A value the tool rendered without having it is the tool's, not ix's.
  assert.match(ownWords("**Kind:** undefined", { kind: "function" }), CRASH);
  assert.match(ownWords("**callers:** none", { name: "callers" }), NONE);
});

test("blanking cannot join text into a word that was not there", () => {
  // Removing "X" outright would leave "undefined".
  assert.doesNotMatch(ownWords("undeXfined", { a: "X" }), CRASH);
  // The longer string goes first, so a shorter one inside it cannot split it.
  assert.equal(ownWords("say not found now", { a: "not", b: "say not found" }), "\u0000 now");
});

test("recordStrings reads every string value, at any depth, and no keys", () => {
  const strings = recordStrings({ a: "x", b: [{ c: "y" }, "z", 3, null], d: { e: "" }, undefinedKey: true });
  assert.deepEqual([...strings].sort(), ["x", "y", "z"]);
});
