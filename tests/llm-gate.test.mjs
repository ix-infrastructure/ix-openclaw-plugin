/**
 * The `--format llm` gate.
 *
 * `ix` does not validate `--format`. Every renderer is
 * `if json … else if llm … else text`, so an unrecognised value falls through
 * to human-readable text and exits 0. That is what makes this safe to ship —
 * no version of `ix` breaks on `--format llm` — and equally what makes a wrong
 * floor dangerous: an old CLI answers with prose, successfully, and nothing
 * raises. Most of what follows pins that boundary.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LLM_MIN_VERSION,
  commandAllowsLlm,
  gte,
  isLlmErrorLine,
  llmDisabled,
  parseSemver,
  resetLlmVersionCache,
} from "../dist/runtime/llm.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("parseSemver reads plain and decorated versions", () => {
  assert.deepEqual(parseSemver("0.9.2"), [0, 9, 2]);
  assert.deepEqual(parseSemver("ix 0.9.2 (linux-amd64)"), [0, 9, 2]);
  assert.equal(parseSemver("unknown"), null);
  assert.equal(parseSemver(""), null);
});

test("gte compares across each position", () => {
  assert.equal(gte([0, 9, 2], [0, 9, 2]), true);
  assert.equal(gte([0, 9, 3], [0, 9, 2]), true);
  assert.equal(gte([0, 10, 0], [0, 9, 9]), true);
  assert.equal(gte([1, 0, 0], [0, 99, 99]), true);
  assert.equal(gte([0, 9, 1], [0, 9, 2]), false);
  assert.equal(gte([0, 6, 0], [0, 7, 0]), false);
});

test("Tier 1-4 commands sit at 0.7.0", () => {
  for (const command of [
    "map", "subsystems", "impact", "smells", "overview", "stats",
    "inventory", "rank", "depends", "trace", "callers", "callees",
    "imports", "imported-by", "text", "history", "locate", "diff",
  ]) {
    assert.deepEqual(LLM_MIN_VERSION[command], [0, 7, 0], command);
  }
});

test("Tier 5 commands sit at 0.9.2", () => {
  // The reason this is a table and not one constant. Before 0.9.2 these two
  // accepted `--format llm` and rendered text, so a single 0.7.0 floor would
  // have forwarded prose to the model as though it were records.
  assert.deepEqual(LLM_MIN_VERSION["explain"], [0, 9, 2]);
  assert.deepEqual(LLM_MIN_VERSION["read"], [0, 9, 2]);
});

test("Pro commands are absent at every version", () => {
  // @ix/pro declares only text|json — there is no llm renderer to gate on, so
  // no floor can make these safe and none should try.
  for (const command of ["briefing", "decisions", "goals", "plan", "truth", "bugs"]) {
    assert.equal(LLM_MIN_VERSION[command], undefined, command);
    assert.equal(commandAllowsLlm([command]), false, command);
  }
});

test("commandAllowsLlm accepts known commands and refuses the rest", () => {
  assert.equal(commandAllowsLlm(["stats"]), true);
  assert.equal(commandAllowsLlm(["rank", "--by", "dependents"]), true);
  assert.equal(commandAllowsLlm(["nonesuch"]), false);
  assert.equal(commandAllowsLlm([]), false);
});

test("diff --content stays on text", () => {
  // docs/llm-format.md keeps this on text deliberately: verbatim hunks have no
  // record form.
  assert.equal(commandAllowsLlm(["diff", "1", "5"]), true);
  assert.equal(commandAllowsLlm(["diff", "1", "5", "--content"]), false);
});

test("the error record ix writes to stdout with exit 0 is detected", () => {
  // Checking only the exit status would forward this to the model as though it
  // were a result. Detecting it defers to each tool's own error envelope.
  assert.equal(isLlmErrorLine('error code=unknown_target message="No entity named X"'), true);
  assert.equal(isLlmErrorLine('  error code=ambiguous_target message="…"'), true);
});

test("real records are not mistaken for errors", () => {
  assert.equal(isLlmErrorLine("stats nodes=98979 edges=354283"), false);
  assert.equal(isLlmErrorLine('region id=cli label="Cli / Client" level=2'), false);
  // A record that merely mentions an error is not an error line.
  assert.equal(isLlmErrorLine("smell kind=has_smell.error_swallow file=a.ts"), false);
});

test("IX_DISABLE_LLM_FORMAT forces the existing path", () => {
  const original = process.env.IX_DISABLE_LLM_FORMAT;
  try {
    for (const value of ["1", "true", "TRUE", "yes"]) {
      process.env.IX_DISABLE_LLM_FORMAT = value;
      assert.equal(llmDisabled(), true, value);
    }
    process.env.IX_DISABLE_LLM_FORMAT = "0";
    assert.equal(llmDisabled(), false);
    delete process.env.IX_DISABLE_LLM_FORMAT;
    assert.equal(llmDisabled(), false);
  } finally {
    if (original === undefined) delete process.env.IX_DISABLE_LLM_FORMAT;
    else process.env.IX_DISABLE_LLM_FORMAT = original;
    resetLlmVersionCache();
  }
});

// The envelope is the point of the middle path: each tool keeps its own header
// and error handling and swaps only the body. A fast-path returning bare
// records would strip the header the model orients on.
for (const [file, header] of [
  ["ix-stats.ts", "## ix-stats"],
  ["ix-subsystems.ts", "## ix-subsystems"],
  ["ix-smells.ts", "## ix-smells"],
  ["ix-trace.ts", "## ix-trace:"],
  ["ix-locate.ts", "## ix-locate:"],
  ["ix-rank.ts", "## ix-rank:"],
  ["ix-inventory.ts", "## ix-inventory:"],
  ["ix-explain.ts", "## ix-explain:"],
]) {
  test(`${file} keeps its header on the fast path`, () => {
    const source = readFileSync(path.join(projectRoot, "tools", file), "utf8");
    const index = source.indexOf("tryLlm(");
    assert.ok(index > -1, `${file} does not call tryLlm`);
    // Window is generous because some call sites carry a paragraph of comment
    // before the return.
    assert.ok(source.slice(index, index + 900).includes(header), `${file} lost its header`);
  });
}

test("no tool sends a Pro command down the fast path", () => {
  const dir = path.join(projectRoot, "tools");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/tryLlm\(\s*\[\s*"([a-z-]+)"/g)) {
      assert.notEqual(
        LLM_MIN_VERSION[match[1]],
        undefined,
        `${file} calls tryLlm with ungated command "${match[1]}"`,
      );
    }
  }
});
