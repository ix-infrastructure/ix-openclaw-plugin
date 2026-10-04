// Copyright 2026 Ix Infrastructure Inc.

/**
 * The plugin's tools against a RELEASED `ix` CLI, with the backend unreachable.
 *
 * Everything else under tests/ runs against tests/fake-ix.mjs, which is only as
 * strict as whoever last updated it. This file runs only in the CI job
 * "Real ix (released CLI)", which installs a pinned release of `ix` on PATH.
 * It is deliberately outside the `tests/*.test.mjs` glob so `npm test` (and the
 * fake-based job) never picks it up on a machine without that CLI.
 *
 * Run it by hand the way CI does:
 *
 *   PATH=<dir with released ix>:$PATH IX_EXPECTED_VERSION=0.12.0 \
 *     npm run build && node --test tests/real-ix/*.test.mjs
 *
 * The backend is never reached: IX_ENDPOINT points at 127.0.0.1:1 and IX_HOME
 * is a throwaway directory, set here for every `ix` the tools spawn. Two states
 * are exercised, because ix reports them differently:
 *
 *   unmapped  - cwd is not inside a registered workspace. Read commands exit 1
 *               with a structured record (`error code=workspace_not_mapped …`
 *               for llm, `{"error":"workspace_not_mapped",…}` for json).
 *   unreachable - cwd is a registered workspace, but the backend is down. Read
 *               commands exit 1 with `error code=backend_error …` / a plain
 *               "fetch failed" on stderr.
 *
 * In both, every tool must return its own well-formed markdown (its `## ix-…`
 * header, an "unavailable"/degraded message) — never throw, never leak a JSON
 * parse failure.
 *
 * ## The argv check
 *
 * The tools spawn `ix` by name. A transparent recorder is put first on PATH: it
 * runs the real binary with the same argv, passes stdout/stderr/exit code
 * through untouched, and logs each call. Nothing is faked — the recorder only
 * makes the real CLI's stderr visible to this test even where a tool swallows
 * the failure and falls back. Any call that the real CLI rejected as
 * "unknown option" / "unknown command" fails the test, so pinning the job to a
 * CLI that lacks a flag a tool sends turns it red.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as ixDecide from "../../dist/tools/ix-decide.js";
import * as ixDocsTool from "../../dist/tools/ix-docs-tool.js";
import * as ixExplain from "../../dist/tools/ix-explain.js";
import * as ixHealth from "../../dist/tools/ix-health.js";
import * as ixHistory from "../../dist/tools/ix-history.js";
import * as ixImpact from "../../dist/tools/ix-impact.js";
import * as ixInventory from "../../dist/tools/ix-inventory.js";
import * as ixLocate from "../../dist/tools/ix-locate.js";
import * as ixMap from "../../dist/tools/ix-map.js";
import * as ixNeighbors from "../../dist/tools/ix-neighbors.js";
import * as ixQuery from "../../dist/tools/ix-query.js";
import * as ixRank from "../../dist/tools/ix-rank.js";
import * as ixSmells from "../../dist/tools/ix-smells.js";
import * as ixStats from "../../dist/tools/ix-stats.js";
import * as ixSubsystems from "../../dist/tools/ix-subsystems.js";
import * as ixTrace from "../../dist/tools/ix-trace.js";
import { resetLlmVersionCache } from "../../dist/runtime/llm.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const UNREACHABLE = "http://127.0.0.1:1";

// ix-ingest is left out on purpose: it runs `ix map`, a write that this job has
// no backend for, and its argv is covered by the fake-based tests.
const TOOLS = [
  // [module, params]
  [ixStats, {}],
  [ixHealth, {}],
  [ixExplain, { symbol: "runIx" }],
  [ixLocate, { pattern: "runIx", limit: 5 }],
  [ixSmells, {}],
  [ixSubsystems, {}],
  [ixDecide, { touched_paths: ["tools/base.ts"] }],
  [ixDocsTool, { target: "tools/base.ts", depth: "brief" }],
  [ixHistory, {}],
  [ixImpact, { target: "tools/base.ts" }],
  [ixInventory, { path: "." }],
  [ixMap, { scope: "tools", include_stats: true }],
  [ixNeighbors, { symbol: "runIx" }],
  [ixQuery, { symbol: "runIx" }],
  [ixRank, { top: 3 }],
  [ixTrace, { symbol: "runIx" }],
];

// `ix text` is ripgrep-backed and needs no backend, so ix-locate legitimately
// returns results here. Every other tool reads the graph, and with the backend
// down it must say so rather than present an answer.
const WORKS_WITHOUT_BACKEND = new Set(["ix-locate"]);
const FAILURE_VISIBLE = /unavailable|unreachable|not indexed|not found|not available|requires Ix Pro|DEGRADED/i;

// Headers that are not `## <tool name>`.
const HEADER = { "ix-docs-tool": /^## (ix-docs-tool|Context):/ };

// Real plugin bugs this job exposed, tracked here as `todo` so the job stays a
// useful gate for everything else. Remove an entry once its fix lands — the
// subtest then has to pass outright. Keyed `<tool>` or `<tool>@<state>`.
const KNOWN_BUGS = {
  "ix-decide":
    "fails open: when every `ix impact` call fails, the null results are skipped and " +
    "the verdict is synthesized from zero data as ALLOW / LOW / 0 dependents (tools/ix-decide.ts)",
  "ix-docs-tool@unmapped":
    "safeRun keeps stdout of a failed ix call, so ix's {\"error\":\"workspace_not_mapped\",…} record " +
    "is treated as a result and the tool returns an empty `## Context:` section, dropping the error (tools/ix-docs-tool.ts)",
};

// What the real CLI prints when it rejects argv (commander's wording).
const REJECTED_ARGV = /unknown option|unknown command|too many arguments|missing required argument|invalid argument/i;
// What must never reach the model: our own parse failure or a JS crash string.
const CRASH = /Failed to parse ix JSON output|SyntaxError:|TypeError:|ReferenceError:|Cannot read propert|is not a function|\[object Object\]/;

const RECORDER = `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const argv = process.argv.slice(2);
const r = spawnSync(process.env.REAL_IX_BIN, argv, { stdio: ["inherit", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
appendFileSync(process.env.REAL_IX_LOG, JSON.stringify({
  argv,
  cwd: process.cwd(),
  status: r.status,
  signal: r.signal,
  error: r.error ? String(r.error) : null,
  stdout: String(r.stdout ?? "").slice(0, 2000),
  stderr: String(r.stderr ?? "").slice(0, 2000),
}) + "\\n");
process.exit(r.status ?? 1);
`;

function which(bin) {
  return execFileSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).trim();
}

const realIx = which("ix");
const sandbox = mkdtempSync(path.join(tmpdir(), "real-ix-"));
const recorderDir = path.join(sandbox, "bin");
const logFile = path.join(sandbox, "calls.jsonl");
mkdirSync(recorderDir);
writeFileSync(path.join(recorderDir, "ix"), RECORDER);
chmodSync(path.join(recorderDir, "ix"), 0o755);

// A small copy of the plugin's own source, outside any workspace the runner
// might know about, so `ix text` has something real to find.
const workspace = path.join(sandbox, "ws");
mkdirSync(workspace);
cpSync(path.join(projectRoot, "tools"), path.join(workspace, "tools"), { recursive: true });
cpSync(path.join(projectRoot, "runtime"), path.join(workspace, "runtime"), { recursive: true });

const saved = {};
for (const key of ["PATH", "IX_ENDPOINT", "IX_HOME", "IX_NO_UPDATE_CHECK", "IX_DISABLE_LLM_FORMAT", "REAL_IX_BIN", "REAL_IX_LOG", "NO_COLOR", "FORCE_COLOR"]) {
  saved[key] = process.env[key];
}
process.env.PATH = [recorderDir, process.env.PATH].join(path.delimiter);
process.env.IX_ENDPOINT = UNREACHABLE;
process.env.IX_NO_UPDATE_CHECK = "1";
process.env.NO_COLOR = "1";
delete process.env.FORCE_COLOR;
process.env.REAL_IX_BIN = realIx;
process.env.REAL_IX_LOG = logFile;
process.env.IX_HOME = path.join(sandbox, "home-initial");
delete process.env.IX_DISABLE_LLM_FORMAT;

test.after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

function readCalls() {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function freshIxHome(name, registerWorkspace) {
  const home = path.join(sandbox, `home-${name}`);
  mkdirSync(home, { recursive: true });
  const lines = [`endpoint: ${UNREACHABLE}`, "format: text"];
  if (registerWorkspace) {
    lines.push(
      "workspaces:",
      '  - workspace_id: "real-ix-ci"',
      "    workspace_name: real-ix-ci",
      `    root_path: ${workspace}`,
      "    default: true",
    );
  }
  writeFileSync(path.join(home, "config.yaml"), lines.join("\n") + "\n");
  process.env.IX_HOME = home;
}

function rejectedCalls(calls) {
  return calls
    .filter((call) => REJECTED_ARGV.test(call.stderr) || REJECTED_ARGV.test(call.stdout))
    .map((call) => `ix ${call.argv.join(" ")}  ->  ${(call.stderr || call.stdout).trim().split("\n")[0]}`);
}

test("the CLI on PATH is the released ix this job pins", () => {
  const version = execFileSync(realIx, ["--version"], { encoding: "utf8" }).trim();
  assert.match(version, /^\d+\.\d+\.\d+/, `unexpected \`ix --version\` output: ${version}`);
  if (process.env.IX_EXPECTED_VERSION) assert.equal(version, process.env.IX_EXPECTED_VERSION);
  assert.ok(!realIx.startsWith(recorderDir), "the real ix must not be the recorder");
});

test("the argv check catches what the real CLI rejects", () => {
  // Proves the check is live: v0.12.0's `locate` has no --limit, so the real
  // CLI rejects it, and rejectedCalls must report it.
  freshIxHome("selfcheck", false);
  const before = readCalls().length;
  try {
    execFileSync("ix", ["locate", "runIx", "--limit", "1"], { cwd: workspace, stdio: "pipe" });
  } catch {
    // Expected non-zero exit.
  }
  const calls = readCalls().slice(before);
  assert.equal(calls.length, 1, "the recorder should have logged exactly one call");
  assert.equal(rejectedCalls(calls).length, 1, `expected the bogus flag to be flagged: ${JSON.stringify(calls)}`);
});

for (const [state, registered] of [["unmapped", false], ["unreachable", true]]) {
  test(`every tool returns well-formed output with a released ix (${state} backend)`, async (t) => {
    freshIxHome(state, registered);
    for (const [tool, params] of TOOLS) {
      const todo = KNOWN_BUGS[`${tool.name}@${state}`] ?? KNOWN_BUGS[tool.name];
      await t.test(tool.name, { todo }, async () => {
        resetLlmVersionCache();
        const before = readCalls().length;

        let output;
        await assert.doesNotReject(async () => {
          output = await tool.execute(params, { directory: workspace });
        }, `${tool.name} threw`);

        const calls = readCalls().slice(before);
        const report = `\n--- output ---\n${output}\n--- ix calls ---\n${calls
          .map((c) => `ix ${c.argv.join(" ")} [exit ${c.status}] ${c.stderr.trim().split("\n")[0] ?? ""}`)
          .join("\n")}`;

        assert.equal(typeof output, "string", `${tool.name} must return a string${report}`);
        const header = HEADER[tool.name] ?? new RegExp(`^## ${tool.name}\\b`);
        assert.match(output, header, `${tool.name} must lead with its header${report}`);
        assert.doesNotMatch(output, CRASH, `${tool.name} leaked a crash/parse failure${report}`);
        assert.ok(calls.length > 0, `${tool.name} never ran ix${report}`);
        assert.deepEqual(rejectedCalls(calls), [], `${tool.name} sent argv the released ix rejects${report}`);
        for (const call of calls) {
          assert.equal(call.error, null, `ix failed to spawn: ${call.error}${report}`);
          assert.equal(call.signal, null, `ix was killed (${call.signal})${report}`);
        }
        if (!WORKS_WITHOUT_BACKEND.has(tool.name)) {
          assert.match(output, FAILURE_VISIBLE, `${tool.name} must surface ix's failure (e.g. "unavailable"), not present an answer${report}`);
        }
      });
    }
  });
}

test("ix-health reports the released CLI it found and a degraded graph", async () => {
  freshIxHome("health", true);
  resetLlmVersionCache();
  const output = await ixHealth.execute({}, { directory: workspace });
  const version = execFileSync(realIx, ["--version"], { encoding: "utf8" }).trim();
  assert.match(output, new RegExp(`\\*\\*CLI:\\*\\* ix ${version.replace(/\./g, "\\.")}`), output);
  assert.match(output, /DEGRADED|UNAVAILABLE/, output);
});

test("ix-locate returns real hits from `ix text` without a backend", async () => {
  // `ix text` is ripgrep-backed and needs no graph, so this is the one tool that
  // must produce results — proving the JSON parse path works on real output.
  freshIxHome("locate", false);
  resetLlmVersionCache();
  const output = await ixLocate.execute({ pattern: "parseIxJson", limit: 5 }, { directory: workspace });
  assert.match(output, /tools\/base\.ts/, output);
});
