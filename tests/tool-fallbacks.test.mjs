import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as ixDecide from "../dist/tools/ix-decide.js";
import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";
import * as ixExplain from "../dist/tools/ix-explain.js";
import * as ixHealth from "../dist/tools/ix-health.js";
import * as ixHistory from "../dist/tools/ix-history.js";
import * as ixImpact from "../dist/tools/ix-impact.js";
import * as ixIngest from "../dist/tools/ix-ingest.js";
import * as ixInventory from "../dist/tools/ix-inventory.js";
import * as ixLocate from "../dist/tools/ix-locate.js";
import * as ixMap from "../dist/tools/ix-map.js";
import * as ixNeighbors from "../dist/tools/ix-neighbors.js";
import * as ixQuery from "../dist/tools/ix-query.js";
import * as ixRank from "../dist/tools/ix-rank.js";
import * as ixSmells from "../dist/tools/ix-smells.js";
import * as ixStats from "../dist/tools/ix-stats.js";
import * as ixSubsystems from "../dist/tools/ix-subsystems.js";
import * as ixTrace from "../dist/tools/ix-trace.js";

const originalFetch = globalThis.fetch;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const toolCases = [
  [ixDecide, { touched_paths: ["plugins/ix-plugin.ts"] }],
  [ixDocsTool, { target: "plugins/ix-plugin.ts", depth: "brief" }],
  [ixExplain, { symbol: "ix-plugin" }],
  [ixHealth, {}],
  [ixHistory, {}],
  [ixImpact, { target: "plugins/ix-plugin.ts" }],
  [ixIngest, {}],
  [ixInventory, { path: "." }],
  [ixLocate, { pattern: "ix-plugin" }],
  [ixMap, { scope: "plugins", include_stats: false }],
  [ixNeighbors, { symbol: "ix-plugin" }],
  [ixQuery, { symbol: "ix-plugin" }],
  [ixRank, { top: 3 }],
  [ixSmells, {}],
  [ixStats, {}],
  [ixSubsystems, {}],
  [ixTrace, { symbol: "ix-plugin" }],
];

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("all tools return strings when the runtime is unavailable", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  for (const [toolModule, params] of toolCases) {
    const result = await toolModule.execute(params, { directory: projectRoot });
    assert.equal(typeof result, "string", `${toolModule.name} should return a string`);
    assert.ok(result.length > 0, `${toolModule.name} should not return an empty string`);
  }
});
