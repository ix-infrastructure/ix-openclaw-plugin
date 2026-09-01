# OpenClaw Platform Survey

**Date:** 2026-05-19  
**Method:** Documentation survey — https://docs.openclaw.ai/, https://github.com/openclaw/openclaw  
**Status:** Complete — all 8 open questions from PLUGIN_SPEC.md section 17 answered.

---

## Platform Identity

| Field | Value |
|---|---|
| GitHub | https://github.com/openclaw/openclaw |
| Website | https://openclaw.ai/ |
| Docs | https://docs.openclaw.ai/ |
| Marketplace | ClawHub — https://documentation.openclaw.ai/clawhub |
| License | Public, open-source |
| Install method | `openclaw plugins install git:ix-infrastructure/ix-openclaw-plugin` |

---

## Question 1: Runtime

**Answer: TypeScript / Node 24**

- Node 24 recommended; Node 22.19+ minimum
- TypeScript ESM modules mandatory
- No Bun dependency (unlike OpenCode)
- Plugin SDK: `openclaw/plugin-sdk` (npm package)
- Entry point: `definePluginEntry()` from `openclaw/plugin-sdk/plugin-entry`

---

## Question 2: Plugin Manifest Schema

**Answer: `openclaw.plugin.json`**

Required fields:
```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "contracts": {
    "tools": ["tool-name-1", "tool-name-2"]
  },
  "configSchema": {},
  "activation": {
    "onStartup": true
  }
}
```

The current `openclaw.plugin.json` in this repo uses a slightly different schema shape (it omits `contracts.tools` and uses top-level `skills`/`hooks` directory pointers). It will need updating when tools are registered via the SDK.

---

## Question 3: Hook Events

**Answer: Full hook system via `api.on("event_name", handler)` inside `definePluginEntry`**

### Registration pattern

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "ix-memory",
  register(api) {
    api.on("before_tool_call", async (event) => {
      // event.toolName, event.params, event.derivedPaths
      return { block: false };
    }, { priority: 50 });
  },
});
```

### Confirmed hook event names

**Agent turn:**
- `before_model_resolve` — override provider/model
- `agent_turn_prepare` — inject context before prompts
- `before_prompt_build` — add dynamic system-prompt text
- `before_agent_start` — combined phase (deprecated)
- `before_agent_run` — inspect final prompt; block execution
- `before_agent_reply` — short-circuit with synthetic reply
- `before_agent_finalize` — inspect final answer
- `agent_end` — observe completion and duration

**Tool hooks:**
- `before_tool_call` — rewrite params, block, or require approval
- `after_tool_call` — observe results and duration
- `tool_result_persist` — rewrite assistant messages from tool results
- `before_message_write` — inspect or block message writes

**Message & delivery:**
- `message_received` — observe inbound content (note: NOT `message:received`)
- `message_sending` — rewrite content or cancel delivery
- `message_sent` — observe delivery success/failure

**Session:**
- `session_start` / `session_end` — track lifecycle with reason field
- `before_compaction` / `after_compaction`
- `before_reset`

**Subagents:**
- `subagent_spawning` / `subagent_delivery_target` / `subagent_spawned` / `subagent_ended`

**Lifecycle:**
- `gateway_start` / `gateway_stop`
- `cron_changed`
- `before_install`

### `before_tool_call` event shape

```typescript
{
  toolName: string;                  // NOT event.context.toolName
  params: Record<string, unknown>;   // NOT event.context.toolInput
  derivedPaths?: string[];
  runId?: string;
  toolCallId?: string;
  context: { agentId, sessionKey, sessionId, runId, pluginConfig, trace };
}
```

Return shape:
```typescript
{
  params?: Record<string, unknown>;   // rewritten params
  block?: boolean;
  blockReason?: string;
  requireApproval?: { title, description, severity, timeoutMs, ... };
}
```

### `message_received` event — for prompt injection

Use `before_prompt_build` or `agent_turn_prepare` to inject context into the agent prompt:

```typescript
api.on("before_prompt_build", async (event) => {
  return { prependContext: "[ix] Session briefing:\n..." };
});
```

### Hooks requiring `allowConversationAccess: true`

Raw conversation hooks (`before_model_resolve`, `before_agent_reply`, `llm_input`, `llm_output`, `before_agent_finalize`, `agent_end`, `before_agent_run`) require this config:

```json
{
  "plugins": {
    "entries": {
      "ix-memory": {
        "hooks": { "allowConversationAccess": true }
      }
    }
  }
}
```

---

## Question 4: MCP Support

**Answer: Confirmed — supported via MCP Registry**

OpenClaw has a built-in MCP Registry. MCP tools are available as a first-class integration path. However, the current ix-memory plugin uses the TypeScript tool registration path (`api.registerTool()`), not MCP, which is sufficient for all ix capabilities.

---

## Question 5: Instruction File

**Answer: `AGENTS.md` — confirmed**

The `AGENTS.md` file at the repo root is confirmed as the OpenClaw instruction file. The current `AGENTS.md` in this repo is correct and complete.

---

## Question 6: Skill / Command Loading

**Answer: `skills/<name>/SKILL.md` — confirmed**

- Skills are loaded from the directory declared in `"skills": ["skills"]` in the plugin manifest
- Each skill is a subdirectory with a `SKILL.md` file
- Frontmatter format: `name`, `description`, `metadata.openclaw.requires`
- `$ARGUMENTS` variable contains user input after the skill name
- Current `skills/` directory structure is confirmed correct

No change needed to the existing skill files.

---

## Question 7: Agent Delegation

**Answer: Confirmed — via subagent hooks**

OpenClaw supports multi-agent routing via `subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, and `subagent_ended` hook events. The agent playbook `.md` files in `agents/` are confirmation-pending for exact agent config format (may require a JSON config or may be loaded from the `agents/` directory pointer in the manifest). This is a minor open item — the content of the playbooks is correct regardless of format.

---

## Question 8: Marketplace

**Answer: ClawHub — confirmed**

ClawHub is OpenClaw's plugin marketplace, available at https://documentation.openclaw.ai/clawhub. Since v2026.3.22, bare `openclaw plugins install <package>` checks ClawHub before npm. Direct git install bypasses ClawHub.

---

## OpenCode Hypothesis Verdict

| Hypothesis | Result |
|---|---|
| Skills use SKILL.md format in subdirectories | **Confirmed** |
| Instruction file is AGENTS.md | **Confirmed** |
| Plugin manifest is `openclaw.json` | **Partially confirmed** — it's `openclaw.plugin.json` |
| Runtime is TypeScript/Bun | **Partially refuted** — TypeScript confirmed, Bun NOT required (Node 24) |
| Plugin wiring follows OpenCode's plugin.ts pattern | **Refuted** — OpenClaw has its own `openclaw/plugin-sdk` |
| Tools registered via OpenCode SDK | **Refuted** — `api.registerTool()` from `openclaw/plugin-sdk` |

**Selected pattern: Hybrid**
- Skill/agent content: follow `ix-claude-plugin` (SKILL.md format confirmed matching)
- Plugin wiring: use `openclaw/plugin-sdk` directly (`definePluginEntry`, `api.on`, `api.registerTool`)

---

## Current Implementation Issues

The following issues were discovered during this survey and must be addressed:

### 1. Hook handlers use wrong event shape

The existing `hooks/*/handler.ts` files were ported from the Claude plugin without adapting to the OpenClaw API. Key mismatches:

| Current (wrong) | Correct OpenClaw API |
|---|---|
| `event.context?.toolName` | `event.toolName` |
| `event.context?.toolInput?.file_path` | `event.params?.file_path` |
| `event.type !== "message" \|\| event.action !== "received"` | Register as `message_received` hook directly |
| `event.type !== "agent" && event.action !== "end"` | Register as `agent_end` hook directly |
| `event.messages.push(warning)` | Return `{ block: true, blockReason: "..." }` or use `before_prompt_build` |

### 2. No plugin entry point

No `plugins/ix-plugin.ts` exists with `definePluginEntry`. Hooks are currently loaded via `"hooks": ["hooks"]` in the manifest (directory-based loading), but the official SDK uses `api.on()` inside `definePluginEntry`. Whether directory-based loading is supported alongside the SDK needs verification.

### 3. No package.json or build system

The TypeScript hook files cannot be compiled without a `package.json` and either a tsconfig or Node's native TypeScript stripping. Node 24 supports native TypeScript (type stripping), so the `.ts` files may load directly — but the `openclaw/plugin-sdk` dependency still needs a `package.json`.

### 4. `message:received` → `message_received`

The `ix-briefing/HOOK.md` declares `"events": ["message:received"]` (colon syntax). The confirmed event name is `message_received` (underscore).

---

## Recommended Next Steps (from survey)

1. Create `package.json` with `openclaw/plugin-sdk` dependency ← **unblocked, do now**
2. Create `plugins/ix-plugin.ts` with `definePluginEntry` registering all hooks and tools ← **unblocked**
3. Fix hook event shapes in all `hooks/*/handler.ts` files ← **unblocked**
4. Fix `message:received` → `message_received` in `ix-briefing/HOOK.md` ← **trivial**
5. Add `ix-help` skill (router) — only skill missing from `skills/` ← **unblocked**
6. Implement tools (`tools/*.ts`) using `runtime/client.ts` ← **unblocked after runtime client is done**
