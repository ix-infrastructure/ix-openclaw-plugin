// Copyright 2026 Ix Infrastructure Inc.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");

const skillNames = [
  "ix-understand",
  "ix-investigate",
  "ix-impact",
  "ix-plan",
  "ix-debug",
  "ix-architecture",
  "ix-docs",
  "ix-help",
];

const agentNames = [
  "ix-explorer",
  "ix-system-explorer",
  "ix-bug-investigator",
  "ix-safe-refactor-planner",
  "ix-architecture-auditor",
];

test("manifest declares the full plugin surface", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, "openclaw.plugin.json"), "utf8")
  );

  assert.equal(manifest.id, "ix-memory");
  assert.equal(manifest.activation?.onStartup, true);
  assert.deepEqual(manifest.skills, ["skills"]);
  // Behaviour lives on the plugin's typed api.on handlers, not folder hooks.
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.contracts?.tools?.length, 17);
});

test("package metadata points OpenClaw at the built plugin entry", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  assert.equal(pkg.openclaw?.extensions?.[0], "./dist/plugins/ix-plugin.js");
  assert.equal(pkg.scripts?.test, "npm run build && node --test tests/*.test.mjs");

  for (const entry of ["dist", "agents", "skills", "install.sh", "install.ps1"]) {
    assert.ok(pkg.files.includes(entry), `${entry} should be published`);
  }
});

test("skills, agents, and installers exist; folder hooks do not", () => {
  for (const skill of skillNames) {
    assert.ok(fs.existsSync(path.join(rootDir, "skills", skill, "SKILL.md")), skill);
  }

  for (const agent of agentNames) {
    assert.ok(fs.existsSync(path.join(rootDir, "agents", `${agent}.md`)), agent);
  }

  assert.equal(fs.existsSync(path.join(rootDir, "hooks")), false);

  assert.ok(fs.existsSync(path.join(rootDir, "install.sh")));
  assert.ok(fs.existsSync(path.join(rootDir, "install.ps1")));
});
