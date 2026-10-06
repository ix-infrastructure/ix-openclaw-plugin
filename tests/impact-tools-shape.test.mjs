// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import test from "node:test";

import { impactRecord, installFakeIx } from "./fake-ix.mjs";
import * as ixImpact from "../dist/tools/ix-impact.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";

// ix-impact and ix-docs-tool against `ix impact` records in the shape the
// released CLI prints (riskLevel + summary counts + propagationBuckets), and
// `ix callers` in its real `results[]` shape. Both tools used to read `risk`,
// `dependentCount`, `transitiveCount`, `subsystems` and `atRiskBehaviors`
// (and ix-impact read callers from `items`), none of which ix prints, so with
// the real CLI every target read UNKNOWN risk with 0 dependents.

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

const context = () => ({ directory: process.cwd() });

test("ix-impact reports the real risk, dependents and regions of a file", withFake(async (ix) => {
  ix.setImpact({
    "src/core.ts": impactRecord({ riskLevel: "high", importers: 6, memberCallers: 12, regions: ["Leaf", "Core", "Leaf"] }),
  });
  const out = await ixImpact.execute({ target: "src/core.ts" }, context());
  assert.match(out, /\*\*Risk level:\*\* HIGH/);
  assert.match(out, /\*\*Verdict:\*\* NEEDS CHANGE PLAN/);
  // max(importers + dependents, member callers): the same six files, counted once.
  assert.match(out, /- Direct dependents: 12\n/);
  assert.match(out, /- Subsystems affected: Leaf, Core\n/);
  assert.match(out, /\*\*Why:\*\* High risk/);
  assert.match(out, /\*\*At-risk behaviors:\*\*\n- Limited to immediate callers/);
  assert.doesNotMatch(out, /UNKNOWN|Transitive/);
}));

test("ix-impact adds file-level importers and dependents", withFake(async (ix) => {
  ix.setImpact({ "src/util.ts": impactRecord({ riskLevel: "medium", importers: 4, dependents: 2, memberCallers: 3 }) });
  const out = await ixImpact.execute({ target: "src/util.ts" }, context());
  assert.match(out, /\*\*Risk level:\*\* MEDIUM/);
  assert.match(out, /\*\*Verdict:\*\* REVIEW CALLERS FIRST/);
  assert.match(out, /- Direct dependents: 6\n/);
}));

test("ix-impact reads a symbol target's callers count and lists its real callers", withFake(async (ix) => {
  ix.setImpact({ verifyToken: impactRecord({ riskLevel: "medium", kind: "function", name: "verifyToken", callers: 5, callees: 1 }) });
  ix.setCallers({
    verifyToken: [
      { name: "login", kind: "function", path: "src/auth/login.ts" },
      { kind: "function", resolved: false, rawId: "abc" },
      { name: "refresh", kind: "function", path: "src/auth/refresh.ts" },
    ],
  });
  const out = await ixImpact.execute({ target: "verifyToken" }, context());
  assert.match(out, /\*\*Risk level:\*\* MEDIUM/);
  assert.match(out, /- Direct dependents: 5\n/);
  assert.match(out, /\*\*Key callers:\*\*\n- `login` \(src\/auth\/login\.ts\)\n- `refresh` \(src\/auth\/refresh\.ts\)\n/);
  assert.match(out, /Test `login`, `refresh` after change\./);
}));

test("ix-impact calls a low-risk leaf safe without asking for callers", withFake(async (ix) => {
  ix.setImpact({ "src/leaf.ts": impactRecord({ riskLevel: "low", importers: 1, memberCallers: 1 }) });
  const out = await ixImpact.execute({ target: "src/leaf.ts" }, context());
  assert.match(out, /\*\*Risk level:\*\* LOW/);
  assert.match(out, /\*\*Verdict:\*\* SAFE TO PROCEED/);
  assert.match(out, /- Direct dependents: 1\n/);
  assert.equal(ix.calls().filter((call) => call.argv[0] === "callers").length, 0);
}));

test("ix-impact says so when ix withholds the risk level, not that it needs a plan", withFake(async (ix) => {
  ix.setImpact({ "src/x.ts": impactRecord({ riskLevel: "unknown", importers: 2 }) });
  const out = await ixImpact.execute({ target: "src/x.ts" }, context());
  assert.match(out, /\*\*Risk level:\*\* UNKNOWN/);
  assert.match(out, /\*\*Verdict:\*\* RISK NOT ASSESSED/);
  assert.doesNotMatch(out, /NEEDS CHANGE PLAN/);
}));

test("ix-docs-tool full depth reports the real change risk, dependents and regions", withFake(async (ix) => {
  ix.setImpact({ "src/core.ts": impactRecord({ riskLevel: "high", importers: 6, memberCallers: 12, regions: ["Core"] }) });
  const out = await ixDocsTool.execute({ target: "src/core.ts", depth: "full" }, context());
  assert.match(out, /\*\*Change risk:\*\* HIGH \(12 dependents\)/);
  assert.match(out, /\*\*Subsystems affected:\*\* Core/);
}));

test("ix-docs-tool full depth leaves out an impact error record", withFake(async (ix) => {
  ix.setImpact({ "src/core.ts": { error: "ambiguous_target", message: "Several matches." } });
  const out = await ixDocsTool.execute({ target: "src/core.ts", depth: "full" }, context());
  assert.doesNotMatch(out, /Change risk/);
}));
