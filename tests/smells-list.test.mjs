// Copyright 2026 Ix Infrastructure Inc.

// Issue #71: `ix smells` without `--list` runs smell detection on the backend
// and stores a new set of smell claims, a write. ix-smells is a read tool an
// agent may call several times in one review, so it reads the stored claims
// with `ix smells --list` and runs detection only when asked to
// (`detect: true`), never on its own.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installFakeIx } from "./fake-ix.mjs";
import { resetLlmVersionCache } from "../dist/runtime/llm.js";
import * as ixSmells from "../dist/tools/ix-smells.js";

// What `ix smells --list --format json` prints (Ix ix-cli smells.ts, v0.12.0
// to v0.14.0): `smell` is the claim kind and `entity_id` its entity's first 12
// characters. The CLI also maps `s.confidence`, but the backend keeps
// confidence, file and signals inside the claim's `value`, so the field is
// undefined and JSON drops it: a real row has only these two fields.
const STORED = {
  count: 2,
  inference_version: "smell_v1",
  smells: [
    { smell: "has_smell.orphan_file", entity_id: "a1b2c3d4e5f6" },
    { smell: "has_smell.god_module", entity_id: "0f9e8d7c6b5a" },
  ],
};

const EMPTY = { count: 0, inference_version: "smell_v1", smells: [] };

// What `ix smells --format json` (detection) prints.
const DETECTED = {
  rev: 7,
  run_at: "2026-11-09T12:00:00Z",
  count: 1,
  inference_version: "smell_v1",
  candidates: [{ file: "src/fresh.ts", smell: "has_smell.orphan_file", confidence: 0.88, signals: { connectivity: 0 } }],
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
    // The kind without its `has_smell.` namespace, over the row's entity id.
    assert.match(output, /### orphan_file \(1\)\n- entity `a1b2c3d4e5f6`\n/);
    assert.match(output, /### god_module \(1\)\n- entity `0f9e8d7c6b5a`\n/);
    assert.doesNotMatch(output, /has_smell\./);
    // A stored row carries no confidence; none is made up.
    assert.doesNotMatch(output, /confidence/);
    assert.doesNotMatch(output, /sent no rows/);
    assert.doesNotMatch(output, /src\/fresh\.ts/);
    assert.match(output, /stored/i, "must say the results are stored ones");
    // --list prints no run_at: the output must not pass the rows off as current.
    assert.match(output, /may predate the latest `ix map`/);
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
    assert.match(output, /### orphan_file \(1\)\n- `src\/fresh\.ts` — confidence: 0\.88/);
    assert.match(output, /signals: connectivity: 0/);
    assert.match(output, /ran smell detection/i);
    assert.match(output, /Analysis run at: 2026-11-09T12:00:00Z/);
  });
});

for (const [state, graph] of [
  ["a mapped graph", { graphCompleted: true, mapCompleted: true }],
  ["an unmapped graph", { graphCompleted: false, mapCompleted: false }],
]) {
  test(`nothing stored on ${state}: no detection, says so and points at detect: true`, async () => {
    await withFakeIx(async (ix) => {
      ix.setRecord("smells --list", EMPTY);
      ix.setRecord("smells", DETECTED);
      ix.setRecord("status", graph);
      const outputs = [];
      for (let i = 0; i < 3; i++) outputs.push(await ixSmells.execute({}, { directory: ix.dir }));

      assert.deepEqual(ix.calls().filter(isDetect), [], "a default call must never run detection");
      assert.equal(ix.calls().filter(isList).length, 3, "every default call reads with --list");
      for (const output of outputs) {
        assert.match(output, /^## ix-smells/);
        assert.match(output, /No smell results are stored/);
        // --list cannot tell a clean graph from one never checked.
        assert.doesNotMatch(output, /Architecture looks clean/);
        assert.match(output, /detect: true/);
        assert.match(output, /writes/);
        assert.match(output, /ix map/);
        assert.doesNotMatch(output, /src\/fresh\.ts/);
      }
    });
  });
}

test("after detect: true, a default call only reads", async () => {
  await withFakeIx(async (ix) => {
    await ixSmells.execute({ detect: true }, { directory: ix.dir });
    const afterDetect = ix.calls().filter(isDetect).length;
    assert.ok(afterDetect > 0);
    // No record: the fake's own --list answer is the real empty shape.
    const output = await ixSmells.execute({}, { directory: ix.dir });
    assert.equal(ix.calls().filter(isDetect).length, afterDetect);
    assert.match(output, /No smell results are stored/);

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
  assert.match(ixSmells.parameters.properties.detect.description, /never runs detection unless/);
  assert.match(ixSmells.description, /detect/);
  assert.match(ixSmells.description, /writ|stores/i);
  // Detection is a backend write: the description must not invite the model to
  // run it on its own (e.g. "when no results are stored or out of date").
  assert.match(ixSmells.description, /only when the user explicitly asks/);
  assert.match(ixSmells.description, /Never set it on your own/);
  assert.doesNotMatch(ixSmells.description, /or when no results are stored/);
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
    ix.setRecord("smells --list", { count: 3, inference_version: "smell_v1" });
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.deepEqual(ix.calls().filter(isDetect), []);
    assert.doesNotMatch(output, /Architecture looks clean/);
    assert.match(output, /reported 3 smells/);
  });
});

test("--list gets the tool's limit on an ix that accepts it (v0.14.0+)", async () => {
  await withFakeIx(async (ix) => {
    ix.setVersion("0.14.0");
    // With --limit, ix prints the total as count plus shown/truncated.
    ix.setRecord("smells --list", {
      count: 3,
      shown: 1,
      truncated: true,
      inference_version: "smell_v1",
      smells: [{ smell: "has_smell.god_module", entity_id: "0f9e8d7c6b5a" }],
    });
    const output = await ixSmells.execute({ limit: 1 }, { directory: ix.dir });

    const list = ix.calls().find(isList);
    assert.deepEqual(list.argv, ["smells", "--list", "--limit", "1", "--format", "json"]);
    assert.match(output, /\*\*3 smells detected\*\* \(showing 1 of 3\)/);
    assert.match(output, /### god_module \(1\)/);
  });
});

test("--list sends no --limit to an ix older than v0.14.0, and the tool caps the rows itself", async () => {
  await withFakeIx(async (ix) => {
    // The fake's default version (0.11.1) rejects `smells --limit`, as the
    // released v0.12.0 that CI pins does.
    ix.setRecord("smells --list", STORED);
    const output = await ixSmells.execute({ limit: 1 }, { directory: ix.dir });

    const list = ix.calls().find(isList);
    assert.deepEqual(list.argv, ["smells", "--list", "--format", "json"]);
    assert.doesNotMatch(output, /unavailable/i);
    assert.match(output, /\*\*2 smells detected\*\* \(showing 1 of 2\)/);
    assert.match(output, /### orphan_file \(1\)/);
    assert.doesNotMatch(output, /god_module/);
  });
});

test("the limit sent to ix is a whole number from 1 to 200", async () => {
  for (const [limit, sent] of [[500, "200"], [0, "1"], [-4, "1"], [7.9, "7"], [undefined, "50"]]) {
    await withFakeIx(async (ix) => {
      ix.setVersion("0.14.0");
      ix.setRecord("smells --list", STORED);
      await ixSmells.execute(limit === undefined ? {} : { limit }, { directory: ix.dir });
      const list = ix.calls().find(isList);
      assert.equal(list.argv[list.argv.indexOf("--limit") + 1], sent, `limit ${limit}`);
    });
  }
});

test("an ix that rejects --limit despite a cached newer version is read again without it", async () => {
  await withFakeIx(async (ix) => {
    // The version is probed once per process: 0.14.0 is cached, then ix is
    // downgraded under the running host to one that rejects `smells --limit`.
    ix.setVersion("0.14.0");
    ix.setRecord("smells --list", STORED);
    await ixSmells.execute({ limit: 1 }, { directory: ix.dir });
    ix.setVersion("0.12.0");
    const before = ix.calls().length;
    const output = await ixSmells.execute({ limit: 1 }, { directory: ix.dir });

    const lists = ix.calls().slice(before).filter(isList).map((call) => call.argv);
    assert.deepEqual(lists, [
      ["smells", "--list", "--limit", "1", "--format", "json"],
      ["smells", "--list", "--format", "json"],
    ]);
    assert.deepEqual(ix.calls().filter(isDetect), [], "a retried read must not turn into a write");
    assert.doesNotMatch(output, /unavailable/i);
    assert.match(output, /\*\*2 smells detected\*\* \(showing 1 of 2\)/);
  });
});

test("a failure other than a rejected --limit is reported, not retried", async () => {
  await withFakeIx(async (ix) => {
    ix.setVersion("0.14.0");
    ix.setUnreachable();
    const output = await ixSmells.execute({}, { directory: ix.dir });

    assert.equal(ix.calls().filter(isList).length, 1);
    assert.deepEqual(ix.calls().filter(isDetect), []);
    assert.match(output, /unavailable/i);
  });
});

test("an ix that predates `smells --list` gets an upgrade message, not 'ix unavailable', and no detection", async () => {
  for (const version of ["0.11.1", "0.14.0"]) {
    await withFakeIx(async (ix) => {
      ix.setVersion(version);
      ix.rejectOption("smells", "--list");
      ix.setRecord("smells", DETECTED);
      const output = await ixSmells.execute({}, { directory: ix.dir });

      assert.equal(ix.calls().filter(isList).length, 1, `${version}: one read, not retried`);
      assert.deepEqual(ix.calls().filter(isDetect), [], `${version}: a rejected read must not turn into a write`);
      assert.match(output, /^## ix-smells/);
      assert.match(output, /cannot read stored smell results/);
      assert.match(output, /Upgrade the ix CLI/);
      assert.match(output, /unknown option '--list'/);
      assert.doesNotMatch(output, /ix unavailable/i);
      assert.doesNotMatch(output, /ix map/, "running ix map does not fix a missing option");
    });
  }
});

test("stored rows say they cannot be narrowed to a path, and that detection rows name the file", async () => {
  await withFakeIx(async (ix) => {
    ix.setRecord("smells --list", STORED);
    const output = await ixSmells.execute({}, { directory: ix.dir });
    assert.match(output, /cannot be narrowed to a path/);
    assert.match(output, /Detection rows name the file/);
  });
});

// The agent docs run `ix smells --list` themselves. Its JSON shape, and that of
// detection (`ix smells --format json`), are the ones the live test checks
// against a real ix; `--format llm` is not checked anywhere, so the docs must
// not depend on it.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const doc of ["AGENTS.md", "skills/ix-architecture/SKILL.md", "skills/ix-docs/SKILL.md"]) {
  test(`${doc} reads smells with \`ix smells --list --format json\` and shows no llm form`, () => {
    const text = readFileSync(path.join(projectRoot, doc), "utf8");
    const commands = text.split("\n").filter((line) => /ix smells\b/.test(line) && /--format/.test(line));
    assert.ok(commands.some((line) => /ix smells --list --format json/.test(line)), `${doc} should show the stored-results read`);
    for (const line of commands) {
      assert.match(line, /ix smells (--list )?--format json/, line);
    }
  });
}

// Stored rows carry no file. Where a doc narrows smells to a path, it must do
// so on detection rows (which name the file), only when the user asks, and say
// that detection writes.
for (const doc of ["skills/ix-architecture/SKILL.md", "skills/ix-docs/SKILL.md"]) {
  test(`${doc} narrows smells to a path only on detection rows the user asked for`, () => {
    const text = readFileSync(path.join(projectRoot, doc), "utf8");
    const detection = text.indexOf("ix smells --format json");
    assert.ok(detection > 0, `${doc} should show the detection command for path-scoped smells`);
    // Prose wraps anywhere: compare with whitespace collapsed.
    const flat = (part) => part.replace(/\s+/g, " ");
    const before = flat(text.slice(Math.max(0, detection - 600), detection));
    const after = flat(text.slice(detection, detection + 400));
    assert.match(before, /stored smells cannot be narrowed/);
    assert.match(before, /If the user ask(s|ed) for fresh detection/);
    assert.match(before, /it writes/);
    assert.match(after, /candidates whose `file` falls under/);
  });
}
