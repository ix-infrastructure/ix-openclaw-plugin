// Copyright 2026 Ix Infrastructure Inc.

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
import { runIx, type ToolContext } from "../tools/base.ts";
import { requestGuardedMap } from "../runtime/auto-map.ts";

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
const SKIP_EXT = /\.(md|txt|lock|png|jpg|jpeg|gif|ico|pdf|bin)$/i;
const SKIP_COMPILED = /(__pycache__|\.pyc|\.class|\.o)$/;
const BRIEFING_TTL_MS = 10 * 60 * 1000;
// Safety cap: an entry is removed by after_tool_call, but a call that never
// completes (denied approval, host crash) would otherwise stay forever.
const PENDING_WRITE_PATHS_MAX = 256;

const pendingWritePaths = new Map<string, string>();
let briefingCache:
  | {
      workspaceDir: string;
      fetchedAt: number;
      text: string | null;
    }
  | undefined;

// Annotate the export explicitly: definePluginEntry's inferred return type
// references an internal openclaw plugin-sdk chunk that isn't portable for
// declaration emit (TS2742). ReturnType<typeof definePluginEntry> names it
// via the imported symbol, which is portable.
const ixMemoryPlugin: ReturnType<typeof definePluginEntry> = definePluginEntry({
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
    api.on(
      "after_tool_call",
      (event: any, ctx: any) => handleAfterToolCall(event, resolveAgentWorkspaceDir(api, ctx?.agentId)),
      { priority: 50 }
    );
    api.on(
      "session_end",
      (_event: any, ctx: any) => handleSessionEnd(resolveAgentWorkspaceDir(api, ctx?.agentId)),
      { priority: 50 }
    );
  },
});

export default ixMemoryPlugin;

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

  if (!WRITE_TOOLS.has(toolName)) return;

  const targetPath = extractTargetPath(event);
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

  rememberWritePath(event?.toolCallId, targetPath);

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

function rememberWritePath(toolCallId: unknown, targetPath: string): void {
  if (toolCallId === undefined || toolCallId === null || toolCallId === "") return;
  pendingWritePaths.set(String(toolCallId), targetPath);
  while (pendingWritePaths.size > PENDING_WRITE_PATHS_MAX) {
    const oldest = pendingWritePaths.keys().next().value;
    if (oldest === undefined) break;
    pendingWritePaths.delete(oldest);
  }
}

function takeWritePath(toolCallId: unknown): string | undefined {
  if (toolCallId === undefined || toolCallId === null || toolCallId === "") return undefined;
  const key = String(toolCallId);
  const value = pendingWritePaths.get(key);
  pendingWritePaths.delete(key);
  return value;
}

/**
 * After a successful write, ask for the guarded root map — never `ix map
 * <file>`, which Ix rejects ("Map path is not a directory"). The project dir is
 * the edited file's directory (a relative path is resolved against the agent
 * workspace); requestGuardedMap turns it into the git root and applies every
 * other guard. Fire-and-forget: nothing here may hold up the tool result.
 */
function handleAfterToolCall(event: any, workspaceDir?: string) {
  const toolName = event?.toolName;
  if (!WRITE_TOOLS.has(toolName)) return;
  const remembered = takeWritePath(event?.toolCallId);
  if (event?.error) return;

  const targetPath = extractTargetPath(event) ?? remembered;
  if (!targetPath || shouldSkipPath(targetPath)) return;

  const projectDir = projectDirForTargetPath(targetPath, workspaceDir);
  if (!projectDir) return;
  void requestGuardedMap(projectDir);
}

/**
 * At session end, request the guarded map for the agent's workspace. The event
 * only carries the transcript path (`<state>/agents/<id>/sessions/...`), which
 * is OpenClaw state, not the project, so it is deliberately not used.
 */
function handleSessionEnd(workspaceDir?: string) {
  if (!workspaceDir) return;
  void requestGuardedMap(workspaceDir);
}

/**
 * The agent's workspace directory, via the SDK's
 * `runtime.agent.resolveAgentWorkspaceDir(config, agentId)`. Undefined when the
 * host does not expose it or no agent id is known.
 */
function resolveAgentWorkspaceDir(api: any, agentId: unknown): string | undefined {
  if (typeof agentId !== "string" || !agentId.trim()) return undefined;
  try {
    const resolve = api?.runtime?.agent?.resolveAgentWorkspaceDir;
    if (typeof resolve !== "function") return undefined;
    const config = api?.runtime?.config?.current?.() ?? api?.config;
    if (!config) return undefined;
    const dir = resolve(config, agentId);
    return typeof dir === "string" && dir.trim() ? dir : undefined;
  } catch {
    return undefined;
  }
}

function projectDirForTargetPath(targetPath: string, workspaceDir?: string): string | undefined {
  if (isAbsolute(targetPath)) return dirname(targetPath);
  if (!workspaceDir) return undefined;
  return dirname(resolvePath(workspaceDir, targetPath));
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
