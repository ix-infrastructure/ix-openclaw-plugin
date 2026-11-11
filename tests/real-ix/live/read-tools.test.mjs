// Copyright 2026 Ix Infrastructure Inc.

/**
 * Every graph read tool not covered beside it, fed a SUCCESSFUL answer from a
 * RELEASED `ix` and a LIVE throwaway backend (issue #68).
 *
 * impact.test.mjs covers ix-decide and ix-impact; graph-tools.test.mjs covers
 * ix-query, ix-neighbors, ix-map, ix-ingest, ix-health and ix-smells. This file
 * covers the rest: ix-explain, ix-stats, ix-rank, ix-trace, ix-inventory,
 * ix-subsystems, ix-docs-tool and ix-locate. (ix-history reads `ix briefing`,
 * an Ix Pro command the released open-source CLI does not have, so it has
 * nothing to read here.)
 *
 * The tools are formatters over CLI output, and the likely defect is a field
 * name that drifted or was never right: the tool then says "not found",
 * "none" or "no results" about a symbol that is in the graph. So each test asks
 * about a symbol the fixture project contains and fails if the tool says it
 * is missing, and, where the tool renders a JSON record, it also reads that
 * record from the CLI itself and checks the tool shows a value taken from it.
 *
 * Each tool runs twice. By default the tools ask ix for `--format llm` first
 * and pass that text through; with IX_DISABLE_LLM_FORMAT=1 they parse
 * `--format json`, which is the path a wrong field name breaks.
 *
 * Runs only in the CI job "Real ix (released CLI)", after it starts
 * tests/real-ix/compose.yml; see impact.test.mjs beside it for running it by
 * hand. It needs IX_LIVE_ENDPOINT and fails without it.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resetLlmVersionCache } from "../../../dist/runtime/llm.js";
import * as ixDocsTool from "../../../dist/tools/ix-docs-tool.js";
import * as ixExplain from "../../../dist/tools/ix-explain.js";
import * as ixInventory from "../../../dist/tools/ix-inventory.js";
import * as ixLocate from "../../../dist/tools/ix-locate.js";
import * as ixRank from "../../../dist/tools/ix-rank.js";
import * as ixStats from "../../../dist/tools/ix-stats.js";
import * as ixSubsystems from "../../../dist/tools/ix-subsystems.js";
import * as ixTrace from "../../../dist/tools/ix-trace.js";

const endpoint = process.env.IX_LIVE_ENDPOINT;

const saved = {};
for (const key of ["IX_ENDPOINT", "IX_HOME", "IX_NO_UPDATE_CHECK", "NO_COLOR", "FORCE_COLOR", "IX_DISABLE_LLM_FORMAT"]) {
  saved[key] = process.env[key];
}

const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "real-ix-read-")));
const workspace = path.join(sandbox, "ws");
const ctx = { directory: workspace };

const CRASH = /\[object Object\]|undefined|NaN/;
// What a tool says when ix could not answer, or when it read no answer out of
// one: either way, wrong for a symbol the fixture project contains.
const NO_ANSWER =
  /not found|No matches found|No results|No trace paths found|Graph is empty|ix unavailable|could not answer|Ambiguous target|error code=/i;
// A list the tool rendered as empty ("**callers:** none").
const NONE = /\*\*[^*\n]+:\*\* none\b/i;

test.before(() => {
  assert.ok(endpoint, "IX_LIVE_ENDPOINT must point at the throwaway backend (tests/real-ix/compose.yml)");
  const home = path.join(sandbox, "home");
  mkdirSync(home);
  writeFileSync(path.join(home, "config.yaml"), `endpoint: ${endpoint}\nformat: text\n`);
  process.env.IX_HOME = home;
  process.env.IX_ENDPOINT = endpoint;
  process.env.IX_NO_UPDATE_CHECK = "1";
  process.env.NO_COLOR = "1";
  delete process.env.FORCE_COLOR;
  delete process.env.IX_DISABLE_LLM_FORMAT;

  // coreValue is called from three files; it is the only function with callers.
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  writeFileSync(path.join(workspace, "src", "core.ts"), "export function coreValue(n: number): number { return n * 2; }\n");
  for (let i = 1; i <= 3; i++) {
    writeFileSync(
      path.join(workspace, "src", `user${i}.ts`),
      `import { coreValue } from "./core";\nexport function use${i}(): number { return coreValue(${i}); }\n`
    );
  }
  execFileSync("git", ["init", "-q", "."], { cwd: workspace });
  execFileSync("ix", ["map", "."], { cwd: workspace, stdio: "pipe", timeout: 180_000 });
});

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

/** The record the released CLI prints for `ix <args> --format json`. */
function ixJson(args) {
  const raw = execFileSync("ix", [...args, "--format", "json"], { cwd: workspace, encoding: "utf8" });
  return { raw, record: JSON.parse(raw) };
}

/**
 * The tool's output and the CLI's record for the same question, read while the
 * graph held still. The live files run in parallel against one backend, and a
 * sibling file's `ix map` can change totals, ranks or regions between two
 * reads. So read the record before and after the tool; if the two records
 * differ, the graph moved under the tool and the pair is read again.
 */
async function readSteady(tool, params, mode, cliArgs) {
  let before = ixJson(cliArgs);
  for (let attempt = 1; ; attempt++) {
    const out = await run(tool, params, mode);
    const after = ixJson(cliArgs);
    if (after.raw === before.raw || attempt >= 5) return { out, ...after };
    before = after;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const MODES = [
  // The tools' default: ix's own llm records, passed through under the header.
  { name: "llm", json: false },
  // The JSON path, where the tool reads named fields out of ix's record.
  { name: "json", json: true },
];

async function run(tool, params, mode) {
  resetLlmVersionCache();
  if (mode.json) process.env.IX_DISABLE_LLM_FORMAT = "1";
  else delete process.env.IX_DISABLE_LLM_FORMAT;
  try {
    return await tool.execute(params, ctx);
  } finally {
    delete process.env.IX_DISABLE_LLM_FORMAT;
  }
}

/** The answer is the tool's own, about something that is there. */
function assertAnswered(out, header) {
  assert.match(out, header, out);
  assert.doesNotMatch(out, NO_ANSWER, out);
  assert.doesNotMatch(out, NONE, out);
  assert.doesNotMatch(out, CRASH, out);
}

for (const mode of MODES) {
  test(`ix-explain explains a symbol the graph contains (${mode.name})`, async () => {
    const out = await run(ixExplain, { symbol: "coreValue" }, mode);
    assertAnswered(out, /^## ix-explain: coreValue/);
    if (mode.json) {
      const { raw, record } = ixJson(["explain", "coreValue"]);
      assert.equal(typeof record.resolvedTarget?.kind, "string", raw);
      assert.ok(out.includes(`**Kind:** ${record.resolvedTarget.kind}`), out);
      // Three files call coreValue, so ix counts its callers; the tool reads
      // that count by name and must show it.
      assert.equal(typeof record.facts?.callerCount, "number", raw);
      assert.ok(record.facts.callerCount >= 3, raw);
      assert.ok(out.includes(`callers: ${record.facts.callerCount}`), out);
    }
  });

  test(`ix-stats reports the graph's totals (${mode.name})`, async () => {
    if (!mode.json) {
      assertAnswered(await run(ixStats, {}, mode), /^## ix-stats/);
    } else {
      const { out, raw, record } = await readSteady(ixStats, {}, mode, ["stats"]);
      assertAnswered(out, /^## ix-stats/);
      assert.equal(typeof record.nodes?.total, "number", raw);
      assert.ok(out.includes(`- Total nodes: ${record.nodes.total}`), out);
      const files = record.nodes.byKind?.find((entry) => entry.kind === "file")?.count;
      assert.equal(typeof files, "number", raw);
      assert.ok(files >= 4, `the fixture has four source files:\n${raw}`);
      assert.ok(out.includes(`- Files indexed: ${files}`), out);
    }
  });

  test(`ix-rank ranks the fixture's functions by callers (${mode.name})`, async () => {
    // Four functions, so coreValue (the only one with callers) is in the top five.
    const params = { by: "callers", kind: "function", top: 5 };
    if (!mode.json) {
      const out = await run(ixRank, params, mode);
      assertAnswered(out, /^## ix-rank: /);
      assert.match(out, /coreValue/, out);
    } else {
      const cliArgs = ["rank", "--by", "callers", "--kind", "function", "--top", "5"];
      const { out, raw, record } = await readSteady(ixRank, params, mode, cliArgs);
      assertAnswered(out, /^## ix-rank: /);
      assert.match(out, /coreValue/, out);
      assert.ok(Array.isArray(record.results) && record.results.length > 0, raw);
      assert.equal(typeof record.results[0].name, "string", raw);
      assert.ok(out.includes(`| 1 | \`${record.results[0].name}\` |`), out);
    }
  });

  test(`ix-trace traces a symbol to its callers (${mode.name})`, async () => {
    const out = await run(ixTrace, { symbol: "coreValue" }, mode);
    assertAnswered(out, /^## ix-trace: coreValue/);
    // use1..use3 call coreValue: a trace that reached the graph names one.
    assert.match(out, /use[123]/, out);
    if (mode.json) {
      const { raw, record } = ixJson(["trace", "coreValue"]);
      const visited = (record.upstream?.summary?.nodes_visited ?? 0) + (record.downstream?.summary?.nodes_visited ?? 0);
      assert.ok(visited > 0, raw);
    }
  });

  test(`ix-inventory lists the functions under the fixture's source directory (${mode.name})`, async () => {
    // The directory as ix stores it, so the scope matches however ix keeps paths.
    const located = ixJson(["locate", "coreValue"]);
    const filePath = located.record.resolvedTarget?.path;
    assert.equal(typeof filePath, "string", located.raw);
    const dir = path.posix.dirname(filePath);

    const out = await run(ixInventory, { path: dir, kind: "function" }, mode);
    assertAnswered(out, /^## ix-inventory: /);
    assert.doesNotMatch(out, /No functions found/, out);
    assert.match(out, /coreValue/, out);
    if (mode.json) {
      const { raw, record } = ixJson(["inventory", "--kind", "function", "--path", dir]);
      assert.ok(Array.isArray(record.byFile) && record.byFile.length > 0, raw);
      assert.equal(typeof record.byFile[0].path, "string", raw);
      assert.ok(out.includes(`\`${record.byFile[0].path}\``), out);
    }
  });

  test(`ix-subsystems shows the regions ix subsystems prints (${mode.name})`, async () => {
    if (!mode.json) {
      assertAnswered(await run(ixSubsystems, {}, mode), /^## ix-subsystems/);
    } else {
      const { out, raw, record } = await readSteady(ixSubsystems, {}, mode, ["subsystems"]);
      assertAnswered(out, /^## ix-subsystems/);
      assert.ok(Array.isArray(record.regions), raw);
      // A project this small may form no region; then, and only then, the
      // tool may say so.
      if (record.regions.length > 0) {
        assert.equal(typeof record.regions[0].label, "string", raw);
        assert.ok(out.includes(`| ${record.regions[0].label} |`), out);
        assert.doesNotMatch(out, /No subsystems found/, out);
      } else {
        assert.match(out, /No subsystems found/, out);
      }
    }
  });

  test(`ix-locate finds a symbol's text in the fixture (${mode.name})`, async () => {
    const out = await run(ixLocate, { pattern: "coreValue", limit: 10 }, mode);
    assertAnswered(out, /^## ix-locate: coreValue/);
    assert.match(out, /core\.ts/, out);
  });
}

test("ix-docs-tool gives context for a symbol the graph contains", async () => {
  // JSON only: ix-docs-tool has no llm path.
  const out = await run(ixDocsTool, { target: "coreValue", depth: "standard" }, { json: false });
  assertAnswered(out, /^## Context: coreValue/);
  const { raw, record } = ixJson(["overview", "coreValue"]);
  // The tool renders nothing from its locate call, so Kind, read from this
  // record by name, is what proves it read ix's overview at all.
  assert.equal(typeof record.resolvedTarget?.kind, "string", raw);
  assert.ok(out.includes(`**Kind:** ${record.resolvedTarget.kind}`), `${out}\n--- ix overview ---\n${raw}`);
});
