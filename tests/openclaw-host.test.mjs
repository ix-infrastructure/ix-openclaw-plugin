// Copyright 2026 Ix Infrastructure Inc.

/**
 * Load the plugin through OpenClaw's own plugin loader and tool resolver from
 * node_modules (the pinned devDependency), the path a gateway takes:
 *
 *   loadOpenClawPlugins       -> register(api): contracts, typed hooks, matchers
 *   resolvePluginTools        -> run each tool factory, drop malformed tools
 *                                ("plugin tool is malformed (...)")
 *
 * Neither is a public SDK export, so they are found by name in the bundled
 * dist chunks rather than by their hashed file names, which change with every
 * OpenClaw release.
 *
 * OpenClaw refuses to start on a Node whose bundled SQLite has the WAL-reset
 * bug (it needs Node >= 22.22.3 / 24.15 / 25.9); there the loader cannot even
 * be imported, so these tests skip and say why. CI's `node-version: "22"`
 * resolves to a fixed release.
 *
 * HOME and OpenClaw's state/config paths point at a throwaway directory, and
 * `ix` is the strict fake, so nothing here touches real config or a backend.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installFakeIx } from "./fake-ix.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openclawDist = path.join(rootDir, "node_modules", "openclaw", "dist");
const manifest = JSON.parse(readFileSync(path.join(rootDir, "openclaw.plugin.json"), "utf8"));
const PLUGIN_ID = manifest.id;

/** Find `function <name>(` exported from a dist chunk whose name starts with `prefix`. */
async function importHostFunction(prefix, name) {
  for (const file of readdirSync(openclawDist)) {
    if (!file.startsWith(prefix) || !file.endsWith(".js")) continue;
    const source = readFileSync(path.join(openclawDist, file), "utf8");
    if (!source.includes(`function ${name}(`)) continue;
    const alias = source.match(new RegExp(`export \\{[^}]*\\b${name} as (\\w+)`))?.[1];
    if (!alias) continue;
    const mod = await import(pathToFileURL(path.join(openclawDist, file)).href);
    if (typeof mod[alias] === "function") return mod[alias];
  }
  throw new Error(`openclaw dist has no exported ${name} in ${prefix}*.js`);
}

let host;
let unsupported;
try {
  host = {
    loadOpenClawPlugins: await importHostFunction("loader-", "loadOpenClawPlugins"),
    resolvePluginTools: await importHostFunction("tools-", "resolvePluginTools"),
  };
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!/SQLite support is unavailable or unsafe in this Node runtime/.test(message)) throw error;
  unsupported = `OpenClaw cannot run on Node ${process.versions.node}: ${message.split(". ")[0]}`;
}

/** Throwaway HOME/state/config, fake ix, and console capture for host logs. */
function hostSandbox() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "ix-openclaw-host-")));
  const workspace = path.join(dir, "workspace");
  mkdirSync(workspace, { recursive: true });
  const keys = ["HOME", "OPENCLAW_HOME", "OPENCLAW_STATE_DIR", "OPENCLAW_CONFIG_PATH", "XDG_STATE_HOME"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.HOME = path.join(dir, "home");
  process.env.OPENCLAW_HOME = path.join(dir, "home");
  process.env.OPENCLAW_STATE_DIR = path.join(dir, "state");
  process.env.OPENCLAW_CONFIG_PATH = path.join(dir, "openclaw.json");
  process.env.XDG_STATE_HOME = path.join(dir, "xdg-state");
  const ix = installFakeIx();

  const logs = [];
  const logger = {
    debug: (message) => logs.push(String(message)),
    info: (message) => logs.push(String(message)),
    warn: (message) => logs.push(String(message)),
    error: (message) => logs.push(String(message)),
  };
  // resolvePluginTools logs through OpenClaw's subsystem logger, not ours.
  const originalStderr = process.stderr.write.bind(process.stderr);
  const originalStdout = process.stdout.write.bind(process.stdout);
  const capture = (original) => (chunk, ...rest) => {
    logs.push(String(chunk));
    return original(chunk, ...rest);
  };
  process.stderr.write = capture(originalStderr);
  process.stdout.write = capture(originalStdout);

  return {
    workspace,
    ix,
    logs,
    logger,
    restore() {
      process.stderr.write = originalStderr;
      process.stdout.write = originalStdout;
      ix.restore();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function pluginConfig() {
  return {
    plugins: {
      load: { paths: [rootDir] },
      entries: {
        // The README's documented config: before_prompt_build is a
        // conversation hook, gated for non-bundled plugins.
        [PLUGIN_ID]: { enabled: true, hooks: { allowConversationAccess: true } },
      },
    },
  };
}

const skip = unsupported ? { skip: unsupported } : {};

test("OpenClaw's loader registers the plugin, its 17 tools and typed hooks", skip, () => {
  const env = hostSandbox();
  try {
    const registry = host.loadOpenClawPlugins({
      config: pluginConfig(),
      workspaceDir: env.workspace,
      activate: false,
      cache: false,
      onlyPluginIds: [PLUGIN_ID],
      logger: env.logger,
    });

    const plugin = registry.plugins.find((entry) => entry.id === PLUGIN_ID);
    assert.ok(plugin, "plugin discovered from plugins.load.paths");
    assert.equal(plugin.status, "loaded", plugin.error);
    assert.deepEqual([...plugin.toolNames].toSorted(), [...manifest.contracts.tools].toSorted());

    const errors = registry.diagnostics.filter(
      (entry) => entry.pluginId === PLUGIN_ID && entry.level === "error"
    );
    assert.deepEqual(errors, []);

    const hooks = registry.typedHooks.filter((entry) => entry.pluginId === PLUGIN_ID);
    assert.deepEqual(
      hooks.map((entry) => entry.hookName),
      ["before_prompt_build", "before_tool_call", "after_tool_call", "session_end"]
    );
    // The host normalizes the matcher and would have thrown on "Edit"/"Write".
    for (const entry of hooks.filter((h) => h.hookName.endsWith("_tool_call"))) {
      assert.deepEqual(entry.matcher, ["apply_patch", "edit", "write"]);
    }
    assert.equal(
      env.logs.some((line) => /never fires|is dispatched by the typed hook runner only/.test(line)),
      false
    );
  } finally {
    env.restore();
  }
});

test("OpenClaw's tool resolver accepts all 17 tools and logs none as malformed", skip, async () => {
  const env = hostSandbox();
  try {
    const config = pluginConfig();
    const tools = host.resolvePluginTools({
      context: { config, workspaceDir: env.workspace },
      toolAllowlist: [PLUGIN_ID],
    });

    const ours = tools.filter((tool) => manifest.contracts.tools.includes(tool.name));
    assert.deepEqual(
      ours.map((tool) => tool.name).toSorted(),
      [...manifest.contracts.tools].toSorted()
    );
    const malformed = env.logs.filter((line) => line.includes("plugin tool is malformed"));
    assert.deepEqual(malformed, []);

    // A resolved tool runs with the host's argument order and result shape,
    // in the agent workspace the host handed the factory.
    const query = ours.find((tool) => tool.name === "ix-query");
    const result = await query.execute("call-1", { symbol: "registerTool" });
    assert.equal(result.content[0].type, "text");
    assert.ok(result.content[0].text.length > 0);
    const call = env.ix.calls().find((entry) => entry.argv[0] === "locate");
    assert.equal(call?.cwd, env.workspace);
  } finally {
    env.restore();
  }
});
