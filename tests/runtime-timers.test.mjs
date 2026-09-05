// `callRuntime` and `getRuntime` cleared their abort timer only after a
// successful fetch, and `isRuntimeAvailable` never captured its timer at all.
// When the runtime is unreachable the fetch rejects, so those timers stayed
// pending for their full duration — and a pending timer keeps the event loop
// alive, so the host process hung at exit on every call. Measured at 9002ms
// before the fix, 25ms after.
//
// That is the normal case, not an edge case: these tools have a CLI fallback
// precisely because most machines do not run the Core Runtime.
//
// Invisible in-process (the calls themselves return in ~20ms); only the exit is
// delayed. So this measures how long a child takes to exit.
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("runtime client does not hold the process open after an unreachable call", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ix-timer-"));
  try {
    const client = path.join(projectRoot, "dist/runtime/client.js");
    const runner = path.join(dir, "runner.mjs");
    writeFileSync(
      runner,
      `const c = await import(${JSON.stringify(client)});\n` +
      `await c.callRuntime("/v2/ix_query", {}, { dir: ${JSON.stringify(dir)} });\n` +
      `await c.isRuntimeAvailable();\n`,
    );

    const started = Date.now();
    await new Promise((resolve) => {
      // Port 9 (discard) refuses immediately, so any delay is a leaked timer.
      const child = spawn(process.execPath, [runner], {
        env: { ...process.env, IX_RUNTIME_URL: "http://127.0.0.1:9" },
        stdio: "ignore",
      });
      child.on("exit", resolve);
    });
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed < 3000,
      `process took ${elapsed}ms to exit — an abort timer is still pending`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
