// Ix#539 step 1: the plugin must tolerate an `ix` that exits non-zero while
// still printing a useful body, before the CLI starts producing one.
//
// `runIx` rejects on a non-zero exit and used to drop stdout with it, so
// `safeRun` returned null and ix-docs-tool fell back to a generic "Not found in
// graph" — throwing away the diagnostics ix had supplied.
//
// Unlike Bun's shell, node's execFile resolves the binary from process.env.PATH
// at spawn time, so an in-process stub genuinely takes effect here. The PATH is
// replaced rather than prepended so a real installed `ix` cannot be reached.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import * as ixDocsTool from "../dist/tools/ix-docs-tool.js";
import { runIx, IxCommandError } from "../dist/tools/base.js";

const originalFetch = globalThis.fetch;

function withStubIx(script) {
  const dir = mkdtempSync(path.join(tmpdir(), "ix-stub-"));
  if (script !== null) {
    const bin = path.join(dir, "ix");
    writeFileSync(bin, `#!/bin/sh\n${script}\n`);
    chmodSync(bin, 0o755);
  }
  const previousPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}/usr/bin${path.delimiter}/bin`;
  // The runtime is not what is under test; make it fail fast and predictably.
  globalThis.fetch = async () => { throw new Error("connect ECONNREFUSED"); };
  return {
    dir,
    restore() {
      process.env.PATH = previousPath;
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("runIx carries stdout on an IxCommandError", async () => {
  const stub = withStubIx(`echo '{"diagnostics":["No graph entity found."]}'; exit 1`);
  try {
    await assert.rejects(
      () => runIx(["locate", "Missing"], { cwd: stub.dir }),
      (error) => {
        assert.ok(error instanceof IxCommandError, "should be an IxCommandError");
        assert.match(error.stdout, /No graph entity found\./);
        return true;
      },
    );
  } finally {
    stub.restore();
  }
});

test("ix_docs keeps the JSON body when ix exits non-zero", async () => {
  const stub = withStubIx(`
case "$1" in
  locate)   echo '{"resolvedTarget":null,"diagnostics":["No graph entity found."]}'; exit 1 ;;
  overview) echo '{"summary":"Overview body retained."}'; exit 1 ;;
  *)        echo '{}'; exit 1 ;;
esac`);
  try {
    const output = await ixDocsTool.execute({ target: "SomeSymbol", depth: "brief" }, { directory: stub.dir });
    assert.ok(!output.includes("Not found in graph"), `fell back to the generic miss:\n${output}`);
    assert.match(output, /Overview body retained\./);
  } finally {
    stub.restore();
  }
});

test("ix_docs still reports not-found when ix exits non-zero with no output", async () => {
  const stub = withStubIx("exit 1");
  try {
    const output = await ixDocsTool.execute({ target: "SomeSymbol", depth: "brief" }, { directory: stub.dir });
    assert.match(output, /Not found in graph/);
  } finally {
    stub.restore();
  }
});

test("ix_docs still reports not-found when ix is absent entirely", async () => {
  const stub = withStubIx(null);
  try {
    const output = await ixDocsTool.execute({ target: "SomeSymbol", depth: "brief" }, { directory: stub.dir });
    assert.match(output, /Not found in graph/);
  } finally {
    stub.restore();
  }
});
