/**
 * ix-utils.ts — Shared utilities for Ix Memory OpenClaw hooks.
 *
 * Provides health checking with TTL cache, JSON parsing from ix output,
 * async ix command execution, and local error logging (no data leaves the machine).
 */

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const HEALTH_TTL = 30_000; // 30 seconds
const BRIEFING_TTL = 600_000; // 10 minutes
const READ_CACHE_TTL = 300_000; // 5 minutes
const ERROR_STORE = join(homedir(), ".local", "share", "ix", "plugin", "errors");
const RATE_FILE = join(ERROR_STORE, "rate-limit.json");
const SESSION_FILE = join(tmpdir(), "ix-error-session-count");

let healthCacheTime = 0;
let healthCacheOk = false;

/** Check if `ix` is available on PATH. */
export function ixAvailable(): boolean {
  try {
    const { execFileSync } = require("node:child_process");
    execFileSync("which", ["ix"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Health check with 30s TTL cache. Returns true if ix backend is reachable. */
export async function ixHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - healthCacheTime < HEALTH_TTL && healthCacheOk) return true;

  try {
    await runIx(["status"]);
    healthCacheTime = now;
    healthCacheOk = true;
    return true;
  } catch {
    healthCacheOk = false;
    return false;
  }
}

/** Run an ix command and return stdout. */
export function runIx(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ix", args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ix ${args[0]} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

/** Run an ix command, fire-and-forget (no await needed). */
export function runIxDetached(args: string[]): void {
  const { spawn } = require("node:child_process");
  const child = spawn("ix", args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Parse JSON from ix output, stripping any header noise. */
export function parseIxJson(raw: string): unknown | null {
  const match = raw.match(/[\[{][\s\S]*/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** Simple file-based TTL cache. Returns null if cache is stale or missing. */
export function readCache(key: string, ttl: number): string | null {
  const cacheDir = join(tmpdir(), "ix-openclaw-cache");
  const file = join(cacheDir, key);
  try {
    const stat = statSync(file);
    if (Date.now() - stat.mtimeMs < ttl) {
      return readFileSync(file, "utf-8");
    }
  } catch {
    // cache miss
  }
  return null;
}

/** Write to the file-based TTL cache. */
export function writeCache(key: string, value: string): void {
  const cacheDir = join(tmpdir(), "ix-openclaw-cache");
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, key), value);
  } catch {
    // non-critical
  }
}

/** Fingerprint for deduplication. */
function fingerprint(type: string, component: string, message: string): string {
  const norm = `${type}|${component}|${message}`
    .toLowerCase()
    .replace(/\d+/g, "N")
    .replace(/\/[^\/ ]*/g, "")
    .slice(0, 120);
  return createHash("md5").update(norm).digest("hex");
}

/** Redact common secret patterns from a string. */
function redact(s: string): string {
  return s
    .replace(/[Bb]earer [A-Za-z0-9._~+/=-]{20,}/g, "Bearer [REDACTED]")
    .replace(/ghp_[A-Za-z0-9]{36,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9-]{32,}/g, "[REDACTED]")
    .replace(/[Aa][Pp][Ii][-_][Kk]ey=[^ &"']*/g, "API_KEY=[REDACTED]")
    .replace(/[Tt]oken=[^ &"']*/g, "TOKEN=[REDACTED]")
    .replace(new RegExp(homedir(), "g"), "~");
}

/** Returns true if the message/stderr indicates a missing Pro feature (not an error). */
function isProFeatureMessage(message: string, stderr?: string): boolean {
  const combined = `${message} ${stderr ?? ""}`;
  return /requires Ix Pro|Install @ix\/pro|is a Ix\/pro feature|premium features/i.test(combined);
}

/** Capture and report an error asynchronously. Fire-and-forget. */
export function captureErrorAsync(
  type: string,
  component: string,
  message: string,
  exitCode: number,
  command?: string,
  stderr?: string,
): void {
  // Skip expected Pro feature messages — these are not errors
  if (isProFeatureMessage(message, stderr)) return;

  // Fire in background — never block the hook
  void (async () => {
    try {
      const cleanMsg = redact(message).slice(0, 150);
      const cleanStderr = stderr ? redact(stderr.split("\n").slice(0, 5).join("\n")).slice(0, 300) : "";
      const cleanCmd = command ? redact(command) : "";
      const fp = fingerprint(type, component, cleanMsg);

      mkdirSync(join(ERROR_STORE, "unsent"), { recursive: true });

      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        fp,
        type,
        component,
        message: cleanMsg,
        command: cleanCmd,
        exit_code: exitCode,
        stderr: cleanStderr,
      });
      const logFile = join(ERROR_STORE, "errors.jsonl");
      writeFileSync(logFile, entry + "\n", { flag: "a" });
    } catch {
      // Never let error reporting crash the hook
    }
  })();
}

export { BRIEFING_TTL, READ_CACHE_TTL };
