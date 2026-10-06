// Copyright 2026 Ix Infrastructure Inc.

/**
 * ix-decide against a RELEASED `ix` and a LIVE throwaway backend.
 *
 * tests/real-ix/tools.test.mjs runs with the backend unreachable, so it proves
 * the tools degrade well but never sees a real impact answer. That is how
 * ix-decide went on reading `risk`/`dependentCount` (fields no released ix
 * prints) and calling every file LOW with 0 dependents. Here the released CLI
 * maps a small project into a real backend and ix-decide has to read its
 * actual `ix impact` output: a file six others import must not come back as
 * "0 dependents".
 *
 * Runs only in the CI job "Real ix (released CLI)", after it starts
 * tests/real-ix/compose.yml. It needs IX_LIVE_ENDPOINT and fails without it,
 * rather than skipping, so the job cannot go green without having run it.
 * By hand (spare port, controlled PATH):
 *
 *   IX_LIVE_PORT=8611 docker compose -p ix-oc-live -f tests/real-ix/compose.yml up -d --wait
 *   PATH=<dir with released ix>:<node>/bin:/usr/bin:/bin IX_LIVE_ENDPOINT=http://127.0.0.1:8611 \
 *     node --test tests/real-ix/live/*.test.mjs
 *   docker compose -p ix-oc-live -f tests/real-ix/compose.yml down -v
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as ixDecide from "../../../dist/tools/ix-decide.js";

const endpoint = process.env.IX_LIVE_ENDPOINT;

const saved = {};
for (const key of ["IX_ENDPOINT", "IX_HOME", "IX_NO_UPDATE_CHECK", "NO_COLOR", "FORCE_COLOR"]) saved[key] = process.env[key];

const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "real-ix-live-")));
const workspace = path.join(sandbox, "ws");

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

  // core.ts is imported by six files, each calling both its functions;
  // leaf.ts by none.
  mkdirSync(path.join(workspace, "src"), { recursive: true });
  writeFileSync(
    path.join(workspace, "src", "core.ts"),
    'export function coreValue(n: number): number { return n * 2; }\nexport function coreName(): string { return "core"; }\n'
  );
  for (let i = 1; i <= 6; i++) {
    writeFileSync(
      path.join(workspace, "src", `user${i}.ts`),
      `import { coreValue, coreName } from "./core";\nexport function use${i}(): string { return coreName() + coreValue(${i}); }\n`
    );
  }
  writeFileSync(path.join(workspace, "src", "leaf.ts"), "export function lonely(): number { return 1; }\n");
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

function decide(file) {
  return ixDecide.execute({ touched_paths: [path.join(workspace, "src", file)] }, { directory: workspace });
}

function dependents(output) {
  const match = output.match(/\*\*Total dependents:\*\* (\d+)/);
  assert.ok(match, `no dependent count in:\n${output}`);
  return Number(match[1]);
}

test("the real impact record carries the fields ix-decide reads", () => {
  // Pins the shape itself, so a CLI that renames them fails here by name.
  const raw = execFileSync("ix", ["impact", path.join(workspace, "src", "core.ts"), "--format", "json"], {
    cwd: workspace,
    encoding: "utf8",
  });
  const record = JSON.parse(raw);
  assert.equal(typeof record.riskLevel, "string", raw);
  assert.equal(typeof record.summary?.directImporters, "number", raw);
  assert.equal(typeof record.summary?.memberLevelCallers, "number", raw);
});

test("ix-decide reads a real impact answer: an imported file is not 0 dependents", async () => {
  const out = await decide("core.ts");
  assert.ok(dependents(out) >= 6, `core.ts has six importers:\n${out}`);
  assert.doesNotMatch(out, /\*\*Risk:\*\* (LOW|UNKNOWN)/, out);
  assert.match(out, /\*\*Verdict:\*\* REVIEW/, out);
  assert.doesNotMatch(out, /BLOCK|Not assessed/, out);
});

test("ix-decide allows a real file nothing depends on", async () => {
  const out = await decide("leaf.ts");
  assert.match(out, /\*\*Verdict:\*\* ALLOW/, out);
  assert.match(out, /\*\*Risk:\*\* LOW/, out);
  assert.equal(dependents(out), 0, out);
  assert.doesNotMatch(out, /Not assessed/, out);
});

test("ix-decide allows a file not written yet as new, against the real graph", async () => {
  const out = await decide("fresh.ts");
  assert.match(out, /\*\*Verdict:\*\* ALLOW/, out);
  assert.match(out, /New \(not in the graph yet\)/, out);
});
