import { execFile, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ToolContext {
  directory: string;
  worktree?: string;
}

interface RunIxOptions {
  cwd: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function toolDirectory(context: ToolContext): string {
  return context.worktree ?? context.directory;
}

export function runIx(args: string[], options: RunIxOptions): Promise<string> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    execFile("ix", args, { cwd: options.cwd, timeout }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;
        reject(new Error(detail));
        return;
      }

      resolve(stdout);
    });
  });
}

export function runIxDetached(args: string[], cwd?: string): void {
  const child = spawn("ix", args, {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export async function runIxJson<T>(
  args: string[],
  options: RunIxOptions
): Promise<T> {
  const raw = await runIx(args, options);
  return parseIxJson<T>(raw);
}

export function parseIxJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const direct = tryParseJson<T>(trimmed);
  if (direct !== null) return direct;

  const match = trimmed.match(/[\[{][\s\S]*$/);
  if (match) {
    const parsed = tryParseJson<T>(match[0]);
    if (parsed !== null) return parsed;
  }

  throw new Error("Failed to parse ix JSON output");
}

export function previewMarkdown(result: Record<string, unknown> | null): string | null {
  return typeof result?.preview_markdown === "string" ? result.preview_markdown : null;
}

export function ixUnavailableMessage(title: string, body?: string, error?: string): string {
  const lines = [`## ${title}`, ""];

  if (body) {
    lines.push(body, "");
  } else {
    lines.push("**ix unavailable.** The Ix graph service is not running or not installed.", "");
  }

  lines.push(
    "To use Ix tools, ensure the ix CLI is installed and the graph is running:",
    "```",
    "command -v ix",
    "ix status",
    "ix map",
    "```"
  );

  if (error) {
    lines.push("", `Error: ${error}`);
  }

  return lines.join("\n");
}

// ── Ix Backend HTTP Client (port 8090) ───────────────────────────────────────

const IX_HTTP_TIMEOUT_MS = 15_000;

function getIxBackendEndpoint(): string {
  if (process.env.IX_ENDPOINT) return process.env.IX_ENDPOINT;
  try {
    const configPath = join(homedir(), ".ix", "config.yaml");
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const match = raw.match(/^endpoint:\s*(\S+)/m);
      if (match?.[1]) return match[1];
    }
  } catch {
    // Fall through to default.
  }
  return "http://localhost:8090";
}

export async function ixHttpGet<T>(path: string, timeoutMs = IX_HTTP_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getIxBackendEndpoint()}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

export async function ixHttpPost<T>(path: string, body: unknown, timeoutMs = IX_HTTP_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getIxBackendEndpoint()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
