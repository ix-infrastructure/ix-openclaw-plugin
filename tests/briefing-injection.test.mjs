// Copyright 2026 Ix Infrastructure Inc.

/**
 * The session briefing goes in once per window.
 *
 * Two paths inject it — the plugin's `before_prompt_build` and the
 * `message:received` hook — in different processes with different caches. The
 * plugin's ran on every prompt build: its cache stopped it re-running
 * `ix briefing`, not re-injecting the output. The marker these two now share is
 * what makes it once.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRIEFING_MAX_CHARS,
  briefingAlreadyInjected,
  markBriefingInjected,
  capBriefing,
} from "../dist/hooks/ix-utils.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The cache lives under $TMPDIR, so each case gets its own. */
function isolateCache() {
  const dir = mkdtempSync(path.join(tmpdir(), "ix-openclaw-test-"));
  process.env.TMPDIR = dir;
  return dir;
}

test("the first caller injects and the second does not", () => {
  isolateCache();

  assert.equal(briefingAlreadyInjected(), false);
  markBriefingInjected();
  assert.equal(briefingAlreadyInjected(), true);
  assert.equal(briefingAlreadyInjected(), true);
});

test("the claim expires with its window", () => {
  isolateCache();

  markBriefingInjected();
  // A zero-length window is a window that has already passed.
  assert.equal(briefingAlreadyInjected(0), false);
});

test("a briefing longer than the cap is cut and says so", () => {
  const long = "x".repeat(BRIEFING_MAX_CHARS + 500);
  const capped = capBriefing(long);

  assert.ok(capped.length < long.length);
  assert.ok(capped.startsWith("x".repeat(100)));
  assert.match(capped, /briefing truncated/);
});

test("a briefing within the cap is passed through, trimmed", () => {
  assert.equal(capBriefing("  Ix Briefing\n  Revision: 2741  "), "Ix Briefing\n  Revision: 2741");
  assert.equal(capBriefing("   "), "");
});

test("both injection paths ask the CLI for text, not json", () => {
  // json is 4,352 bytes against 1,305 for the same briefing, and nothing here
  // parses it — it is pasted into a prompt.
  const sources = [
    path.join(projectRoot, "plugins", "ix-plugin.ts"),
    path.join(projectRoot, "hooks", "ix-briefing", "handler.ts"),
  ];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /"briefing", "--format", "text"/, `${path.basename(file)} should ask for text`);
    assert.doesNotMatch(
      text,
      /"briefing", "--format", "json"/,
      `${path.basename(file)} should not ask for json`,
    );
  }
});

test("both injection paths consult the shared marker", () => {
  const sources = [
    path.join(projectRoot, "plugins", "ix-plugin.ts"),
    path.join(projectRoot, "hooks", "ix-briefing", "handler.ts"),
  ];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /briefingAlreadyInjected\(/, `${path.basename(file)} should check the marker`);
    assert.match(text, /markBriefingInjected\(/, `${path.basename(file)} should set the marker`);
  }
});

test("no hook is left reading the old per-path briefing gate", () => {
  // The hook used to gate on its own `ix-briefing` cache entry, which the
  // plugin path knew nothing about.
  const hooksDir = path.join(projectRoot, "hooks");
  for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const handler = path.join(hooksDir, entry.name, "handler.ts");
    let text;
    try {
      text = readFileSync(handler, "utf8");
    } catch {
      continue;
    }
    assert.doesNotMatch(
      text,
      /readCache\("ix-briefing",/,
      `${entry.name} should use the shared marker, not its own briefing cache`,
    );
  }
});
