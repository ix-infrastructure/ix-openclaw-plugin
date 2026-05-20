import assert from "node:assert/strict";
import test from "node:test";

import { callRuntime, getRuntime } from "../dist/runtime/client.js";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("callRuntime redacts outbound payloads and inbound preview markdown", async () => {
  let requestBody = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init.body));
    return {
      ok: true,
      async json() {
        return {
          preview_markdown:
            "token: sk-abcdefghijklmnopqrstuvwxyz1234 and Bearer abcdefghijklmnopqrstuvwxyz1234",
        };
      },
    };
  };

  const result = await callRuntime(
    "/v2/ix_query",
    { note: "sk-abcdefghijklmnopqrstuvwxyz1234" },
    { dir: "/tmp/workspace" }
  );

  assert.ok(result);
  assert.equal(result.preview_markdown, "token: [REDACTED] and [REDACTED]");
  assert.equal(requestBody.note, "[REDACTED]");
  assert.equal(requestBody.workspace.root_uri, "file:///tmp/workspace");
  assert.equal(requestBody.caller.surface, "openclaw-plugin");
});

test("runtime helpers return null on fetch failure", async () => {
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  assert.equal(await callRuntime("/v2/ix_query", {}, { dir: "/tmp/workspace" }), null);
  assert.equal(await getRuntime("/v2/status"), null);
});
