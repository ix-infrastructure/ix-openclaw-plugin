// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import * as ixDecide from "../dist/tools/ix-decide.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";

// Found by the real-ix CI job: with every ix call failing, ix-decide answered
// ALLOW / LOW / 0 dependents, and ix-docs-tool rendered ix's error record as an
// empty context section.

test("ix-decide never allows a change it could not measure", async () => {
  const ix = installFakeIx();
  try {
    ix.setImpact({ "src/a.ts": "FAIL" });
    const out = await ixDecide.execute({ touched_paths: ["src/a.ts"] }, { directory: ix.dir });
    assert.doesNotMatch(out, /Verdict:\*\* ALLOW/);
    assert.match(out, /Verdict:\*\* REVIEW/);
    assert.match(out, /could not measure/);
    assert.match(out, /Not measured:\*\* `src\/a\.ts`/);
  } finally {
    ix.restore();
  }
});

test("ix-decide still allows a measured low-risk change, and names an unmeasured file beside it", async () => {
  const ix = installFakeIx();
  try {
    ix.setImpact({ "src/a.ts": { risk: "low", dependentCount: 1 }, "src/b.ts": "FAIL" });
    const one = await ixDecide.execute({ touched_paths: ["src/a.ts"] }, { directory: ix.dir });
    assert.match(one, /Verdict:\*\* ALLOW/);
    const both = await ixDecide.execute({ touched_paths: ["src/a.ts", "src/b.ts"] }, { directory: ix.dir });
    assert.match(both, /Verdict:\*\* REVIEW/);
    assert.match(both, /1 of 2 files/);
  } finally {
    ix.restore();
  }
});

test("ix-docs-tool reports ix's error record instead of an empty section", async () => {
  const ix = installFakeIx();
  try {
    ix.setUnmapped();
    const out = await ixDocsTool.execute({ target: "tools/base.ts", depth: "brief" }, { directory: ix.dir });
    assert.match(out, /ix could not answer:\*\* `workspace_not_mapped`/);
    assert.doesNotMatch(out, /## Context:/);
  } finally {
    ix.restore();
  }
});

test("ix-docs-tool says ix is unavailable, not \"not found\", when the backend is down", async () => {
  const ix = installFakeIx();
  try {
    ix.setUnreachable();
    const out = await ixDocsTool.execute({ target: "tools/base.ts", depth: "brief" }, { directory: ix.dir });
    assert.match(out, /^## ix-docs-tool: tools\/base\.ts/);
    assert.match(out, /ix unavailable/);
    assert.match(out, /fetch failed/);
    assert.doesNotMatch(out, /Not found in graph/);
  } finally {
    ix.restore();
  }
});
