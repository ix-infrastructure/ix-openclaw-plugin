// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import test from "node:test";

import { impactRecord, installFakeIx } from "./fake-ix.mjs";
import * as ixDecide from "../dist/tools/ix-decide.js";

// ix-decide against `ix impact` records in the shape the released CLI prints
// (riskLevel + summary counts + propagationBuckets). It used to read `risk`,
// `dependentCount` and `subsystems`, which no released ix prints, so with the
// real CLI every file read LOW with 0 dependents and nothing was ever gated.

async function decide(paths, extra = {}) {
  return ixDecide.execute({ touched_paths: paths, ...extra }, { directory: process.cwd() });
}

function withFake(fn) {
  return async () => {
    const ix = installFakeIx();
    try {
      await fn(ix);
    } finally {
      ix.restore();
    }
  };
}

test("ix-decide reviews a file the real CLI rates medium risk", withFake(async (ix) => {
  ix.setImpact({ "src/lib.ts": impactRecord({ riskLevel: "medium", importers: 2, memberCallers: 3 }) });
  const out = await decide(["src/lib.ts"]);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /Risk:\*\* MEDIUM/);
  assert.match(out, /Reason:\*\* Ix rates this medium risk; 3 dependents\./);
  assert.match(out, /Total dependents:\*\* 3/);
  assert.doesNotMatch(out, /High risk/);
}));

test("ix-decide reviews a file the real CLI rates high risk, counting its dependents", withFake(async (ix) => {
  // The real v0.12.0 record for a file six others import, each calling two of
  // its functions: 6 importers, 12 member-level callers.
  ix.setImpact({ "src/core.ts": impactRecord({ riskLevel: "high", importers: 6, memberCallers: 12 }) });
  const out = await decide(["src/core.ts"]);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /Risk:\*\* HIGH/);
  // The larger of the file-level (6) and member-level (12) views, not 18:
  // the same six files, counted once.
  assert.match(out, /Total dependents:\*\* 12/);
  assert.doesNotMatch(out, /High risk/, "high is a plain REVIEW; only past the old BLOCK line is it flagged");
}));

test("ix-decide reviews, not blocks, a critical file and says it is high risk", withFake(async (ix) => {
  ix.setImpact({ "src/hub.ts": impactRecord({ riskLevel: "critical", importers: 5, memberCallers: 8 }) });
  const out = await decide(["src/hub.ts"]);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /Reason:\*\* High risk: Ix rates this a critical file\./);
  assert.match(out, /Risk:\*\* CRITICAL/);
  assert.match(out, /\/ix-plan/);
  assert.doesNotMatch(out, /BLOCK/);
}));

test("ix-decide flags many dependents as high risk even when ix rates the file low", withFake(async (ix) => {
  ix.setImpact({ "src/util.ts": impactRecord({ riskLevel: "low", importers: 4, dependents: 2, memberCallers: 25 }) });
  const out = await decide(["src/util.ts"]);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /Reason:\*\* High risk: 25 dependents \(high-risk threshold 20\)\./);
  assert.doesNotMatch(out, /BLOCK/);
  // A higher tolerance doubles the thresholds: 25 is then a plain review.
  const tolerant = await decide(["src/util.ts"], { risk_tolerance: "high" });
  assert.match(tolerant, /Verdict:\*\* REVIEW/);
  assert.match(tolerant, /Reason:\*\* 25 dependents \(review threshold 10\)\./);
}));

test("ix-decide adds importers and direct dependents, which are different edges", withFake(async (ix) => {
  ix.setImpact({ "src/types.ts": impactRecord({ riskLevel: "low", importers: 3, dependents: 2, memberCallers: 1 }) });
  const out = await decide(["src/types.ts"]);
  assert.match(out, /Total dependents:\*\* 5/);
  assert.match(out, /Verdict:\*\* REVIEW/);
  assert.match(out, /Reason:\*\* 5 dependents \(review threshold 5\)\./);
}));

test("ix-decide allows a low-risk file and reports its real dependent count", withFake(async (ix) => {
  ix.setImpact({ "src/leaf.ts": impactRecord({ riskLevel: "low", importers: 1, memberCallers: 1 }) });
  const out = await decide(["src/leaf.ts"]);
  assert.match(out, /Verdict:\*\* ALLOW/);
  assert.match(out, /Risk:\*\* LOW/);
  assert.match(out, /Total dependents:\*\* 1/);
  assert.doesNotMatch(out, /Reason:/);
}));

test("ix-decide names the regions the dependents sit in as the subsystems affected", withFake(async (ix) => {
  ix.setImpact({ "src/core.ts": impactRecord({ riskLevel: "high", importers: 6, memberCallers: 12, regions: ["Leaf", "Core"] }) });
  const out = await decide(["src/core.ts"]);
  assert.match(out, /Subsystems affected:\*\* Leaf, Core/);
}));
