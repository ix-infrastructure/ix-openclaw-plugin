// Copyright 2026 Ix Infrastructure Inc.

import { execFile } from "node:child_process";

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

/**
 * An `ix` failure that still produced output on stdout.
 *
 * Several `ix` commands exit 1 to mean "you asked for something that does not
 * exist" while printing a useful JSON body, so the exit code alone is not
 * enough to decide the output is worthless. Carrying stdout on the error keeps
 * `runIx` rejecting exactly as before -- every existing caller is unaffected --
 * while letting a caller that knows better recover the body.
 */
export class IxCommandError extends Error {
  readonly stdout: string;

  constructor(message: string, stdout: string) {
    super(message);
    this.name = "IxCommandError";
    this.stdout = stdout;
  }
}

export function runIx(args: string[], options: RunIxOptions): Promise<string> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    execFile("ix", args, { cwd: options.cwd, timeout }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;
        reject(new IxCommandError(detail, stdout));
        return;
      }

      resolve(stdout);
    });
  });
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

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
