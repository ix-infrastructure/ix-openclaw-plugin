// Copyright 2026 Ix Infrastructure Inc.

/**
 * The guarded automatic map (runtime/auto-map.ts) and the two plugin events
 * that request it.
 *
 * Every case runs against the strict fake `ix` in tests/fake-ix.mjs with HOME
 * and XDG_STATE_HOME pointed at throwaway directories, so nothing here can
 * reach a real CLI or backend.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installFakeIx, waitFor } from "./fake-ix.mjs";
import { autoMapStateDir, requestGuardedMap } from "../dist/runtime/auto-map.js";
import entry from "../dist/plugins/ix-plugin.js";

// Long enough for a detached fake `ix` to have written its log line if it was
// (wrongly) started.
const SETTLE_MS = 400;

function gitRepo(parent, name) {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  return realpathSync(dir);
}

function setup() {
  const sandbox = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-automap-")));
  const home = path.join(sandbox, "home");
  const state = path.join(sandbox, "state");
  mkdirSync(home, { recursive: true });
  const saved = {
    HOME: process.env.HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    IX_MAP_DEBOUNCE_SECONDS: process.env.IX_MAP_DEBOUNCE_SECONDS,
    IX_AUTO_MAP: process.env.IX_AUTO_MAP,
  };
  process.env.HOME = home;
  process.env.XDG_STATE_HOME = state;
  delete process.env.IX_MAP_DEBOUNCE_SECONDS;
  delete process.env.IX_AUTO_MAP;
  const ix = installFakeIx();
  return {
    sandbox,
    home,
    state,
    ix,
    restore() {
      ix.restore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(sandbox, { recursive: true, force: true });
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

test("a non-git directory never maps", async () => {
  const env = setup();
  try {
    const plain = path.join(env.sandbox, "plain");
    mkdirSync(plain);
    const result = await requestGuardedMap(plain);
    assert.deepEqual(result, { started: false, reason: "not-git" });
    await settle();
    assert.equal(env.ix.mapCalls().length, 0);
  } finally {
    env.restore();
  }
});

test("a git root equal to $HOME never maps", async () => {
  const env = setup();
  try {
    execFileSync("git", ["init", "-q", env.home]);
    const sub = path.join(env.home, "notes");
    mkdirSync(sub);
    env.ix.setMapped([realpathSync(env.home)]);
    const result = await requestGuardedMap(sub);
    assert.equal(result.started, false);
    assert.equal(result.reason, "home-root");
    await settle();
    assert.equal(env.ix.calls().length, 0, "not even ix status should run");
  } finally {
    env.restore();
  }
});

test("a project whose graph is not completed never maps (no implicit workspace)", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "unmapped");
    env.ix.setMapped([]);
    const result = await requestGuardedMap(repo);
    assert.deepEqual(result, { started: false, reason: "not-mapped", root: repo });
    await settle();
    assert.equal(env.ix.mapCalls().length, 0);
    const status = env.ix.calls().find((call) => call.argv[0] === "status");
    assert.deepEqual(status?.argv, ["status", "--format", "json", "--root", repo]);
  } finally {
    env.restore();
  }
});

test("a mapped project runs exactly `ix map <root> --silent` with IX_AUTO_MAP=1 in the root", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "mapped");
    const nested = path.join(repo, "src", "deep");
    mkdirSync(nested, { recursive: true });
    env.ix.setMapped([repo]);

    const result = await requestGuardedMap(nested);
    assert.deepEqual(result, { started: true, root: repo });
    assert.ok(await waitFor(() => env.ix.mapCalls().length > 0), "map should have started");

    const maps = env.ix.mapCalls();
    assert.equal(maps.length, 1);
    assert.deepEqual(maps[0].argv, ["map", repo, "--silent"]);
    assert.equal(realpathSync(maps[0].cwd), repo);
    assert.equal(maps[0].autoMap, "1");

    // The debounce stamp is per user, private, and not in a shared /tmp path.
    const stateDir = autoMapStateDir();
    assert.ok(stateDir.startsWith(env.state), stateDir);
    assert.equal(statSync(stateDir).mode & 0o777, 0o700);
  } finally {
    env.restore();
  }
});

test("a second request for the same root inside the debounce window does not map", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "debounced");
    env.ix.setMapped([repo]);

    assert.equal((await requestGuardedMap(repo)).started, true);
    assert.ok(await waitFor(() => env.ix.mapCalls().length === 1));

    const second = await requestGuardedMap(repo);
    assert.deepEqual(second, { started: false, reason: "debounced", root: repo });
    await settle();
    assert.equal(env.ix.mapCalls().length, 1);
  } finally {
    env.restore();
  }
});

test("two different roots do not debounce each other", async () => {
  const env = setup();
  try {
    const a = gitRepo(env.sandbox, "repo-a");
    const b = gitRepo(env.sandbox, "repo-b");
    env.ix.setMapped([a, b]);

    assert.equal((await requestGuardedMap(a)).started, true);
    assert.equal((await requestGuardedMap(b)).started, true);
    assert.ok(await waitFor(() => env.ix.mapCalls().length === 2));
    const roots = env.ix.mapCalls().map((call) => call.argv[1]).sort();
    assert.deepEqual(roots, [a, b].sort());
  } finally {
    env.restore();
  }
});

test("concurrent requests for one root start one map", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "concurrent");
    env.ix.setMapped([repo]);
    const results = await Promise.all([requestGuardedMap(repo), requestGuardedMap(repo)]);
    assert.equal(results.filter((result) => result.started).length, 1);
    await settle();
    assert.equal(env.ix.mapCalls().length, 1);
  } finally {
    env.restore();
  }
});

// ── Plugin wiring ──────────────────────────────────────────────────────────

function registerPlugin(workspaceDir) {
  const handlers = new Map();
  entry.register({
    registerTool() {},
    on(name, handler) {
      handlers.set(name, handler);
    },
    config: { agents: {} },
    runtime: {
      config: { current: () => ({ agents: {} }) },
      agent: {
        resolveAgentWorkspaceDir: (_cfg, agentId) => (agentId === "main" ? workspaceDir : undefined),
      },
    },
  });
  return handlers;
}

test("after an edit the plugin maps the git root, never the edited file", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "edited");
    mkdirSync(path.join(repo, "src"));
    const file = path.join(repo, "src", "index.ts");
    writeFileSync(file, "export {};\n");
    env.ix.setMapped([repo]);

    const handlers = registerPlugin(repo);
    handlers.get("after_tool_call")(
      { toolName: "edit", toolCallId: "e1", params: { path: file, edits: [] } },
      { agentId: "main", toolName: "edit" }
    );

    assert.ok(await waitFor(() => env.ix.mapCalls().length > 0), "root map should have started");
    const maps = env.ix.mapCalls();
    assert.equal(maps.length, 1);
    assert.deepEqual(maps[0].argv, ["map", repo, "--silent"]);
    assert.ok(!maps.some((call) => call.argv.includes(file)), "must never map a file");
  } finally {
    env.restore();
  }
});

test("a relative edited path is resolved against the agent workspace", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "relative");
    mkdirSync(path.join(repo, "lib"));
    writeFileSync(path.join(repo, "lib", "a.ts"), "export {};\n");
    env.ix.setMapped([repo]);

    const handlers = registerPlugin(repo);
    handlers.get("after_tool_call")(
      { toolName: "write", toolCallId: "w1", params: { path: "lib/a.ts", content: "" } },
      { agentId: "main", toolName: "write" }
    );

    assert.ok(await waitFor(() => env.ix.mapCalls().length > 0));
    assert.deepEqual(env.ix.mapCalls()[0].argv, ["map", repo, "--silent"]);
  } finally {
    env.restore();
  }
});

test("session end maps the agent workspace root, not the sessions directory", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "workspace");
    const sessions = gitRepo(env.sandbox, "state-agents-main-sessions");
    env.ix.setMapped([repo, sessions]);

    const handlers = registerPlugin(repo);
    handlers.get("session_end")(
      { sessionId: "s1", messageCount: 3, sessionFile: path.join(sessions, "s1.jsonl") },
      { agentId: "main", sessionId: "s1" }
    );

    assert.ok(await waitFor(() => env.ix.mapCalls().length > 0));
    const maps = env.ix.mapCalls();
    assert.equal(maps.length, 1);
    assert.deepEqual(maps[0].argv, ["map", repo, "--silent"]);
  } finally {
    env.restore();
  }
});

test("session end without a resolvable workspace does nothing", async () => {
  const env = setup();
  try {
    const sessions = gitRepo(env.sandbox, "sessions-only");
    env.ix.setMapped([sessions]);

    const handlers = new Map();
    // The bare stub the launch-baseline test uses: no runtime surface at all.
    entry.register({
      registerTool() {},
      on(name, handler) {
        handlers.set(name, handler);
      },
    });
    handlers.get("session_end")(
      { sessionId: "s1", messageCount: 1, sessionFile: path.join(sessions, "s1.jsonl") },
      { agentId: "main", sessionId: "s1" }
    );
    await settle();
    assert.equal(env.ix.calls().length, 0);
  } finally {
    env.restore();
  }
});

test("a failed edit and a skipped path request no map", async () => {
  const env = setup();
  try {
    const repo = gitRepo(env.sandbox, "skipped");
    env.ix.setMapped([repo]);
    const handlers = registerPlugin(repo);
    const after = handlers.get("after_tool_call");
    after(
      { toolName: "edit", toolCallId: "x1", params: { path: path.join(repo, "a.ts"), edits: [] }, error: "boom" },
      { agentId: "main", toolName: "edit" }
    );
    after(
      { toolName: "write", toolCallId: "x2", params: { path: path.join(repo, "README.md"), content: "" } },
      { agentId: "main", toolName: "write" }
    );
    await settle();
    assert.equal(env.ix.calls().length, 0);
  } finally {
    env.restore();
  }
});
