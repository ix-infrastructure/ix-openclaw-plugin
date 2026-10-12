// Copyright 2026 Ix Infrastructure Inc.

/**
 * Argv the real `ix` rejects must not come back.
 *
 * Checked two ways: the shipped text (skills, agents, hooks, tools, docs) is
 * scanned for invocations no Ix release accepts, and tools that used to send
 * them are run against the strict fake in tests/fake-ix.mjs.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installFakeIx } from "./fake-ix.mjs";
import * as ixSmells from "../dist/tools/ix-smells.js";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalFetch = globalThis.fetch;

const FORBIDDEN = [
  // `locate` returns one resolved target; it has no --limit.
  [/ix locate [^\n`]*--limit/, "ix locate --limit"],
  [/"locate"[^\n\]]*"--limit"/, 'runIx(["locate", …, "--limit"])'],
  // `smells` has no path filter.
  [/ix smells [^\n`]*--path/, "ix smells --path"],
  [/"smells"[^\n\]]*"--path"/, 'runIx(["smells", …, "--path"])'],
  // Not commands.
  [/\bix bugs\b/, "ix bugs (use `ix bug list`)"],
  [/\bix connect\b/, "ix connect"],
  // map rejects non-directories.
  [/\["map", (targetPath|filePath|file)\b/, 'runIx(["map", <file>])'],
  // The v2 Core Runtime does not exist.
  [/127\.0\.0\.1:7743|\/v2\/(ix_query|ix_decide|graph|ingest|status)/, "v2 runtime route"],
  // Every backend read goes through `ix`, which scopes it to the workspace and
  // carries the token. A direct HTTP call skips both (PL-02).
  [/\bixHttp(Get|Post)\b|\bgetIxBackendEndpoint\b|["'`]\/v1\//, "direct backend HTTP call (go through ix)"],
];

function shippedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: projectRoot, encoding: "utf8" })
    .split("\n")
    .filter((file) => /^(skills|agents|hooks|tools|plugins|runtime)\//.test(file) || /^(README|AGENTS|SOUL)\.md$/.test(file));
}

test("shipped text never asks for argv ix rejects", () => {
  const offences = [];
  for (const file of shippedFiles()) {
    const lines = readFileSync(path.join(projectRoot, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(line)) offences.push(`${file}:${index + 1}: ${label}`);
      }
    });
  }
  assert.deepEqual(offences, []);
});

test("ix-smells never sends --path, even when given a path", async () => {
  const ix = installFakeIx();
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  resetLlmVersionCache();
  try {
    const output = await ixSmells.execute({ path: "src" }, { directory: ix.dir });
    assert.doesNotMatch(output, /unknown option/);
    assert.doesNotMatch(output, /in `src`/, "output must not claim to be path-scoped");
    const smells = ix.calls().filter((call) => call.argv[0] === "smells");
    assert.ok(smells.length > 0, "smells should have run");
    for (const call of smells) assert.ok(!call.argv.includes("--path"), call.argv.join(" "));
  } finally {
    globalThis.fetch = originalFetch;
    resetLlmVersionCache();
    ix.restore();
  }
});

// `limit` reaches `ix smells` as `--limit N` on the llm fast path, only when
// the caller set it. Every released ix rejects `--limit` on smells (so does the
// fake, unless acceptSmellsLimit()); then the JSON path, which never sends it,
// answers and cuts client-side.
const SMELLS = [
  { file: "src/low.ts", smell: "has_smell.orphan_file", confidence: 0.5, signals: { connectivity: 0 } },
  { file: "src/top.ts", smell: "has_smell.god_module", confidence: 0.9, signals: { fan_in: 20 } },
  { file: "src/mid.ts", smell: "has_smell.orphan_file", confidence: 0.7, signals: { connectivity: 0 } },
];

async function runSmells(params, { acceptLimit = false } = {}) {
  const ix = installFakeIx();
  ix.setSmells(SMELLS);
  if (acceptLimit) ix.acceptSmellsLimit();
  resetLlmVersionCache();
  try {
    const output = await ixSmells.execute(params, { directory: ix.dir });
    const calls = ix.calls().filter((call) => call.argv[0] === "smells").map((call) => call.argv.join(" "));
    return { output, calls };
  } finally {
    resetLlmVersionCache();
    ix.restore();
  }
}

test("ix-smells forwards limit as --limit to an ix that has it", async () => {
  const { output, calls } = await runSmells({ limit: 2 }, { acceptLimit: true });
  assert.deepEqual(calls, ["smells --limit 2 --format llm"]);
  assert.match(output, /file=src\/top\.ts/);
  assert.match(output, /file=src\/mid\.ts/);
  assert.doesNotMatch(output, /file=src\/low\.ts/);
  assert.match(output, /results_truncated/);
});

test("ix-smells with a limit still answers on an ix without --limit, cut client-side", async () => {
  const { output, calls } = await runSmells({ limit: 2 });
  assert.deepEqual(calls, ["smells --limit 2 --format llm", "smells --format json"]);
  assert.doesNotMatch(output, /unknown option/);
  assert.match(output, /\(showing 2 of 3\)/);
  // The cut keeps the highest-confidence candidates.
  assert.match(output, /`src\/top\.ts`/);
  assert.match(output, /`src\/mid\.ts`/);
  assert.doesNotMatch(output, /`src\/low\.ts`/);
});

test("ix-smells without a limit never sends --limit", async () => {
  const { output, calls } = await runSmells({});
  assert.deepEqual(calls, ["smells --format llm"]);
  assert.match(output, /file=src\/low\.ts/);
});

test("ix-smells caps limit at 200 and does not send a non-positive one", async () => {
  const capped = await runSmells({ limit: 500 }, { acceptLimit: true });
  assert.deepEqual(capped.calls, ["smells --limit 200 --format llm"]);
  const zero = await runSmells({ limit: 0 }, { acceptLimit: true });
  assert.deepEqual(zero.calls, ["smells --format llm"]);
});

test("the strict fake rejects what the real CLI rejects", () => {
  const ix = installFakeIx();
  try {
    const run = (args) => {
      try {
        execFileSync("ix", args, { cwd: ix.dir, stdio: "pipe", env: process.env });
        return "";
      } catch (error) {
        return String(error.stderr);
      }
    };
    assert.match(run(["map", path.join(ix.dir, "ix")]), /Map path is not a directory/);
    assert.match(run(["locate", "x", "--limit", "5"]), /unknown option '--limit'/);
    assert.match(run(["smells", "--path", "src"]), /unknown option '--path'/);
    assert.match(run(["smells", "--limit", "5"]), /unknown option '--limit'/);
    assert.match(run(["bugs"]), /unknown command/);
    assert.equal(run(["map", ix.dir, "--silent"]), "");
  } finally {
    ix.restore();
  }
});

test("ix-ingest refresh maps the git root, not the subdirectory it was called from", async () => {
  const { mkdtempSync, mkdirSync, realpathSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const ixIngest = await import("../dist/tools/ix-ingest.js");

  const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-ingest-")));
  const repo = path.join(sandbox, "repo");
  const sub = path.join(repo, "packages", "core");
  mkdirSync(sub, { recursive: true });
  execFileSync("git", ["init", "-q", repo]);
  const ix = installFakeIx();
  globalThis.fetch = async () => {
    throw new Error("offline");
  };
  try {
    const output = await ixIngest.execute({ refresh: true }, { directory: sub });
    assert.match(output, /Graph refresh complete/, output);
    const maps = ix.mapCalls();
    assert.equal(maps.length, 1);
    assert.deepEqual(maps[0].argv, ["map", repo, "--silent"]);
    assert.equal(realpathSync(maps[0].cwd), repo);
  } finally {
    globalThis.fetch = originalFetch;
    ix.restore();
    rmSync(sandbox, { recursive: true, force: true });
  }
});
