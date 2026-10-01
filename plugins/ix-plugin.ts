// Copyright 2026 Ix Infrastructure Inc.

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
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
import { isWriteTool, WRITE_TOOL_NAMES, writeToolPaths } from "../runtime/host-tools.ts";

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

const SKIP_EXT = /\.(md|txt|lock|png|jpg|jpeg|gif|ico|pdf|bin)$/i;
const SKIP_COMPILED = /(__pycache__|\.pyc|\.class|\.o)$/;
const BRIEFING_TTL_MS = 10 * 60 * 1000;
// Safety cap: an entry is removed by after_tool_call, but a call that never
// completes (denied approval, host crash) would otherwise stay forever.
const PENDING_WRITE_PATHS_MAX = 256;

const pendingWritePaths = new Map<string, string[]>();
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
  register(api: OpenClawPluginApi) {
    for (const toolModule of IX_TOOLS) {
      registerTool(api, toolModule);
    }

    api.on("before_prompt_build", handleBeforePromptBuild, { priority: 50 });
    // `matcher` takes canonical OpenClaw tool ids and makes the host skip this
    // handler for every other tool (hook-runner-global-ac8FBwry.js:32-56); the
    // handlers still check, for hosts that predate the option.
    api.on(
      "before_tool_call",
      (event, ctx) => handleBeforeToolCall(event, resolveAgentWorkspaceDir(api, ctx?.agentId)),
      { priority: 50, matcher: WRITE_TOOL_NAMES }
    );
    api.on(
      "after_tool_call",
      (event, ctx) => handleAfterToolCall(event, resolveAgentWorkspaceDir(api, ctx?.agentId)),
      { priority: 50, matcher: WRITE_TOOL_NAMES }
    );
    api.on(
      "session_end",
      (_event, ctx) => handleSessionEnd(resolveAgentWorkspaceDir(api, ctx?.agentId)),
      { priority: 50 }
    );
  },
});

export default ixMemoryPlugin;

/**
 * Register one Ix tool the way OpenClaw loads it.
 *
 * The host keeps a plugin tool only if it has a `name`, an `execute` function
 * and a `parameters` object (describeMalformedPluginTool,
 * tools-mqHZh-rd.js:418-424); anything else is dropped with "plugin tool is
 * malformed" (:949-960). `execute` is called as
 * `(toolCallId, params, signal, onUpdate)` and returns an AgentToolResult,
 * `{ content: [{ type: "text", text }], details }`
 * (common-D6XCiVSU.d.ts:26-29, types-CTwueIyM.d.ts:114-147). The agent
 * workspace reaches a tool only through a factory's OpenClawPluginToolContext
 * (agent-harness-runtime-DMcVlRu_.d.ts:1876-1934), so each tool is a factory,
 * named up front so the host can match it to `contracts.tools`
 * (loader-DhyKX__3.js:3781-3800).
 */
function registerTool(api: OpenClawPluginApi, toolModule: ToolModule): void {
  api.registerTool((ctx) => createAgentTool(toolModule, ctx), { name: toolModule.name });
}

function createAgentTool(toolModule: ToolModule, ctx: OpenClawPluginToolContext): AnyAgentTool {
  const directory = normalizeWorkspaceDir(ctx?.workspaceDir) ?? process.cwd();
  return {
    name: toolModule.name,
    label: toolModule.name,
    description: toolModule.description,
    // Plain JSON Schema; the host only requires an object (see above).
    parameters: toolModule.parameters as unknown as AnyAgentTool["parameters"],
    async execute(_toolCallId, params) {
      const text = await toolModule.execute(params ?? {}, { directory });
      return { content: [{ type: "text", text }], details: {} };
    },
  };
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

/** The part of a before/after_tool_call event these handlers read. */
type WriteToolEvent = {
  toolName: string;
  params: Record<string, unknown>;
  toolCallId?: string;
  derivedPaths?: readonly string[];
  error?: string;
};

/**
 * The pre-edit gate: ask ix-decide about the files an `edit`, `write` or
 * `apply_patch` call is about to touch. BLOCK blocks the call, REVIEW asks the
 * user, ALLOW is silent (PluginHookBeforeToolCallResult,
 * hook-runner-global-y5_IazVW.d.ts:123-145). Relative paths are resolved
 * against the agent workspace, where the host resolves them too.
 */
async function handleBeforeToolCall(event: WriteToolEvent, workspaceDir?: string) {
  const toolName = event?.toolName;
  if (!isWriteTool(toolName)) return;

  const targetPaths = resolveWritePaths(event, workspaceDir);
  if (targetPaths.length === 0) return;

  const verdict = await ixDecide.execute(
    {
      touched_paths: targetPaths,
      intent: toolName === "write" ? "add" : "edit",
    },
    { directory: dirname(targetPaths[0]) }
  );

  const decision = parseDecisionVerdict(verdict);
  if (decision === "BLOCK") {
    return {
      block: true,
      blockReason: compactHookText(verdict),
    };
  }

  rememberWritePaths(event?.toolCallId, targetPaths);

  if (decision === "REVIEW") {
    const subject =
      targetPaths.length === 1 ? displayName(targetPaths[0]) : `${targetPaths.length} files`;
    return {
      requireApproval: {
        title: `Ix review required for ${subject}`,
        description: compactHookText(verdict),
        severity: "warning" as const,
        timeoutMs: 120000,
        allowedDecisions: ["allow-once" as const, "deny" as const],
      },
    };
  }
}

/**
 * Absolute, non-skipped paths a write-tool call touches. Relative paths need
 * the agent workspace; without it they are dropped rather than guessed.
 */
function resolveWritePaths(event: WriteToolEvent, workspaceDir?: string): string[] {
  const resolved = new Set<string>();
  for (const raw of writeToolPaths(event?.toolName, event?.params, event?.derivedPaths)) {
    const absolute = isAbsolute(raw)
      ? raw
      : workspaceDir
        ? resolvePath(workspaceDir, raw)
        : undefined;
    if (absolute && !shouldSkipPath(absolute)) resolved.add(absolute);
  }
  return [...resolved];
}

function rememberWritePaths(toolCallId: unknown, targetPaths: string[]): void {
  if (toolCallId === undefined || toolCallId === null || toolCallId === "") return;
  pendingWritePaths.set(String(toolCallId), targetPaths);
  while (pendingWritePaths.size > PENDING_WRITE_PATHS_MAX) {
    const oldest = pendingWritePaths.keys().next().value;
    if (oldest === undefined) break;
    pendingWritePaths.delete(oldest);
  }
}

function takeWritePaths(toolCallId: unknown): string[] {
  if (toolCallId === undefined || toolCallId === null || toolCallId === "") return [];
  const key = String(toolCallId);
  const value = pendingWritePaths.get(key);
  pendingWritePaths.delete(key);
  return value ?? [];
}

/**
 * After a successful write, ask for the guarded root map — never `ix map
 * <file>`, which Ix rejects ("Map path is not a directory"). The project dir is
 * each written file's directory (a relative path is resolved against the agent
 * workspace); requestGuardedMap turns it into the git root and applies every
 * other guard, including the per-root debounce. Fire-and-forget: nothing here
 * may hold up the tool result.
 */
function handleAfterToolCall(event: WriteToolEvent, workspaceDir?: string) {
  if (!isWriteTool(event?.toolName)) return;
  const remembered = takeWritePaths(event?.toolCallId);
  if (event?.error) return;

  const targetPaths = resolveWritePaths(event, workspaceDir);
  const projectDirs = new Set(
    (targetPaths.length > 0 ? targetPaths : remembered).map((targetPath) => dirname(targetPath))
  );
  for (const projectDir of projectDirs) {
    void requestGuardedMap(projectDir);
  }
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
function resolveAgentWorkspaceDir(api: OpenClawPluginApi, agentId: unknown): string | undefined {
  if (typeof agentId !== "string" || !agentId.trim()) return undefined;
  try {
    const resolve = api?.runtime?.agent?.resolveAgentWorkspaceDir;
    if (typeof resolve !== "function") return undefined;
    // current() is typed DeepReadonly<OpenClawConfig>; the resolver only reads it.
    const config = (api?.runtime?.config?.current?.() ?? api?.config) as OpenClawPluginApi["config"];
    if (!config) return undefined;
    const dir = resolve(config, agentId);
    return typeof dir === "string" && dir.trim() ? dir : undefined;
  } catch {
    return undefined;
  }
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
