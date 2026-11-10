// Copyright 2026 Ix Infrastructure Inc.

// Issue #71: `ix smells` without `--list` runs smell detection on the backend
// and stores a new set of smell claims, a write. ix-smells is a read tool an
// agent may call several times in one review, so by default it reads the
// stored claims with `ix smells --list` and runs detection only when asked to
// (`detect: true`) or when nothing is stored yet on a mapped graph.
import assert from "node:assert/strict";
import test from "node:test";

import { installFakeIx } from "./fake-ix.mjs";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import * as ixSmells from "../dist/tools/ix-smells.js";

// What `ix smells --list --format json` prints: the stored claims, each with
// a 12-character entity id prefix and no file or run time.
const STORED = {
  count: 2,
  inference_version: "test",
  smells: [
    { smell: "orphan", entity_id: "a1b2c3d4e5f6", confidence: 0.91 },
    { smell: "god-module", entity_id: "0f9e8d7c6b5a", confidence: 0.77 },
  ],
};

const DETECTED = {
  candidates: [{ smell: "orphan", file: "src/fresh.ts", confidence: 0.88 }],
  count: 1,
  run_at: "2026-11-09T12:00:00Z",
};

// A detection run is `ix smells` without `--list`.
const isDetect = (call) => call.argv[0] === "smells" && !call.argv.includes("--list");
const isList = (call) => call.argv[0] === "smells" && call.argv.includes("--list");

async function withFakeIx(fn) {
  const ix = installFakeIx();
  resetLlmVersionCache();
  try {
    await fn(ix);
  } finally {
    resetLlmVersionCache();
    ix.restore();
  }
}

test("a default ix-smells call reads stored claims with `ix smells --list` and runs no detection", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", STORED);
    ix.setRecord("smells", DETECTED);
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.ok(ix.calls().some(isList), "should have sent ix smells --list");
    assert.deepEqual(ix.calls().filter(isDetect), [], "a default call must not run detection");
    assert.match(output, /^## ix-smells/);
    assert.match(output, /\*\*2 smells detected\*\*/);
    assert.match(output, /### orphan \(1\)\n- entity `a1b2c3d4e5f6` — confidence: 0\.91/);
    assert.match(output, /### god-module \(1\)\n- entity `0f9e8d7c6b5a` — confidence: 0\.77/);
    assert.doesNotMatch(output, /sent no rows/);
    assert.doesNotMatch(output, /src\/fresh\.ts/);
    assert.match(output, /stored/i, "must say the results are stored ones");
    assert.match(output, /detect: true/, "must say how to re-run detection");
  });
});

test("detect: true runs detection and says it stored new results", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", STORED);
    ix.setRecord("smells", DETECTED);
    const output = await ixSmells.execute({ detect: true }, { directory: ix.dir });

    assert.ok(ix.calls().some(isDetect), "detect: true must run ix smells");
    assert.deepEqual(ix.calls().filter(isList), [], "detect: true goes straight to detection");
    assert.match(output, /src\/fresh\.ts/);
    assert.match(output, /ran smell detection/i);
  });
});

test("nothing stored on a mapped graph: runs detection once and says so", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", { count: 0, inference_version: "test", smells: [] });
    ix.setRecord("smells", DETECTED);
    ix.setRecord("status", { graphCompleted: true, mapCompleted: true });
    const output = await ixSmells.execute({}, { directory: ix.dir });

    // Once: the llm fast path and, when it gives no text, its JSON fallback,
    // never the same detection twice.
    const detections = ix.calls().filter(isDetect).map((call) => call.argv.join(" "));
    assert.ok(detections.length > 0, "should run detection");
    assert.equal(new Set(detections).size, detections.length, `detection repeated: ${detections.join(" | ")}`);
    assert.match(output, /src\/fresh\.ts/);
    assert.match(output, /no stored smell results/i);
    assert.match(output, /ran smell detection/i);
  });
});

test("nothing stored on an unmapped graph: no detection, points at ix map", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", { count: 0, inference_version: "test", smells: [] });
    ix.setRecord("smells", DETECTED);
    ix.setRecord("status", { graphCompleted: false, mapCompleted: false });
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.deepEqual(ix.calls().filter(isDetect), [], "must not run detection on an unmapped graph");
    assert.match(output, /^## ix-smells/);
    assert.match(output, /ix map/);
    assert.doesNotMatch(output, /src\/fresh\.ts/);
  });
});

test("a clean mapped graph runs detection once, then later default calls only read", async () => {
  await withFakeIx(async (ix) => {
    // --list cannot tell "never detected" from "detected, found nothing".
    ix.setRecord("smells --list", { count: 0, inference_version: "test", smells: [] });
    ix.setRecord("status", { graphCompleted: true, mapCompleted: true });
    const first = await ixSmells.execute({}, { directory: ix.dir });
    const afterFirst = ix.calls().filter(isDetect).length;
    assert.ok(afterFirst > 0, "the first call on an empty store should detect");
    assert.match(first, /ran smell detection/i);

    const second = await ixSmells.execute({}, { directory: ix.dir });
    const third = await ixSmells.execute({}, { directory: ix.dir });
    assert.equal(ix.calls().filter(isDetect).length, afterFirst, "later default calls must not re-run detection");
    for (const output of [second, third]) {
      assert.match(output, /^## ix-smells/);
      assert.match(output, /already ran/);
      assert.match(output, /No code smells detected/);
      assert.match(output, /detect: true/);
    }
    assert.equal(ix.calls().filter(isList).length, 3, "every default call reads with --list");
  });
});

test("after detect: true, an empty store is not detected again by default calls", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("status", { graphCompleted: true, mapCompleted: true });
    await ixSmells.execute({ detect: true }, { directory: ix.dir });
    const afterDetect = ix.calls().filter(isDetect).length;
    // No record: the fake's own --list answer is the real empty shape.
    const output = await ixSmells.execute({}, { directory: ix.dir });
    assert.equal(ix.calls().filter(isDetect).length, afterDetect);
    assert.match(output, /already ran/);

    // detect: true always runs.
    await ixSmells.execute({ detect: true }, { directory: ix.dir });
    assert.ok(ix.calls().filter(isDetect).length > afterDetect);
  });
});

test("when ix smells --list fails, ix-smells reports it and does not fall back to detection", async () => {
  await withFakeIx(async (ix) => {
    ix.setUnreachable();
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.ok(ix.calls().some(isList), "should have tried ix smells --list");
    assert.deepEqual(ix.calls().filter(isDetect), [], "a failed read must not turn into a write");
    assert.match(output, /^## ix-smells/);
    assert.match(output, /unavailable/i);
  });
});

test("the tool schema offers `detect` and the description says it writes", () => {
  assert.equal(ixSmells.parameters.properties.detect?.type, "boolean");
  assert.match(ixSmells.parameters.properties.detect.description, /writ|stores/i);
  assert.match(ixSmells.description, /detect/);
  assert.match(ixSmells.description, /writ|stores/i);
});

test("detect: true keeps the llm fast path under the tool's header and source line", async () => {
  await withFakeIx(async (ix) => {
    // No canned record: the fake answers `ix smells --format llm` with text.
    const output = await ixSmells.execute({ detect: true }, { directory: ix.dir });

    assert.match(output, /^## ix-smells\n\n_Ran smell detection/);
    assert.match(output, /smells none/);
    assert.deepEqual(ix.calls().filter(isList), []);
  });
});

test("a count with no readable rows is not reported as a clean graph", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", { count: 3, inference_version: "test" });
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.deepEqual(ix.calls().filter(isDetect), []);
    assert.doesNotMatch(output, /Architecture looks clean/);
    assert.match(output, /reported 3 smells/);
  });
});
