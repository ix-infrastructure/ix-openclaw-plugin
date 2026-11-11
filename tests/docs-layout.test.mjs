// Copyright 2026 Ix Infrastructure Inc.

// The repository's documents must not describe behaviour the plugin does not
// have without saying so, and every prompt file the package ships must be one
// OpenClaw actually loads.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function trackedMarkdown() {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: rootDir, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    // Only files present in this checkout (a deletion may not be staged yet).
    .filter((file) => fs.existsSync(path.join(rootDir, file)));
}

// The manifest declares `skills` only; OpenClaw has no plugin manifest field
// for agent prompts, and it reads AGENTS.md / SOUL.md from an agent's
// workspace, never from a plugin directory. So the package ships only what the
// plugin entry and the skills loader use.
test("the package ships no prompt file that nothing loads", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const entry of ["agents", "AGENTS.md", "SOUL.md"]) {
    assert.equal(pkg.files.includes(entry), false, `${entry} is not loaded by OpenClaw and must not ship`);
  }

  const manifest = JSON.parse(read("openclaw.plugin.json"));
  assert.equal(manifest.agents, undefined);
  assert.deepEqual(manifest.skills, ["skills"]);

  assert.equal(fs.existsSync(path.join(rootDir, "agents")), false, "agents/ prompts are not loaded by anything");
  assert.equal(fs.existsSync(path.join(rootDir, "SOUL.md")), false, "SOUL.md is not loaded by anything");
});

test("no shipped text names the removed agent prompts", () => {
  const removed = /\b(ix-explorer|ix-system-explorer|ix-bug-investigator|ix-safe-refactor-planner|ix-architecture-auditor)\b|\bSOUL\.md\b|\bagents\/ix-/;
  const shipped = execFileSync("git", ["ls-files"], { cwd: rootDir, encoding: "utf8" })
    .split("\n")
    .filter((file) => /^(skills|tools|plugins|runtime)\//.test(file) || /^(README|AGENTS|ARCHITECTURE)\.md$/.test(file))
    .filter((file) => fs.existsSync(path.join(rootDir, file)));
  const offences = [];
  for (const file of shipped) {
    read(file).split("\n").forEach((line, index) => {
      if (removed.test(line)) offences.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offences, []);
});

test("AGENTS.md says it is the contributor guide, not a shipped prompt", () => {
  const text = read("AGENTS.md");
  assert.match(text.split("\n").slice(0, 12).join("\n"), /not part of the installed plugin/);
});

// The May 2026 planning documents describe a plan, not the plugin as built.
for (const doc of ["PLUGIN_SPEC.md", "ROADMAP.md", "OpenClawPlatformSurvey.md"]) {
  test(`${doc} is marked superseded at the top and points at ARCHITECTURE.md`, () => {
    const head = read(doc).split("\n").slice(0, 25).join("\n");
    assert.match(head, /Superseded — historical record/);
    assert.match(head, /\(\.\/ARCHITECTURE\.md\)/);
  });
}

test("relative links in markdown resolve inside the repository", () => {
  const broken = [];
  for (const file of trackedMarkdown()) {
    const dir = path.dirname(path.join(rootDir, file));
    for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const resolved = path.resolve(dir, target.split("#")[0]);
      const inside = resolved === rootDir || resolved.startsWith(rootDir + path.sep);
      if (!inside || !fs.existsSync(resolved)) broken.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("ARCHITECTURE.md names files that exist and every hook the plugin registers", () => {
  const text = read("ARCHITECTURE.md");

  const paths = [...text.matchAll(/`((?:plugins|runtime|tools|skills|tests)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]);
  assert.ok(paths.length > 0);
  for (const file of paths) {
    assert.ok(fs.existsSync(path.join(rootDir, file)), `ARCHITECTURE.md names missing ${file}`);
  }

  const entry = read("plugins/ix-plugin.ts");
  const events = [...entry.matchAll(/api\.on\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.match(text, new RegExp("`" + event + "`"), `ARCHITECTURE.md should describe ${event}`);
  }
});
