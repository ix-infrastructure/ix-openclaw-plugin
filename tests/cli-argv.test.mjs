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
    assert.match(run(["bugs"]), /unknown command/);
    assert.equal(run(["map", ix.dir, "--silent"]), "");
  } finally {
    ix.restore();
  }
});
