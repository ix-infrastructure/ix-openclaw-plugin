// Copyright 2026 Ix Infrastructure Inc.

/**
 * The plugin against OpenClaw's real host contract (openclaw 2026.8.2), without
 * loading the host: the tool shape the loader keeps, the lowercase core tool
 * names, apply_patch paths, and the typed `api.on` handlers.
 *
 * tests/openclaw-host.test.mjs repeats the tool check through OpenClaw's own
 * loader when the Node runtime can run it.
 *
 * Every `ix` call goes to the strict fake in tests/fake-ix.mjs.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { installFakeIx, waitFor } from "./fake-ix.mjs";
import entry from "../dist/plugins/ix-plugin.js";
import {
  WRITE_TOOL_NAMES,
  applyPatchPaths,
  isWriteTool,
  writeToolPaths,
} from "../dist/runtime/host-tools.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(rootDir, "openclaw.plugin.json"), "utf8"));

/**
 * The host's own check (describeMalformedPluginTool,
 * node_modules/openclaw/dist/tools-mqHZh-rd.js:418-424), restated: a plugin
 * tool without a name, an execute function or a parameters object is dropped.
 */
function malformedReason(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "tool must be an object";
  if (typeof tool.name !== "string" || !tool.name.trim()) return "missing non-empty name";
  if (typeof tool.execute !== "function") return `${tool.name} missing execute function`;
  if (!tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)) {
    return `${tool.name} missing parameters object`;
  }
  return undefined;
}

/** A recording api: registerTool keeps exactly what the plugin passed. */
function recordingApi(extra = {}) {
  const tools = [];
  const hooks = new Map();
  const api = {
    registerTool(tool, opts) {
      tools.push({ tool, opts });
    },
    on(name, handler, options) {
      hooks.set(name, { handler, options });
    },
    ...extra,
  };
  entry.register(api);
  return { tools, hooks };
}

function withWorkspaceApi(workspaceDir) {
  return {
    config: { agents: {} },
    runtime: {
      config: { current: () => ({ agents: {} }) },
      agent: {
        resolveAgentWorkspaceDir: (_cfg, agentId) => (agentId === "main" ? workspaceDir : undefined),
      },
    },
  };
}

function sandbox() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-host-")));
  const saved = { HOME: process.env.HOME, XDG_STATE_HOME: process.env.XDG_STATE_HOME };
  process.env.HOME = path.join(dir, "home");
  process.env.XDG_STATE_HOME = path.join(dir, "state");
  mkdirSync(process.env.HOME, { recursive: true });
  const ix = installFakeIx();
  return {
    dir,
    ix,
    restore() {
      ix.restore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── Tools ──────────────────────────────────────────────────────────────────

test("every declared tool is registered as a named factory", () => {
  const { tools } = recordingApi();
  assert.equal(tools.length, 17);
  assert.deepEqual(
    tools.map(({ opts }) => opts?.name).toSorted(),
    [...manifest.contracts.tools].toSorted()
  );
  for (const { tool } of tools) {
    assert.equal(typeof tool, "function", "registered as a factory so it gets the tool context");
  }
});

test("each factory builds a tool the host's malformed-tool check accepts", () => {
  // The old registration passed `{name, description, inputSchema, execute}` and
  // every one of the 17 failed this check with "missing parameters object".
  const { tools } = recordingApi();
  for (const { tool: factory, opts } of tools) {
    const tool = factory({ workspaceDir: rootDir });
    assert.equal(malformedReason(tool), undefined, `${opts.name}: ${malformedReason(tool)}`);
    assert.equal(tool.name, opts.name);
    assert.equal(tool.parameters.type, "object");
    assert.equal("inputSchema" in tool, false);
    assert.equal(typeof tool.label, "string");
  }
});

test("execute takes (toolCallId, params) and returns an AgentToolResult", async () => {
  const env = sandbox();
  try {
    const { tools } = recordingApi();
    const factory = tools.find(({ opts }) => opts.name === "ix-query").tool;
    const tool = factory({ workspaceDir: env.dir });

    const result = await tool.execute("call-1", { symbol: "registerTool" }, undefined);

    assert.ok(Array.isArray(result.content), "content array");
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.equal(typeof result.content[0].text, "string");
    assert.ok(result.content[0].text.length > 0);
    assert.ok("details" in result);

    // The params are the second argument, and ix runs in the agent workspace.
    const locate = env.ix.calls().find((call) => call.argv[0] === "locate");
    assert.ok(locate, "ix locate should have run");
    assert.equal(locate.argv[1], "registerTool");
    assert.equal(locate.cwd, env.dir);
  } finally {
    env.restore();
  }
});

// ── Tool names ─────────────────────────────────────────────────────────────

test("write tools are OpenClaw's lowercase core tool ids", () => {
  assert.deepEqual([...WRITE_TOOL_NAMES], ["apply_patch", "edit", "write"]);
  for (const name of ["edit", "write", "apply_patch"]) assert.equal(isWriteTool(name), true, name);
  // Claude Code spellings and tools OpenClaw does not have.
  for (const name of ["Edit", "Write", "MultiEdit", "NotebookEdit", "read", "exec", "Bash", "", undefined]) {
    assert.equal(isWriteTool(name), false, String(name));
  }
});

test("edit and write paths come from `path`", () => {
  assert.deepEqual(writeToolPaths("edit", { path: "src/a.ts", edits: [] }), ["src/a.ts"]);
  assert.deepEqual(writeToolPaths("write", { path: "/abs/b.ts", content: "" }), ["/abs/b.ts"]);
  assert.deepEqual(writeToolPaths("write", { file_path: "c.ts" }), []);
  assert.deepEqual(writeToolPaths("Edit", { path: "src/a.ts" }), []);
});

test("apply_patch paths are parsed from the patch envelope", () => {
  const input = [
    "*** Begin Patch",
    "*** Add File: src/new.ts",
    "+export const a = 1;",
    "+*** Update File: not-a-header.ts",
    "*** Update File: src/old.ts",
    "*** Move to: src/moved.ts",
    "@@",
    "-a",
    "+b",
    "*** Delete File: src/gone.ts",
    "*** Update File: src/old.ts",
    "@@",
    " context",
    "*** End Patch",
  ].join("\n");

  assert.deepEqual(applyPatchPaths(input), [
    "src/new.ts",
    "src/old.ts",
    "src/moved.ts",
    "src/gone.ts",
  ]);
  assert.deepEqual(writeToolPaths("apply_patch", { input }), applyPatchPaths(input));
  assert.deepEqual(applyPatchPaths(""), []);
  assert.deepEqual(applyPatchPaths(undefined), []);
});

test("host-derived apply_patch paths win over parsing", () => {
  assert.deepEqual(
    writeToolPaths("apply_patch", { input: "*** Add File: a.ts" }, ["/ws/a.ts", "/ws/a.ts"]),
    ["/ws/a.ts"]
  );
});

// ── api.on handlers ────────────────────────────────────────────────────────

test("hooks are registered on typed events with a canonical tool matcher", () => {
  const { hooks } = recordingApi();
  assert.deepEqual(
    [...hooks.keys()],
    ["before_prompt_build", "before_tool_call", "after_tool_call", "session_end"]
  );
  for (const name of ["before_tool_call", "after_tool_call"]) {
    assert.deepEqual([...hooks.get(name).options.matcher], ["apply_patch", "edit", "write"]);
  }
  for (const name of ["before_prompt_build", "session_end"]) {
    assert.equal(hooks.get(name).options.matcher, undefined);
  }
});

test("before_tool_call gates an edit through ix-decide in the agent workspace", async () => {
  const env = sandbox();
  try {
    const workspace = path.join(env.dir, "ws");
    mkdirSync(path.join(workspace, "src"), { recursive: true });
    const target = path.join(workspace, "src", "core.ts");
    env.ix.setImpact({ [target]: { risk: "critical", dependentCount: 40 } });
    const { hooks } = recordingApi(withWorkspaceApi(workspace));
    const before = hooks.get("before_tool_call").handler;

    const result = await before(
      { toolName: "edit", toolCallId: "e1", params: { path: "src/core.ts", edits: [] } },
      { agentId: "main", toolName: "edit" }
    );

    assert.equal(result?.block, true);
    assert.match(result.blockReason, /BLOCK/);
    const impact = env.ix.calls().find((call) => call.argv[0] === "impact");
    assert.deepEqual(impact.argv, ["impact", target, "--format", "json"]);
  } finally {
    env.restore();
  }
});

test("before_tool_call asks for approval on REVIEW, with the host's result shape", async () => {
  const env = sandbox();
  try {
    const target = path.join(env.dir, "lib.ts");
    env.ix.setImpact({ [target]: { risk: "medium", dependentCount: 6 } });
    const { hooks } = recordingApi(withWorkspaceApi(env.dir));

    const result = await hooks.get("before_tool_call").handler(
      { toolName: "write", toolCallId: "w1", params: { path: target, content: "" } },
      { agentId: "main", toolName: "write" }
    );

    assert.equal(result?.block, undefined);
    assert.equal(result?.requireApproval?.title, "Ix review required for lib.ts");
    assert.equal(result.requireApproval.severity, "warning");
    assert.deepEqual(result.requireApproval.allowedDecisions, ["allow-once", "deny"]);
    assert.equal("timeoutBehavior" in result.requireApproval, false, "deprecated in the SDK");
  } finally {
    env.restore();
  }
});

test("before_tool_call sends every apply_patch file to ix-decide", async () => {
  const env = sandbox();
  try {
    const { hooks } = recordingApi(withWorkspaceApi(env.dir));
    const input = "*** Begin Patch\n*** Update File: a.ts\n@@\n-x\n+y\n*** Add File: b.ts\n+z\n*** Add File: NOTES.md\n+n\n*** End Patch";

    const result = await hooks.get("before_tool_call").handler(
      { toolName: "apply_patch", toolCallId: "p1", params: { input } },
      { agentId: "main", toolName: "apply_patch" }
    );

    assert.equal(result, undefined, "ALLOW is silent");
    const impacts = env.ix.calls().filter((call) => call.argv[0] === "impact").map((call) => call.argv[1]);
    assert.deepEqual(impacts, [path.join(env.dir, "a.ts"), path.join(env.dir, "b.ts")]);
  } finally {
    env.restore();
  }
});

test("before_tool_call ignores Claude tool names, reads and execs", async () => {
  const env = sandbox();
  try {
    const { hooks } = recordingApi(withWorkspaceApi(env.dir));
    const before = hooks.get("before_tool_call").handler;
    const calls = [
      ["Edit", { file_path: path.join(env.dir, "a.ts") }],
      ["Write", { file_path: path.join(env.dir, "a.ts") }],
      ["MultiEdit", { file_path: path.join(env.dir, "a.ts") }],
      ["read", { path: path.join(env.dir, "a.ts") }],
      ["exec", { command: "grep -r foo ." }],
    ];
    for (const [toolName, params] of calls) {
      const result = await before({ toolName, toolCallId: toolName, params }, { agentId: "main", toolName });
      assert.equal(result, undefined, toolName);
    }
    assert.equal(env.ix.calls().length, 0);
  } finally {
    env.restore();
  }
});

test("after_tool_call maps the git root of every file an apply_patch wrote", async () => {
  const env = sandbox();
  try {
    const repo = path.join(env.dir, "repo");
    mkdirSync(path.join(repo, "src"), { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    env.ix.setMapped([repo]);
    const { hooks } = recordingApi(withWorkspaceApi(repo));

    hooks.get("after_tool_call").handler(
      {
        toolName: "apply_patch",
        toolCallId: "p2",
        params: { input: "*** Begin Patch\n*** Add File: src/x.ts\n+x\n*** End Patch" },
      },
      { agentId: "main", toolName: "apply_patch" }
    );

    assert.ok(await waitFor(() => env.ix.mapCalls().length > 0), "root map should start");
    assert.deepEqual(env.ix.mapCalls()[0].argv, ["map", repo, "--silent"]);
  } finally {
    env.restore();
  }
});

test("after_tool_call does nothing for a Claude tool name", async () => {
  const env = sandbox();
  try {
    const repo = path.join(env.dir, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "-q", repo]);
    env.ix.setMapped([repo]);
    writeFileSync(path.join(repo, "a.ts"), "");
    const { hooks } = recordingApi(withWorkspaceApi(repo));

    hooks.get("after_tool_call").handler(
      { toolName: "Edit", toolCallId: "c1", params: { file_path: path.join(repo, "a.ts") } },
      { agentId: "main", toolName: "Edit" }
    );

    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(env.ix.calls().length, 0);
  } finally {
    env.restore();
  }
});

test("the plugin ships no folder hooks", () => {
  // Folder hooks get only internal events (message:received, ...); the
  // before_tool_call / tool_result_persist / agent_end ones never fired.
  assert.equal("hooks" in manifest, false);
  const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  assert.equal(pkg.files.includes("hooks"), false);
});
