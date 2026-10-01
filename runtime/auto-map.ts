// Copyright 2026 Ix Infrastructure Inc.

/**
 * The one automatic `ix map` this plugin is allowed to start.
 *
 * Every automatic map goes through `requestGuardedMap`, and it runs only when
 * all of these hold:
 *
 *  1. The root is `git rev-parse --show-toplevel` of a project directory the
 *     host gave us (an edited file's directory, the agent workspace) — never
 *     the plugin's own directory or OpenClaw's state/sessions directory. Not a
 *     git repo, or the root is $HOME → skip.
 *  2. The project is already mapped: `ix status --format json --root <root>`
 *     reports `graphCompleted === true`. An automatic map never creates a
 *     workspace; any failure, timeout or non-JSON answer is a skip.
 *  3. No automatic map was started for the same root within the debounce
 *     window. The stamp lives in a per-user state directory keyed by a hash of
 *     the canonical root — not a shared, predictable /tmp path. Ix itself holds
 *     a per-workspace map lock, so there is no plugin-level global lock.
 *  4. The command is exactly `ix map <root> --silent`, cwd = root, with
 *     `IX_AUTO_MAP=1` (Ix then skips the auto map against a remote backend),
 *     spawned detached so no hook waits on it.
 *
 * `ix map <file>` is never valid: map rejects non-directories ("Map path is not
 * a directory", Ix v0.10.6+), which is why post-edit hooks ask for the root map
 * here instead of mapping the file they touched.
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseIxJson, runIx } from "../tools/base.ts";

const DEFAULT_DEBOUNCE_SECONDS = 300;
const GIT_TIMEOUT_MS = 5_000;
const STATUS_TIMEOUT_MS = 10_000;
const STATE_DIR_NAME = "ix-openclaw-plugin";

export type AutoMapSkipReason =
  | "no-project-dir"
  | "not-git"
  | "home-root"
  | "debounced"
  | "in-flight"
  | "not-mapped"
  | "no-state-dir"
  | "spawn-failed";

export type AutoMapResult =
  | { started: true; root: string }
  | { started: false; reason: AutoMapSkipReason; root?: string };

// Requests for one root that overlap (two edits finishing together) must not
// both pass the debounce check while the first is still asking `ix status`.
const inFlight = new Set<string>();

/** Per-user state directory, created 0700. Exported for tests. */
export function autoMapStateDir(): string {
  const base = process.env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, STATE_DIR_NAME);
}

function debounceMs(): number {
  const raw = Number(process.env.IX_MAP_DEBOUNCE_SECONDS);
  const seconds = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DEBOUNCE_SECONDS;
  return seconds * 1000;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function gitToplevel(projectDir: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", projectDir, "rev-parse", "--show-toplevel"],
      { timeout: GIT_TIMEOUT_MS },
      (error, stdout) => {
        const top = stdout?.trim();
        resolve(error || !top ? null : top);
      }
    );
  });
}

async function isMapped(root: string): Promise<boolean> {
  try {
    const raw = await runIx(["status", "--format", "json", "--root", root], {
      cwd: root,
      timeoutMs: STATUS_TIMEOUT_MS,
    });
    const status = parseIxJson<{ graphCompleted?: unknown }>(raw);
    return status?.graphCompleted === true;
  } catch {
    return false;
  }
}

function stampFile(stateDir: string, root: string): string {
  const key = createHash("sha256").update(root).digest("hex").slice(0, 32);
  return join(stateDir, `automap-${key}`);
}

function recentlyStarted(file: string): boolean {
  try {
    return Date.now() - statSync(file).mtimeMs < debounceMs();
  } catch {
    return false;
  }
}

/**
 * Resolve the canonical git root for a project directory, or a skip reason when
 * the directory is missing, not inside a git work tree, or its root is $HOME.
 */
export async function resolveProjectRoot(
  projectDir: string | undefined | null
): Promise<{ root: string } | { reason: AutoMapSkipReason }> {
  if (typeof projectDir !== "string" || !projectDir.trim()) return { reason: "no-project-dir" };
  const top = await gitToplevel(projectDir);
  if (!top) return { reason: "not-git" };
  const root = canonical(top);
  if (root === canonical(homedir())) return { reason: "home-root" };
  return { root };
}

/**
 * Start `ix map <root> --silent` in the background if, and only if, every
 * guard above passes. Never throws; resolves with what it did and why.
 */
export async function requestGuardedMap(
  projectDir: string | undefined | null
): Promise<AutoMapResult> {
  const resolved = await resolveProjectRoot(projectDir);
  if ("reason" in resolved) return { started: false, reason: resolved.reason };
  const { root } = resolved;

  if (inFlight.has(root)) return { started: false, reason: "in-flight", root };
  inFlight.add(root);
  try {
    const stateDir = autoMapStateDir();
    try {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    } catch {
      return { started: false, reason: "no-state-dir", root };
    }

    const stamp = stampFile(stateDir, root);
    if (recentlyStarted(stamp)) return { started: false, reason: "debounced", root };
    if (!(await isMapped(root))) return { started: false, reason: "not-mapped", root };

    try {
      writeFileSync(stamp, `${Date.now()}\n${root}\n`, { mode: 0o600 });
    } catch {
      return { started: false, reason: "no-state-dir", root };
    }

    try {
      const child = spawn("ix", ["map", root, "--silent"], {
        cwd: root,
        detached: true,
        stdio: "ignore",
        env: { ...process.env, IX_AUTO_MAP: "1" },
      });
      // A missing binary surfaces as an async 'error' event; without a
      // listener it would crash the host process.
      child.on("error", () => {});
      child.unref();
    } catch {
      return { started: false, reason: "spawn-failed", root };
    }
    return { started: true, root };
  } finally {
    inFlight.delete(root);
  }
}
