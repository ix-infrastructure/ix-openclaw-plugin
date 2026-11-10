// Copyright 2026 Ix Infrastructure Inc.

/**
 * ix-query, ix-neighbors, ix-map, ix-ingest, ix-health and ix-smells against a RELEASED
 * `ix` and a LIVE throwaway backend (issue #67).
 *
 * These tools used to read JSON fields no released ix prints, so a real
 * answer came back as "No matches found", "callers: none", `[object Object]`
 * or an empty status. tests/cli-record-shapes.test.mjs feeds them records in
 * the CLI's shape; this file checks those shapes against the CLI itself, so a
 * field that is named wrong in tools/cli-records.ts fails here by name.
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
import * as ixHealth from "../../../dist/tools/ix-health.js";
import * as ixIngest from "../../../dist/tools/ix-ingest.js";
import * as ixMap from "../../../dist/tools/ix-map.js";
import * as ixNeighbors from "../../../dist/tools/ix-neighbors.js";
import * as ixQuery from "../../../dist/tools/ix-query.js";
import * as ixSmells from "../../../dist/tools/ix-smells.js";

const endpoint = process.env.IX_LIVE_ENDPOINT;

const saved = {};
for (const key of ["IX_ENDPOINT", "IX_HOME", "IX_NO_UPDATE_CHECK", "NO_COLOR", "FORCE_COLOR"]) saved[key] = process.env[key];

const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "real-ix-graph-")));
const workspace = path.join(sandbox, "ws");
const ctx = { directory: workspace };

const CRASH = /\[object Object\]|undefined|NaN/;

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

  // coreValue is called from three files.
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

test.beforeEach(() => resetLlmVersionCache());

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

function ixJson(args) {
  const raw = execFileSync("ix", [...args, "--format", "json"], { cwd: workspace, encoding: "utf8" });
  return { raw, record: JSON.parse(raw) };
}

test("the real records carry the fields tools/cli-records.ts reads", () => {
  // Pins the shapes themselves, so a CLI that renames a field fails here by name.
  const locate = ixJson(["locate", "coreValue"]);
  assert.equal(typeof locate.record.resolvedTarget?.name, "string", locate.raw);
  assert.equal(typeof locate.record.resolvedTarget?.kind, "string", locate.raw);

  const callers = ixJson(["callers", "coreValue"]);
  assert.ok(Array.isArray(callers.record.results), callers.raw);

  const status = ixJson(["status"]);
  assert.equal(typeof status.record.graphCompleted, "boolean", status.raw);

  const stats = ixJson(["stats"]);
  assert.equal(typeof stats.record.nodes?.total, "number", stats.raw);
  assert.ok(Array.isArray(stats.record.nodes?.byKind), stats.raw);
});

test("ix-query prints the kind and path of a symbol ix locate resolves", async () => {
  const out = await ixQuery.execute({ symbol: "coreValue" }, ctx);
  assert.doesNotMatch(out, /No matches found/, out);
  assert.match(out, /\*\*Kind:\*\* function/, out);
  assert.match(out, /\*\*Path:\*\* \S*src\/core\.ts/, out);
  assert.doesNotMatch(out, CRASH, out);
});

test("ix-neighbors lists the rows ix callers returns", async () => {
  const out = await ixNeighbors.execute({ symbol: "coreValue", direction: "callers" }, ctx);
  assert.doesNotMatch(out, /\*\*callers:\*\* none/, out);
  assert.match(out, /`use[123]`/, out);
  assert.doesNotMatch(out, CRASH, out);
});

test("ix-map prints the codebase totals and no [object Object]", async () => {
  const out = await ixMap.execute({}, ctx);
  assert.match(out, /\*\*Codebase:\*\* \d+ files · \d+ nodes/, out);
  assert.doesNotMatch(out, /\| unknown/, out);
  assert.doesNotMatch(out, CRASH, out);
});

test("ix-ingest status reports the ingested graph ix status describes", async () => {
  const out = await ixIngest.execute({}, ctx);
  assert.match(out, /\*\*Graph ingested:\*\* yes/, out);
  assert.doesNotMatch(out, CRASH, out);
});

test("ix-health calls a mapped workspace OK", async () => {
  const out = await ixHealth.execute({}, ctx);
  assert.match(out, /\*\*Status:\*\* OK/, out);
  assert.doesNotMatch(out, CRASH, out);
});

test("ix-smells reads back stored smells with ix smells --list (issue #71)", async () => {
  // Detection stores a set of smell claims and prints them as candidates[];
  // --list reads the stored claims back, without re-running, as smells[].
  const detected = ixJson(["smells"]);
  assert.ok(Array.isArray(detected.record.candidates), detected.raw);
  const listed = ixJson(["smells", "--list"]);
  assert.ok(Array.isArray(listed.record.smells), listed.raw);
  assert.equal(typeof listed.record.count, "number", listed.raw);

  const out = await ixSmells.execute({}, ctx);
  assert.match(out, /^## ix-smells/, out);
  assert.doesNotMatch(out, /sent no rows/, out);
  if (listed.record.smells.length > 0) {
    assert.match(out, /Stored smell results/, out);
    assert.match(out, new RegExp(`entity \`${listed.record.smells[0].entity_id}\``), out);
  }
  assert.doesNotMatch(out, CRASH, out);
});
