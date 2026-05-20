import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import entry from "../dist/plugins/ix-plugin.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(testDir, "fixtures");
const baseline = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "launch-baseline.json"), "utf8")
);

test("launch baseline fixture matches registered OpenClaw events", () => {
  const events = [];
  const handlers = new Map();

  entry.register({
    registerTool() {},
    on(name, handler, options) {
      events.push(name);
      handlers.set(name, { handler, options });
    },
  });

  assert.deepEqual(events, baseline.registered_events);
  assert.equal(baseline.ambient_behaviors.length, 5);
  assert.equal(handlers.get("before_prompt_build")?.options?.priority, 50);
  assert.equal(handlers.get("before_tool_call")?.options?.priority, 50);
  assert.equal(handlers.get("after_tool_call")?.options?.priority, 50);
  assert.equal(handlers.get("session_end")?.options?.priority, 50);
});

test("launch baseline search interception is currently a no-op", async () => {
  const handlers = new Map();
  entry.register({
    registerTool() {},
    on(name, handler) {
      handlers.set(name, handler);
    },
  });

  const beforeToolCall = handlers.get("before_tool_call");
  assert.ok(beforeToolCall);

  for (const toolName of ["Grep", "Glob", "Read", "Bash"]) {
    const result = await beforeToolCall({
      toolName,
      toolCallId: toolName + "-1",
      params: { path: "plugins/ix-plugin.ts" },
    });
    assert.equal(result, undefined, toolName + " should be a no-op at launch");
  }

  const searchFixture = baseline.ambient_behaviors.find(
    (item) => item.id === "search-interception"
  );
  assert.equal(searchFixture?.status, "not_implemented_at_launch");
});
