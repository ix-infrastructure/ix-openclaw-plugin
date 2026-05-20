import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { dirname, resolve as resolvePath, isAbsolute } from "node:path";

import * as ixDocsTool from "../tools/ix-docs-tool.ts";
import * as ixDecide from "../tools/ix-decide.ts";
import * as ixExplain from "../tools/ix-explain.ts";
import * as ixHealth from "../tools/ix-health.ts";
import * as ixHistory from "../tools/ix-history.ts";
import * as ixImpact from "../tools/ix-impact.ts";
import * as ixIngest from "../tools/ix-ingest.ts";
import * as ixInventory from "../tools/ix-inventory.ts";
import * as ixLocate from "../tools/ix-locate.ts";
import * as ixMap from "../tools/ix-map.ts";
import * as ixNeighbors from "../tools/ix-neighbors.ts";
import * as ixQuery from "../tools/ix-query.ts";
import * as ixRank from "../tools/ix-rank.ts";
import * as ixSmells from "../tools/ix-smells.ts";
import * as ixStats from "../tools/ix-stats.ts";
import * as ixSubsystems from "../tools/ix-subsystems.ts";
import * as ixTrace from "../tools/ix-trace.ts";
import { runIx, runIxDetached, type ToolContext } from "../tools/base.ts";

type ToolModule = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: any, context: ToolContext) => Promise<string>;
};

const IX_TOOLS: ToolModule[] = [
  ixQuery,
  ixNeighbors,
  ixImpact,
  ixMap,
  ixIngest,
  ixHistory,
  ixDocsTool,
  ixLocate,
  ixExplain,
  ixRank,
  ixStats,
  ixSubsystems,
  ixInventory,
  ixTrace,
  ixDecide,
  ixHealth,
  ixSmells,
];

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "Read", "Bash"]);
const SKIP_EXT = /\.(md|txt|lock|png|jpg|jpeg|gif|ico|pdf|bin)$/i;
const SKIP_COMPILED = /(__pycache__|\.pyc|\.class|\.o)$/;
const BRIEFING_TTL_MS = 10 * 60 * 1000;

const pendingWritePaths = new Map<string, string>();
let briefingCache:
  | {
      workspaceDir: string;
      fetchedAt: number;
      text: string | null;
    }
  | undefined;

export default definePluginEntry({
  id: "ix-memory",
  name: "Ix Memory",
  description:
    "Ix Memory integration — transforms your agent into a graph-reasoning engineer with cognitive skills for understanding, investigation, impact analysis, planning, debugging, architecture auditing, and deep documentation synthesis.",
  register(api: any) {
    for (const toolModule of IX_TOOLS) {
      registerTool(api, toolModule);
    }

    api.on("before_prompt_build", handleBeforePromptBuild, { priority: 50 });
    api.on("before_tool_call", handleBeforeToolCall, { priority: 50 });
    api.on("after_tool_call", handleAfterToolCall, { priority: 50 });
    api.on("session_end", handleSessionEnd, { priority: 50 });
  },
});

function registerTool(api: any, toolModule: ToolModule): void {
  const definition = {
    name: toolModule.name,
    description: toolModule.description,
    inputSchema: toolModule.parameters,
    execute: async (args: any, context: any) =>
      toolModule.execute(args ?? {}, {
        directory: resolveDirectory(context),
        worktree: resolveWorktree(context),
      }),
  };

  try {
    api.registerTool(definition);
    return;
  } catch {
    // Fall through and try common alternative SDK shapes.
  }

  try {
    api.registerTool(toolModule.name, definition);
    return;
  } catch {
    // Fall through.
  }

  api.registerTool(
    toolModule.name,
    toolModule.description,
    toolModule.parameters,
    definition.execute
  );
}

function resolveDirectory(context: any): string {
  return (
    context?.directory ??
    context?.cwd ??
    context?.workspaceDir ??
    context?.projectRoot ??
    context?.context?.directory ??
    process.cwd()
  );
}

function resolveWorktree(context: any): string | undefined {
  return context?.worktree ?? context?.repositoryRoot ?? context?.context?.worktree;
}

async function handleBeforePromptBuild(_event: any, ctx: any) {
  const workspaceDir = normalizeWorkspaceDir(ctx?.workspaceDir);
  if (!workspaceDir) return;

  const briefing = await getBriefing(workspaceDir);
  if (!briefing) return;

  return {
    prependContext: `[ix] Session briefing:\n${briefing}`,
  };
}

async function handleBeforeToolCall(event: any) {
  const toolName = event?.toolName;
  if (typeof toolName !== "string") return;

  const targetPath = extractTargetPath(event);
  if (targetPath && event?.toolCallId) {
    pendingWritePaths.set(String(event.toolCallId), targetPath);
  }

  if (!WRITE_TOOLS.has(toolName)) {
    if (SEARCH_TOOLS.has(toolName) && targetPath && event?.toolCallId) {
      pendingWritePaths.set(String(event.toolCallId), targetPath);
    }
    return;
  }

  if (!targetPath || shouldSkipPath(targetPath)) return;

  const directory = directoryForTargetPath(targetPath);
  const verdict = await ixDecide.execute(
    {
      touched_paths: [targetPath],
      intent: toolName === "Write" ? "add" : "edit",
    },
    { directory }
  );

  const decision = parseDecisionVerdict(verdict);
  if (decision === "BLOCK") {
    return {
      block: true,
      blockReason: compactHookText(verdict),
    };
  }

  if (decision === "REVIEW") {
    return {
      requireApproval: {
        title: `Ix review required for ${displayName(targetPath)}`,
        description: compactHookText(verdict),
        severity: "warning",
        timeoutMs: 120000,
        timeoutBehavior: "deny",
        allowedDecisions: ["allow-once", "deny"],
      },
    };
  }
}

function handleAfterToolCall(event: any) {
  const toolName = event?.toolName;
  if (!WRITE_TOOLS.has(toolName)) return;
  if (event?.error) return;

  const targetPath = extractTargetPath(event) ?? pendingWritePaths.get(String(event?.toolCallId ?? ""));
  if (!targetPath || shouldSkipPath(targetPath)) return;

  runIxDetached(["map", targetPath], directoryForTargetPath(targetPath));
}

function handleSessionEnd(event: any) {
  const sessionFile = typeof event?.sessionFile === "string" ? event.sessionFile : undefined;
  if (!sessionFile) return;
  runIxDetached(["map"], dirname(sessionFile));
}

async function getBriefing(workspaceDir: string): Promise<string | null> {
  const now = Date.now();
  if (
    briefingCache &&
    briefingCache.workspaceDir === workspaceDir &&
    now - briefingCache.fetchedAt < BRIEFING_TTL_MS
  ) {
    return briefingCache.text;
  }

  try {
    const briefing = await runIx(["briefing", "--format", "json"], {
      cwd: workspaceDir,
      timeoutMs: 8000,
    });
    const text = briefing.trim();
    briefingCache = {
      workspaceDir,
      fetchedAt: now,
      text: text || null,
    };
    return text || null;
  } catch {
    briefingCache = {
      workspaceDir,
      fetchedAt: now,
      text: null,
    };
    return null;
  }
}

function normalizeWorkspaceDir(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extractTargetPath(event: any): string | undefined {
  const derived = Array.isArray(event?.derivedPaths)
    ? event.derivedPaths.find((value: unknown) => typeof value === "string" && value.trim())
    : undefined;
  if (typeof derived === "string") return derived;

  const params = event?.params ?? {};
  const directCandidates = [
    params.file_path,
    params.path,
    params.target,
    params.cwd,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }

  return undefined;
}

function directoryForTargetPath(targetPath: string): string {
  const absolute = isAbsolute(targetPath) ? targetPath : resolvePath(targetPath);
  return dirname(absolute);
}

function shouldSkipPath(targetPath: string): boolean {
  return SKIP_EXT.test(targetPath) || SKIP_COMPILED.test(targetPath);
}

function parseDecisionVerdict(text: string): "ALLOW" | "REVIEW" | "BLOCK" | null {
  const match = text.match(/\*\*Verdict:\*\*\s*(ALLOW|REVIEW|BLOCK)/i);
  if (!match) return null;
  return match[1].toUpperCase() as "ALLOW" | "REVIEW" | "BLOCK";
}

function compactHookText(text: string): string {
  return text
    .replace(/^## .*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function displayName(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || targetPath;
}
