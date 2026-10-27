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
  /**
   * execFile's `error.code`: the exit status when ix ran and exited non-zero,
   * a string such as "ENOENT" when it could not be spawned, and undefined when
   * it was killed (a timeout).
   */
  readonly exitCode?: number | string;

  constructor(message: string, stdout: string, exitCode?: number | string) {
    super(message);
    this.name = "IxCommandError";
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}

export function runIx(args: string[], options: RunIxOptions): Promise<string> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    execFile("ix", args, { cwd: options.cwd, timeout }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim() || error.message;
        const code = (error as { code?: unknown }).code;
        const exitCode = typeof code === "number" || typeof code === "string" ? code : undefined;
        reject(new IxCommandError(detail, stdout, exitCode));
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

/** ix colours its stderr even when piped; error text quoted to the model should not carry the escapes. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
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

/** One entity ix offered: a candidate for an ambiguous target, or a suggestion. */
export interface LookupEntity {
  name: string;
  kind?: string;
  path?: string;
  line?: number;
  pick?: number;
}

/**
 * What a graph lookup answered when it did not return results. Since Ix#853
 * these exit 2 (ambiguous), 3 (not found) and 4 (not mapped); an older ix
 * exits 1 with the same record. Either way ix answered, and the answer is what
 * the agent needs to retry.
 */
export type LookupOutcome =
  | { kind: "ambiguous"; message?: string; candidates: LookupEntity[] }
  | { kind: "not_found"; message?: string; reason?: string; suggestions: LookupEntity[] }
  | { kind: "not_mapped"; message?: string };

const LOOKUP_EXIT_CODES = new Set([1, 2, 3, 4]);

/**
 * The lookup answer a failed graph lookup carried, or null when it is a real
 * failure: ix missing, killed by the timeout, any other exit, or stdout that is
 * not one of the three records. Only graph lookups should ask; `status`,
 * `briefing` and `map` keep treating any non-zero exit as no answer.
 */
export function lookupOutcome(error: unknown): LookupOutcome | null {
  if (!(error instanceof IxCommandError)) return null;
  if (typeof error.exitCode !== "number" || !LOOKUP_EXIT_CODES.has(error.exitCode)) return null;
  return lookupRecord(error.stdout);
}

/**
 * The lookup answer in an ix JSON body, or null. The slug is `error`, or
 * `code` for `locate`'s ambiguous record (which has no `error` key).
 */
export function lookupRecord(stdout: string | null | undefined): LookupOutcome | null {
  if (!stdout || !stdout.trim()) return null;
  let body: unknown;
  try {
    body = parseIxJson<unknown>(stdout);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const slug = typeof record.error === "string" ? record.error : typeof record.code === "string" ? record.code : null;
  const message = typeof record.message === "string" && record.message.trim() ? stripAnsi(record.message).trim() : undefined;

  switch (slug) {
    case "ambiguous_target":
      return { kind: "ambiguous", message, candidates: lookupEntities(record.candidates) };
    case "unresolved_target":
      return {
        kind: "not_found",
        message,
        reason: typeof record.reason === "string" ? record.reason : undefined,
        suggestions: lookupEntities(record.suggestions),
      };
    case "workspace_not_mapped":
      return { kind: "not_mapped", message };
    default:
      return null;
  }
}

function lookupEntities(value: unknown): LookupEntity[] {
  if (!Array.isArray(value)) return [];
  const entities: LookupEntity[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      entities.push({ name: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = firstString(row.name, row.qualifiedName, row.id);
    if (!name) continue;
    entities.push({
      name,
      kind: firstString(row.kind),
      path: firstString(row.path, row.file, row.filePath),
      line: firstNumber(row.line, row.lineStart, row.line_start, row.startLine),
      pick: firstNumber(row.pick),
    });
  }
  return entities;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

const MAX_CANDIDATES = 10;
const MAX_SUGGESTIONS = 5;

/** `name` (kind) — path:line, the way every lookup line shows an entity. */
export function formatLookupEntity(entity: LookupEntity): string {
  const where = entity.path ? `${entity.path}${typeof entity.line === "number" ? `:${entity.line}` : ""}` : "";
  return `\`${entity.name}\`${entity.kind ? ` (${entity.kind})` : ""}${where ? ` — ${where}` : ""}`;
}

/** The body lines for a lookup answer, without a header. */
export function lookupOutcomeLines(outcome: LookupOutcome): string[] {
  const lines: string[] = [];
  if (outcome.kind === "ambiguous") {
    const count = outcome.candidates.length;
    lines.push(`**Ambiguous target.** Ix matched ${count > 0 ? `${count} entities` : "more than one entity"}${count > 0 ? ":" : "."}`);
    outcome.candidates.slice(0, MAX_CANDIDATES).forEach((candidate, index) => {
      lines.push(`- \`--pick ${candidate.pick ?? index + 1}\` ${formatLookupEntity(candidate)}`);
    });
    if (count > MAX_CANDIDATES) lines.push(`- … ${count - MAX_CANDIDATES} more`);
    lines.push("", "Retry with `--pick <n>` to choose one, or narrow with `--path <dir>`.");
  } else if (outcome.kind === "not_found") {
    lines.push(`**Not found in the graph.**${outcome.message ? ` ${outcome.message}` : ""}`);
    if (outcome.suggestions.length > 0) {
      lines.push("", "Did you mean:");
      for (const suggestion of outcome.suggestions.slice(0, MAX_SUGGESTIONS)) {
        lines.push(`- ${formatLookupEntity(suggestion)}`);
      }
    } else {
      lines.push("", "Check the exact name with ix-query, or run `ix map` if the code is new.");
    }
  } else {
    lines.push(
      "**Workspace not indexed.** No Ix map covers this directory yet.",
      "",
      "Run `ix map` from the project root, then retry."
    );
  }
  return lines;
}

/** A tool's whole answer for a lookup outcome: its header, then what ix said. */
export function formatLookupOutcome(title: string, outcome: LookupOutcome): string {
  return [`## ${title}`, "", ...lookupOutcomeLines(outcome)].join("\n");
}

/**
 * A graph lookup's catch: what ix said when it answered with exit 2/3/4 (or a
 * lookup record on exit 1), else the tool's "ix unavailable" message.
 */
export function lookupFailureMessage(title: string, error: unknown, unavailableBody?: string): string {
  const outcome = lookupOutcome(error);
  if (outcome) return formatLookupOutcome(title, outcome);
  return ixUnavailableMessage(title, unavailableBody, error instanceof Error ? error.message : String(error));
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
