// Copyright 2026 Ix Infrastructure Inc.

/**
 * The session briefing goes in once per window, per workspace.
 *
 * The plugin's `before_prompt_build` is the one path that injects it. It used
 * to inject on every prompt build: its cache stopped it re-running
 * `ix briefing`, not re-injecting the output. The claim in runtime/briefing.ts
 * is what makes it once.
 *
 * Every `ix` call goes to the strict fake in tests/fake-ix.mjs.
 */

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import entry from "../dist/plugins/ix-plugin.js";
import {
  BRIEFING_MAX_CHARS,
  BRIEFING_TTL_MS,
  capBriefing,
  claimBriefing,
  releaseBriefingClaim,
  resetBriefingClaims,
} from "../dist/runtime/briefing.js";

const HEADER = "[ix] Session briefing:\n";
const BRIEFING = "Ix Briefing\n  Revision: 2741\n  Goals: ship the plugin\n";

function beforePromptBuild() {
  let handler;
  entry.register({
    registerTool() {},
    on(name, fn) {
      if (name === "before_prompt_build") handler = fn;
    },
  });
  return (workspaceDir) => handler({ prompt: "hi", messages: [] }, { workspaceDir });
}

/**
 * Fresh workspaces and a fake `ix`. Every case uses workspaces of its own, so
 * neither the claims nor getBriefing's per-workspace cache carry over.
 */
function sandbox() {
  resetBriefingClaims();
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-briefing-")));
  const ix = installFakeIx();
  return {
    ix,
    /** A new, existing workspace directory. */
    workspace(prefix) {
      return mkdtempSync(path.join(dir, prefix));
    },
    briefingCalls() {
      return ix.calls().filter((call) => call.argv[0] === "briefing");
    },
    restore() {
      ix.restore();
      resetBriefingClaims();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── before_prompt_build ────────────────────────────────────────────────────

test("the first prompt build in a window injects, as text, and later ones do not", async () => {
  const env = sandbox();
  try {
    env.ix.setBriefing(BRIEFING);
    const build = beforePromptBuild();
    const workspace = env.workspace("once-");

    const first = await build(workspace);
    assert.equal(first?.prependContext, HEADER + BRIEFING.trim());
    assert.equal(await build(workspace), undefined);
    assert.equal(await build(workspace), undefined);

    // text, not json: nothing parses it -- it is pasted into a prompt, and the
    // same briefing measured 4,352 bytes as json against 1,305 as text.
    const calls = env.briefingCalls();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].argv, ["briefing", "--format", "text"]);
    assert.equal(calls[0].cwd, workspace);
  } finally {
    env.restore();
  }
});

test("overlapping prompt builds inject once", async () => {
  const env = sandbox();
  try {
    env.ix.setBriefing(BRIEFING);
    const build = beforePromptBuild();
    const workspace = env.workspace("overlap-");

    const results = await Promise.all([build(workspace), build(workspace), build(workspace)]);
    assert.equal(results.filter((result) => result?.prependContext).length, 1);
  } finally {
    env.restore();
  }
});

test("one workspace's window does not suppress another's", async () => {
  const env = sandbox();
  try {
    env.ix.setBriefing(BRIEFING);
    const build = beforePromptBuild();
    const a = env.workspace("a-");
    const b = env.workspace("b-");

    assert.ok((await build(a))?.prependContext);
    assert.ok((await build(b))?.prependContext, "b has its own window");
    assert.equal(await build(a), undefined);
    assert.equal(await build(b), undefined);
  } finally {
    env.restore();
  }
});

test("no briefing (Ix Pro absent) injects nothing and does not use up the window", async () => {
  const env = sandbox();
  try {
    const build = beforePromptBuild();
    const workspace = env.workspace("no-pro-");

    assert.equal(await build(workspace), undefined);
    assert.notEqual(claimBriefing(workspace), null, "the claim was handed back");
  } finally {
    env.restore();
  }
});

test("a briefing over the cap is cut before it reaches the prompt", async () => {
  const env = sandbox();
  try {
    env.ix.setBriefing("x".repeat(BRIEFING_MAX_CHARS * 3));
    const build = beforePromptBuild();
    const workspace = env.workspace("cap-");

    const context = (await build(workspace))?.prependContext;
    assert.ok(context);
    assert.ok(context.startsWith(HEADER + "x".repeat(BRIEFING_MAX_CHARS)));
    assert.ok(!context.includes("x".repeat(BRIEFING_MAX_CHARS + 1)));
    assert.match(context, /briefing truncated/);
  } finally {
    env.restore();
  }
});

// ── the claim ──────────────────────────────────────────────────────────────

test("the claim expires with its window", () => {
  resetBriefingClaims();
  const root = "/projects/expiry";
  const t0 = 1_000_000;

  assert.equal(claimBriefing(root, t0), t0);
  assert.equal(claimBriefing(root, t0 + 1), null);
  assert.equal(claimBriefing(root, t0 + BRIEFING_TTL_MS - 1), null, "still inside the window");
  assert.equal(claimBriefing(root, t0 + BRIEFING_TTL_MS), t0 + BRIEFING_TTL_MS, "window over");

  // The window is the caller's: a minute-old claim has expired in a 30s
  // window and holds in a 2min one.
  const t1 = t0 + BRIEFING_TTL_MS + 60_000;
  assert.equal(claimBriefing(root, t1, 30_000), t1);
  assert.equal(claimBriefing(root, t1 + 60_000, 120_000), null);
  assert.equal(claimBriefing(root, t1 + 60_000, 30_000), t1 + 60_000);
  resetBriefingClaims();
});

test("a released claim frees the window, but only its own", () => {
  resetBriefingClaims();
  const root = "/projects/release";

  const first = claimBriefing(root, 1_000);
  releaseBriefingClaim(root, first);
  const second = claimBriefing(root, 2_000);
  assert.equal(second, 2_000, "released, so claimable again");

  // A stale release (from a claim already replaced) leaves the newer one.
  releaseBriefingClaim(root, first);
  assert.equal(claimBriefing(root, 3_000), null);
  resetBriefingClaims();
});

// ── the cap ────────────────────────────────────────────────────────────────

test("a briefing longer than the cap is cut and says so", () => {
  const long = "x".repeat(BRIEFING_MAX_CHARS + 500);
  const capped = capBriefing(long);

  assert.ok(capped.length < long.length);
  assert.ok(capped.startsWith("x".repeat(BRIEFING_MAX_CHARS)));
  assert.match(capped, /briefing truncated/);
});

test("a briefing within the cap is passed through, trimmed", () => {
  assert.equal(capBriefing("  Ix Briefing\n  Revision: 2741  "), "Ix Briefing\n  Revision: 2741");
  assert.equal(capBriefing("x".repeat(BRIEFING_MAX_CHARS)), "x".repeat(BRIEFING_MAX_CHARS));
  assert.equal(capBriefing("   "), "");
});
