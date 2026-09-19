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
import { mkdtempSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BRIEFING_CLAIM_KEY,
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
  const dir = isolateCache();

  markBriefingInjected();
  // Age the marker rather than waiting, and rather than asking whether a
  // zero-length window has passed — a fresh file's mtime can round to just
  // after `Date.now()`, which made that question answer "no" about one run in
  // four. (The directory name is readCache's, which is what is being tested.)
  const marker = path.join(dir, "ix-openclaw-cache", BRIEFING_CLAIM_KEY);
  const aMinuteAgo = new Date(Date.now() - 60_000);
  utimesSync(marker, aMinuteAgo, aMinuteAgo);

  assert.equal(briefingAlreadyInjected(30_000), false, "a minute old, in a 30s window");
  assert.equal(briefingAlreadyInjected(120_000), true, "a minute old, in a 2min window");
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
