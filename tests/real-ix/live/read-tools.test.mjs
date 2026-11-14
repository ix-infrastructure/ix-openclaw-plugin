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
 * Each tool runs twice, and each run is checked against what the CLI itself
 * prints for the same question:
 *
 * - llm: the tools' default. They ask ix for `--format llm` and pass that text
 *   through under their header. The check is that the tool's answer IS ix's
 *   own llm text (so the llm path was taken, and nothing was lost or added),
 *   and that the text names the fixture's symbol. Nothing is assumed about how
 *   ix words its llm records. If ix never prints the same llm text twice (a
 *   volatile value such as a timing), only the text's shape is compared.
 * - json: with IX_DISABLE_LLM_FORMAT=1 the tools parse `--format json` and
 *   render named fields, which is the path a drifted field name breaks: the
 *   tool then says "not found", "none" or "no results" about a symbol that is
 *   in the graph. So the tool's own text must not say that, and must show a
 *   value read from the CLI's record. Each record field the tool reads is
 *   checked by name first, so a CLI that renamed it fails on that field, with
 *   the record in the message.
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
import { redactSecrets } from "../../../dist/runtime/secrets.js";
import * as ixDocsTool from "../../../dist/tools/ix-docs-tool.js";
import * as ixExplain from "../../../dist/tools/ix-explain.js";
import * as ixInventory from "../../../dist/tools/ix-inventory.js";
import * as ixLocate from "../../../dist/tools/ix-locate.js";
import * as ixRank from "../../../dist/tools/ix-rank.js";
import * as ixStats from "../../../dist/tools/ix-stats.js";
import * as ixSubsystems from "../../../dist/tools/ix-subsystems.js";
import * as ixTrace from "../../../dist/tools/ix-trace.js";
import { llmShape, readSteady } from "./steady.mjs";

const endpoint = process.env.IX_LIVE_ENDPOINT;

const saved = {};
for (const key of ["IX_ENDPOINT", "IX_HOME", "IX_NO_UPDATE_CHECK", "NO_COLOR", "FORCE_COLOR", "IX_DISABLE_LLM_FORMAT"]) {
  saved[key] = process.env[key];
}

const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "real-ix-read-")));
const workspace = path.join(sandbox, "ws");
const ctx = { directory: workspace };

// Only ever matched against the tool's OWN rendering (json mode), never
// against ix's llm text, whose wording is ix's business.
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

  // readCoreValue is called from three files; it is the only function with
  // callers. The sibling live files map their own projects into the same
  // backend (coreValue, use1..use6 in src/core.ts and src/user*.ts), so every
  // symbol and file name here is one they do not use: a lookup by name cannot
  // become ambiguous, or count their callers, even if ix did not keep the
  // workspaces apart.
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  writeFileSync(
    path.join(workspace, "src", "read-core.ts"),
    "export function readCoreValue(n: number): number { return n * 2; }\n"
  );
  for (let i = 1; i <= 3; i++) {
    writeFileSync(
      path.join(workspace, "src", `read-user${i}.ts`),
      `import { readCoreValue } from "./read-core";\nexport function readUse${i}(): number { return readCoreValue(${i}); }\n`
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

function ixRaw(args) {
  return execFileSync("ix", args, { cwd: workspace, encoding: "utf8" });
}

/** The record the released CLI prints for `ix <args> --format json`. */
function ixJson(args) {
  const raw = ixRaw([...args, "--format", "json"]);
  return { raw, record: JSON.parse(raw) };
}

const MODES = [
  { name: "llm", json: false },
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

/**
 * The tool's answer and the CLI's own output for the same question (`--format
 * llm` or `--format json`, as the mode asks), read while the graph held still.
 * `why` is the message for every check on the pair: both outputs, and a
 * NOT STEADY note if the graph never held still.
 */
function readPair(tool, params, mode, cliArgs) {
  const format = mode.json ? "json" : "llm";
  const readCli = mode.json ? () => ixJson(cliArgs) : () => ({ raw: ixRaw([...cliArgs, "--format", "llm"]) });
  return readSteady(() => run(tool, params, mode), readCli, { label: [...cliArgs, "--format", format].join(" ") });
}

/**
 * llm mode: the tool's answer is ix's own llm text under the tool's header,
 * exactly as runtime/llm.ts hands it on (secrets redacted, trimmed). A tool
 * that fell back to JSON, or mangled the text, fails here with both in view.
 *
 * `body` is what the tool should print under the header, when that is not
 * ix's text as is (ix-subsystems). If ix never printed the same llm text twice
 * (`steady` false), its values may hold something volatile, such as a timing,
 * so only the text's shape (records, keys, bare words) must match.
 */
function assertPassedThrough(pair, header, body = redactSecrets(pair.raw).trim()) {
  const expected = `${header}\n\n${body}`;
  if (pair.steady) {
    assert.equal(pair.out, expected, pair.why);
    return;
  }
  const why = `${pair.why}\nOnly the shape of the llm text was compared, as its values changed between reads.`;
  assert.equal(llmShape(pair.out), llmShape(expected), why);
}

/** json mode: the tool's own answer, about something that is there. */
function assertAnswered(out, header, why = out) {
  assert.match(out, header, why);
  assert.doesNotMatch(out, NO_ANSWER, why);
  assert.doesNotMatch(out, NONE, why);
  assert.doesNotMatch(out, CRASH, why);
}

for (const mode of MODES) {
  test(`ix-explain explains a symbol the graph contains (${mode.name})`, async () => {
    const pair = await readPair(ixExplain, { symbol: "readCoreValue" }, mode, ["explain", "readCoreValue"]);
    if (!mode.json) {
      assertPassedThrough(pair, "## ix-explain: readCoreValue");
      assert.match(pair.raw, /readCoreValue/, pair.why);
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-explain: readCoreValue/, why);
    assert.equal(typeof record.resolvedTarget?.kind, "string", why);
    assert.ok(out.includes(`**Kind:** ${record.resolvedTarget.kind}`), why);
    // Three files call readCoreValue, so ix counts its callers; the tool reads
    // that count by name and must show it.
    assert.equal(typeof record.facts?.callerCount, "number", why);
    assert.ok(record.facts.callerCount >= 3, why);
    assert.ok(out.includes(`callers: ${record.facts.callerCount}`), why);
  });

  test(`ix-stats reports the graph's totals (${mode.name})`, async () => {
    const pair = await readPair(ixStats, {}, mode, ["stats"]);
    if (!mode.json) {
      assertPassedThrough(pair, "## ix-stats");
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-stats/, why);
    assert.equal(typeof record.nodes?.total, "number", why);
    assert.ok(out.includes(`- Total nodes: ${record.nodes.total}`), why);
    const files = record.nodes.byKind?.find((entry) => entry.kind === "file")?.count;
    assert.equal(typeof files, "number", why);
    assert.ok(files >= 4, `the fixture has four source files:\n${why}`);
    assert.ok(out.includes(`- Files indexed: ${files}`), why);
  });

  test(`ix-rank ranks the fixture's functions by callers (${mode.name})`, async () => {
    // Four functions, so readCoreValue (the only one with callers) is in the
    // top five. Even if ix ranked the sibling files' functions too, only three
    // others there have callers.
    const params = { by: "callers", kind: "function", top: 5 };
    const cliArgs = ["rank", "--by", "callers", "--kind", "function", "--top", "5"];
    const pair = await readPair(ixRank, params, mode, cliArgs);
    if (!mode.json) {
      assertPassedThrough(pair, "## ix-rank: callers/function");
      assert.match(pair.raw, /readCoreValue/, pair.why);
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-rank: /, why);
    assert.match(out, /readCoreValue/, why);
    assert.ok(Array.isArray(record.results) && record.results.length > 0, why);
    assert.equal(typeof record.results[0].name, "string", why);
    assert.ok(out.includes(`| 1 | \`${record.results[0].name}\` |`), why);
  });

  test(`ix-trace traces a symbol to its callers (${mode.name})`, async () => {
    const pair = await readPair(ixTrace, { symbol: "readCoreValue" }, mode, ["trace", "readCoreValue"]);
    if (!mode.json) {
      assertPassedThrough(pair, "## ix-trace: readCoreValue");
      assert.match(pair.raw, /readCoreValue/, pair.why);
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-trace: readCoreValue/, why);
    // readUse1..readUse3 call readCoreValue: a trace that reached the graph names one.
    assert.match(out, /readUse[123]/, why);
    const visited = (record.upstream?.summary?.nodes_visited ?? 0) + (record.downstream?.summary?.nodes_visited ?? 0);
    assert.ok(visited > 0, why);
  });

  test(`ix-inventory lists the functions under the fixture's source directory (${mode.name})`, async () => {
    // The directory as ix itself stores the file, absolute or relative, so
    // the scope is a prefix of a path ix holds however it keeps paths, rather
    // than a guess such as "src" that only matches one of the two.
    const located = ixJson(["locate", "readCoreValue"]);
    const filePath = located.record.resolvedTarget?.path;
    assert.equal(typeof filePath, "string", located.raw);
    assert.match(filePath, /src\/read-core\.ts$/, located.raw);
    const dir = path.posix.dirname(filePath);

    const cliArgs = ["inventory", "--kind", "function", "--path", dir];
    const pair = await readPair(ixInventory, { path: dir, kind: "function" }, mode, cliArgs);
    if (!mode.json) {
      assertPassedThrough(pair, `## ix-inventory: ${dir}`);
      assert.match(pair.raw, /readCoreValue/, pair.why);
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-inventory: /, why);
    assert.doesNotMatch(out, /No functions found/, why);
    assert.match(out, /readCoreValue/, why);
    assert.ok(Array.isArray(record.byFile) && record.byFile.length > 0, why);
    assert.equal(typeof record.byFile[0].path, "string", why);
    assert.ok(out.includes(`\`${record.byFile[0].path}\``), why);
  });

  test(`ix-subsystems shows the regions ix subsystems prints (${mode.name})`, async () => {
    const pair = await readPair(ixSubsystems, {}, mode, ["subsystems"]);
    if (!mode.json) {
      // ix-subsystems lifts a map-stale diagnostic out of ix's text into a
      // line of its own under the header; the rest is passed through as is.
      // Text that was nothing but that diagnostic falls through to JSON.
      // The split is the tool's own (exported), not a copy that could drift.
      const { body, staleLine } = ixSubsystems.splitStaleDiagnostic(redactSecrets(pair.raw).trim());
      if (body) {
        assertPassedThrough(pair, "## ix-subsystems", staleLine ? `${staleLine}\n\n${body}` : body);
      } else {
        assert.match(pair.out, /^## ix-subsystems/, pair.why);
        assert.doesNotMatch(pair.out, CRASH, pair.why);
      }
      return;
    }
    const { out, record, why } = pair;
    assertAnswered(out, /^## ix-subsystems/, why);
    assert.ok(Array.isArray(record.regions), why);
    // A project this small may form no region; then, and only then, the
    // tool may say so.
    if (record.regions.length > 0) {
      assert.equal(typeof record.regions[0].label, "string", why);
      assert.ok(out.includes(`| ${record.regions[0].label} |`), why);
      assert.doesNotMatch(out, /No subsystems found/, why);
    } else {
      assert.match(out, /No subsystems found/, why);
    }
  });

  test(`ix-locate finds a symbol's text in the fixture (${mode.name})`, async () => {
    // ix-locate searches text: `ix text`, not `ix locate`.
    const cliArgs = ["text", "readCoreValue", "--limit", "10"];
    const pair = await readPair(ixLocate, { pattern: "readCoreValue", limit: 10 }, mode, cliArgs);
    if (!mode.json) {
      assertPassedThrough(pair, "## ix-locate: readCoreValue");
      assert.match(pair.raw, /readCoreValue/, pair.why);
      return;
    }
    assertAnswered(pair.out, /^## ix-locate: readCoreValue/, pair.why);
    assert.match(pair.out, /read-core\.ts/, pair.why);
  });
}

test("ix-docs-tool gives context for a symbol the graph contains", async () => {
  // JSON only: ix-docs-tool has no llm path.
  const out = await run(ixDocsTool, { target: "readCoreValue", depth: "standard" }, { json: false });
  assertAnswered(out, /^## Context: readCoreValue/);
  const { raw, record } = ixJson(["overview", "readCoreValue"]);
  // The tool renders nothing from its locate call, so Kind, read from this
  // record by name, is what proves it read ix's overview at all.
  assert.equal(typeof record.resolvedTarget?.kind, "string", raw);
  assert.ok(out.includes(`**Kind:** ${record.resolvedTarget.kind}`), `${out}\n--- ix overview ---\n${raw}`);
});
