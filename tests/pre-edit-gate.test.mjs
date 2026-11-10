// Copyright 2026 Ix Infrastructure Inc.

/**
 * The pre-edit gate (before_tool_call -> ix-decide) must not hold an edit for
 * long, and must not call a missing directory a missing ix.
 *
 * - A `write` into a directory that does not exist yet used to spawn `ix` with
 *   that directory as its cwd. Node reports that as `spawn ix ENOENT`, which
 *   ix-decide read as "ix is not installed".
 * - `ix impact` ran with runIx's 60 s default, so a backend that accepts the
 *   connection and never answers held every edit for a minute per batch.
 *
 * Every `ix` call goes to the strict fake in tests/fake-ix.mjs.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import entry from "../dist/plugins/ix-plugin.js";
import * as ixDecide from "../dist/tools/ix-decide.js";
import { IxCommandError, runIx } from "../dist/tools/base.js";

function sandbox() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-gate-")));
  const saved = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  process.env.HOME = path.join(dir, "home");
  process.env.XDG_STATE_HOME = path.join(dir, "state");
  mkdirSync(process.env.HOME, { recursive: true });
  const ix = installFakeIx();
  return {
    dir,
    ix,
    restore() {
      ix.restore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function gateFor(workspaceDir) {
  const hooks = new Map();
  entry.register({
    registerTool() {},
    on(name, handler) {
      hooks.set(name, handler);
    },
    config: { agents: {} },
    runtime: {
      config: { current: () => ({ agents: {} }) },
      agent: { resolveAgentWorkspaceDir: (_cfg, agentId) => (agentId === "main" ? workspaceDir : undefined) },
    },
  });
  return hooks.get("before_tool_call");
}

// ── A file in a directory that does not exist yet ───────────────────────────

test("a write into a new directory still asks ix, from a directory that exists", async () => {
  const env = sandbox();
  try {
    const workspace = path.join(env.dir, "ws");
    mkdirSync(workspace, { recursive: true });
    const target = path.join(workspace, "new-dir", "deeper", "file.ts");
    env.ix.setImpact({
      [target]: { error: "unresolved_target", message: `No file "${target}" in the graph.`, reason: "file_not_found" },
    });

    const result = await gateFor(workspace)(
      { toolName: "write", toolCallId: "nd1", params: { path: "new-dir/deeper/file.ts", content: "export {};" } },
      { agentId: "main", toolName: "write" }
    );

    assert.equal(result, undefined, "a new file is ALLOW: silent");
    const impact = env.ix.calls().find((call) => call.argv[0] === "impact");
    assert.ok(impact, "ix was spawned; before, the spawn failed with ENOENT and ix never ran");
    assert.deepEqual(impact.argv, ["impact", target, "--format", "json"]);
    assert.equal(impact.cwd, workspace, "run from the nearest directory that exists");
  } finally {
    env.restore();
  }
});

test("a write into a new directory is assessed as a new file, not 'ix is not installed'", async () => {
  const env = sandbox();
  try {
    const workspace = path.join(env.dir, "ws");
    mkdirSync(workspace, { recursive: true });
    const target = path.join(workspace, "new-dir", "file.ts");
    env.ix.setImpact({
      [target]: { error: "unresolved_target", message: `No file "${target}" in the graph.`, reason: "file_not_found" },
    });

    const out = await ixDecide.execute({ touched_paths: [target], intent: "add" }, { directory: workspace });

    assert.doesNotMatch(out, /not installed/);
    assert.match(out, /\*\*Verdict:\*\* ALLOW/);
    assert.match(out, /New \(not in the graph yet\)/);
  } finally {
    env.restore();
  }
});

test("ix-decide run from a missing directory says so instead of 'ix is not installed'", async () => {
  const env = sandbox();
  try {
    const missing = path.join(env.dir, "gone");
    const out = await ixDecide.execute({ touched_paths: [path.join(missing, "a.ts")] }, { directory: missing });

    assert.doesNotMatch(out, /not installed/);
    assert.match(out, /working directory does not exist/);
    assert.equal(env.ix.calls().length, 0, "nothing was spawned");
  } finally {
    env.restore();
  }
});

test("runIx rejects a missing cwd without spawning, and ix missing is still ENOENT", async () => {
  const env = sandbox();
  try {
    const missing = path.join(env.dir, "gone");
    await assert.rejects(runIx(["status"], { cwd: missing }), (error) => {
      assert.ok(error instanceof IxCommandError);
      assert.match(error.message, /working directory does not exist/);
      assert.equal(error.timedOut, false);
      return true;
    });
    assert.equal(env.ix.calls().length, 0);

    process.env.PATH = path.join(env.dir, "empty-bin");
    await assert.rejects(runIx(["status"], { cwd: env.dir }), /ENOENT/);
  } finally {
    env.restore();
  }
});

// ── A backend that never answers ────────────────────────────────────────────

test("ix-decide with a deadline marks a hung ix 'not assessed' and returns in time", async () => {
  const env = sandbox();
  try {
    env.ix.setHang();
    const files = Array.from({ length: 6 }, (_, i) => path.join(env.dir, `f${i}.ts`));
    const started = Date.now();
    const out = await ixDecide.execute({ touched_paths: files }, { directory: env.dir }, { timeoutMs: 600 });
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 3000, `returned after ${elapsed} ms; the budget is for the whole verdict, not per file`);
    assert.match(out, /\*\*Verdict:\*\* ALLOW/);
    assert.match(out, /\*\*Risk:\*\* UNKNOWN/);
    assert.match(out, /did not answer within/);
    assert.doesNotMatch(out, /not installed/);
  } finally {
    env.restore();
  }
});

test("before_tool_call returns within the hook timeout when the backend never answers", async () => {
  const env = sandbox();
  try {
    env.ix.setHang();
    const files = Array.from({ length: 5 }, (_, i) => path.join(env.dir, `f${i}.ts`));
    const patch = [
      "*** Begin Patch",
      ...files.flatMap((file) => [`*** Update File: ${file}`, "@@", "-a", "+b"]),
      "*** End Patch",
    ].join("\n");

    const started = Date.now();
    const result = await gateFor(env.dir)(
      { toolName: "apply_patch", toolCallId: "h1", params: { input: patch } },
      { agentId: "main", toolName: "apply_patch" }
    );
    const elapsed = Date.now() - started;

    assert.equal(result, undefined, "not assessed is not a reason to ask: the edit goes ahead");
    // 8 s budget for the whole gate (two batches of four used to be 2 x 60 s).
    assert.ok(elapsed < 10_000, `before_tool_call took ${elapsed} ms`);
    assert.ok(env.ix.calls().some((call) => call.argv[0] === "impact"), "ix was asked");
  } finally {
    env.restore();
  }
});

test("runIx says a timeout is a timeout, and settles at it behind a shell wrapper", async () => {
  // A shell wrapper that does not `exec` its child: killing the wrapper leaves
  // the child holding stdout, which must not hold up the answer.
  const env = sandbox();
  try {
    const bin = path.join(env.dir, "wrapper-bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "ix"), "#!/bin/sh\nsleep 3\nexit 0\n");
    chmodSync(path.join(bin, "ix"), 0o755);
    process.env.PATH = [bin, "/usr/bin", "/bin"].join(path.delimiter);

    const started = Date.now();
    await assert.rejects(runIx(["impact", "x"], { cwd: env.dir, timeoutMs: 300 }), (error) => {
      assert.ok(error instanceof IxCommandError);
      assert.equal(error.timedOut, true);
      assert.match(error.message, /did not answer within/);
      return true;
    });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `settled after ${elapsed} ms`);
  } finally {
    env.restore();
  }
});
