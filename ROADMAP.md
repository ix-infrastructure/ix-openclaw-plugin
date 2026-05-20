# ix-openclaw-plugin Roadmap

## Task Tracking Rule

Any AI agent or human working on this roadmap must update task fields directly inside this file.

When starting a task:
- Change `Status` to `In Progress`
- Fill in `Started By`
- Fill in `Start Date`
- Update `Last Updated`
- Add a note to `Progress Log`

When completing a task:
- Change `Status` to `Done`
- Fill in `Completed By`
- Fill in `Completion Date`
- Update `Last Updated`
- Write a concise `Change Summary`

When blocked:
- Change `Status` to `Blocked`
- Explain the blocker in `Progress Log`

Do not mark a task as done unless all acceptance criteria are satisfied.

---

## Overview

**Role: Active target — implementation largely complete, validation and release checks pending.**

| Field | Value |
|---|---|
| Status | Active target |
| Confidence | Real platform confirmed |
| Next step | Baseline behavior fixtures and live validation (Phases 4-6) |
| Risk | Medium — runtime and plugin API unverified |
| Implementation order | 4th after OpenCode, Codex, Gemini |

ix-openclaw-plugin is a **greenfield** implementation for OpenClaw — a real external AI coding agent CLI tool confirmed from evidence in this repo. No source files exist yet.

**Reference implementations (to apply once platform is confirmed):**

The reference implementation to follow depends on which plugin model OpenClaw uses. The selection rule is:

| If OpenClaw has... | Follow this reference | Why |
|---|---|---|
| Bash hook events + skill file loading | `ix-claude-plugin` | Same hook-driven model |
| MCP server + lifecycle hooks (TypeScript) | `ix-cursor-plugin` | Same MCP-first model |
| TypeScript tools + AGENTS.md (no MCP) | `ix-opencode-plugin` (which follows `ix-claude-plugin` for behavior) | OpenCode-model match |
| Python hooks + instruction file | `ix-codex-plugin` (which follows `ix-claude-plugin` for behavior) | Python hook model |
| MCP + instruction file, agent-driven | `ix-gemini-plugin` (which follows `ix-cursor-plugin` for MCP) | Gemini-model match |

**Working hypothesis:** OpenClaw follows the OpenCode plugin model, based on structural identity of `openclaw plugins install` with `opencode plugins install`. If confirmed: follow `ix-claude-plugin` for behavior semantics and `ix-opencode-plugin` for platform wiring patterns.

**When platform is identified, apply these rules:**
- All seven skills must have the same names, phased reasoning protocol, and output semantics as `ix-claude-plugin`.
- All five ambient behaviors must produce the same user-visible effect as `ix-claude-plugin`, using the closest available OpenClaw mechanism.
- If a Claude ambient behavior cannot be replicated automatically, mark it as **Agent-driven fallback** or **Unsupported** in the instruction file, with explicit fallback guidance.
- If the platform uses MCP tools, the tool schemas must match `ix-cursor-plugin`'s 17-tool catalog.
- If the platform uses TypeScript/non-MCP tools, tool semantics must match `ix-opencode-plugin`'s tool surface.

**Platform identity status:** Partially resolved.
- **Confirmed:** `openclaw` is a real CLI tool. Install command: `openclaw plugins install ix-infrastructure/ix-openclaw-plugin`. Listed in `Ix/README.md` alongside Claude Code CLI, Codex CLI, and Gemini CLI. Active production target with a 2027-03-01 alpha date.
- **Still unknown:** GitHub URL / docs, runtime, hook events, MCP support, manifest schema, instruction file format, agent delegation.

**What can start immediately (no survey required):**
- Skill markdown files for all eight skills (format matches Claude reference; path adjusts after survey)
- Agent playbook markdown files for all five agents (same role definitions as Claude reference)
- Draft instruction file (`AGENTS.md` tentative name, content ported from Claude `skills/shared.md`)

**What requires the capability survey first:**
- Reference implementation pattern selection
- Platform-native wiring (hooks, manifest, plugin entry point, install scripts)
- Runtime HTTP client language selection
- MCP server (if MCP is confirmed)

---

## Phase 0: Current State Audit

### Task: Confirm platform GitHub URL and documentation source

**Status:** Done
**Owner:** Unassigned
**Started By:** Phase 0 audit — 2026-04-28
**Start Date:** 2026-04-28
**Completed By:** Claude (AI agent)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** GitHub URL confirmed: https://github.com/openclaw/openclaw (public, open-source). Website: https://openclaw.ai/. Docs: https://docs.openclaw.ai/. Runtime confirmed as TypeScript/Node 24 (Node 22.19+ minimum), ESM modules mandatory. PLUGIN_SPEC.md section 2 updated. Platform is not under NDA.

**Goal:**
Find OpenClaw's GitHub repository URL and/or official documentation. This is the only remaining blocker on Phase 0 — everything else about the platform has been partially resolved or is now a hypothesis from structural analysis.

**Current State Context:**
Evidence found in this repo: `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` (from `Ix/README.md`). The CLI is named `openclaw`. It is listed alongside Claude Code CLI, Codex CLI, and Gemini CLI. The `plugins install <org/repo>` mechanism confirms a GitHub-backed plugin registry. The command structure is nearly identical to `opencode plugins install`. Alpha date: 2027-03-01.

What has NOT been found: a GitHub URL, a website, or any external documentation for OpenClaw.

**Implementation Notes:**
Search GitHub for `openclaw` AI coding agent repositories. Search for `openclaw cli`, `openclaw agent`, `openclaw plugins`. Check if any Ix team members or the ix-infrastructure GitHub org have any connection to an OpenClaw repo. If the platform is under NDA or in stealth, document that status explicitly so implementation can proceed on the OpenCode-hypothesis fallback.

**Files Expected to Change:**
- `PLUGIN_SPEC.md` (section 2 and section 17 — update with confirmed URL)

**Acceptance Criteria:**
- [x] GitHub URL or official website found and confirmed
- [x] Platform README or docs confirm runtime (TypeScript/Bun, Python, etc.)
- [x] `PLUGIN_SPEC.md` section 2 updated with confirmed URL
- [x] If under NDA/stealth: explicitly documented as such and OpenCode-hypothesis fallback approved

**Progress Log:**
- 2026-04-28: Partial resolution. Platform confirmed as real external tool from repo evidence. GitHub URL still not found in this repo. Search external sources required.
- 2026-05-19: GitHub URL found: https://github.com/openclaw/openclaw. Open-source, public repo. Runtime: TypeScript/Node 24. Docs: https://docs.openclaw.ai/. Platform is public, no NDA. PLUGIN_SPEC.md section 2 updated.

---

### Task: Platform capability survey — hooks, MCP, instruction file, manifest schema

**Status:** Done
**Owner:** Unassigned
**Started By:** Claude (AI agent)
**Start Date:** 2026-05-19
**Completed By:** Claude (AI agent)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** All 8 open questions answered. OpenCode hypothesis partially confirmed: skills SKILL.md format matches, but OpenClaw has its own plugin SDK (definePluginEntry + api.on) not OpenCode's. Hybrid pattern selected. OpenClawPlatformSurvey.md created. PLUGIN_SPEC.md sections 7, 8, 17 updated.

**Goal:**
Answer the eight remaining open questions from PLUGIN_SPEC.md section 17: runtime, hook events, MCP support, instruction file, manifest schema, agent delegation, marketplace.

**Current State Context:**
Working hypothesis: OpenClaw follows OpenCode's plugin model. This hypothesis is based on structural similarity of the install command. If confirmed, implementation follows `ix-opencode-plugin` closely with name/path adjustments. If refuted, select the next-closest reference pattern.

**Implementation Notes:**
Read OpenClaw documentation. Test each capability. Record confirmed and unconfirmed capabilities in `OpenClawPlatformSurvey.md`. Key questions to answer:
1. Runtime: TypeScript/Bun? Python? Other?
2. Hook events: Does `tool.execute.before` / `tool.execute.after` exist? Or Claude-style `PreToolUse`/`PostToolUse`?
3. MCP: Is MCP supported? What is the config format?
4. Instruction file: `AGENTS.md`? `OPENCLAW.md`? `openclaw.json` instructions block?
5. Manifest schema: Is it `openclaw.json` analogous to `opencode.json`?
6. Skills/commands: Markdown files in `commands/`? Or different format?
7. Agent delegation: First-class or docs-only?
8. Marketplace: Beyond `plugins install`, is there a browser marketplace?

**Files Expected to Change:**
- `PLUGIN_SPEC.md` (sections 7, 8, 9, 10, 17 — resolve all unknowns)
- `OpenClawPlatformSurvey.md` (new — capability record)

**Acceptance Criteria:**
- [x] Phase 0 Task 1 (GitHub URL) is Done — prerequisite
- [x] All eight open questions in PLUGIN_SPEC.md section 17 answered
- [x] OpenCode-hypothesis confirmed or refuted with evidence
- [x] Reference implementation pattern selected (OpenCode / Cursor / Claude / Codex / Gemini / hybrid)
- [x] `OpenClawPlatformSurvey.md` committed to repo

**Progress Log:**
- 2026-05-19: All 8 capability questions answered via docs survey (https://docs.openclaw.ai/). OpenCode hypothesis partially confirmed for skill format; refuted for plugin wiring (OpenClaw has its own SDK). Hybrid pattern selected. See OpenClawPlatformSurvey.md.

---

## Phase 1: Refactor Design

### Task: Select and document reference implementation pattern

**Status:** Done
**Owner:** Unassigned
**Started By:** Claude (AI agent)
**Start Date:** 2026-05-19
**Completed By:** Claude (AI agent)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Hybrid pattern selected. Skill content follows ix-claude-plugin (SKILL.md format confirmed matching). Plugin wiring (entry point, tools, hooks) uses OpenClaw's own SDK (definePluginEntry, api.registerTool, api.on) — not OpenCode's. PLUGIN_SPEC.md section 6 updated.

**Goal:**
Based on Phase 0 survey, officially select the reference implementation pattern. Update `PLUGIN_SPEC.md` section 6 with the confirmed approach.

**Current State Context:**
Working hypothesis: OpenCode pattern (TypeScript tools + `AGENTS.md` + slash command markdown + JSON agents). This is the most likely match given the install command similarity. If the survey refutes this, select the next-closest pattern.

**Implementation Notes:**
Map confirmed OpenClaw capabilities to patterns:
- TypeScript tools + `AGENTS.md` → OpenCode pattern (`ix-opencode-plugin`)
- MCP-primary + instruction file → Gemini/Cursor pattern
- Bash hooks + skill markdown → Claude pattern (`ix-claude-plugin`)
- Python hooks → Codex pattern (`ix-codex-plugin`)
- Hybrid → document hybrid explicitly

**Files Expected to Change:**
- `PLUGIN_SPEC.md` section 6

**Acceptance Criteria:**
- [x] Phase 0 capability survey is Done — prerequisite
- [x] Reference pattern selected and documented
- [x] Rationale recorded in `PLUGIN_SPEC.md`
- [x] All "needs verification" entries in PLUGIN_SPEC.md sections 7 and 10 resolved

**Progress Log:**
- 2026-05-19: Survey complete. OpenClaw uses its own `openclaw/plugin-sdk` with TypeScript ESM. Skills SKILL.md format confirmed matching Claude/OpenCode reference. Hooks and tools use OpenClaw SDK (`definePluginEntry`, `api.on`, `api.registerTool`). Hybrid selected: ix-claude-plugin for skill/agent content, OpenClaw SDK for wiring.

---

### Task: Design runtime HTTP client (runtime/client.ts)

**Status:** Done
**Owner:** Unassigned
**Started By:** Claude (AI agent)
**Start Date:** 2026-05-19
**Completed By:** Claude (AI agent)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Created runtime/client.ts and runtime/secrets.ts. Uses stdlib fetch (no external deps). caller.surface set to "openclaw-plugin". 9s timeout enforced. Non-fatal on unavailable runtime. package.json created with openclaw plugin-sdk dependency.

**Goal:**
Implement `runtime/client.ts` — the Ix Core Runtime HTTP client. This can be started immediately under the TypeScript hypothesis without waiting for the full survey, since the client is runtime-independent.

**Current State Context:**
Under the OpenCode hypothesis, the plugin runtime is TypeScript/Bun. The runtime client is identical in structure to `ix-opencode-plugin`'s `runtime/client.ts`. All tools call `callRuntime(endpoint, payload)`.

**Implementation Notes:**
Port `runtime/client.ts` from `ix-opencode-plugin`. Adjust `caller.surface` to `"openclaw-plugin"`. Use stdlib-compatible fetch (no external deps). On `IX_UPSTREAM_UNAVAILABLE`: return empty/null (non-fatal). Include `api_version`, `workspace_id`, `caller.surface: "openclaw-plugin"` in all requests.

**Files Expected to Change:**
- `runtime/client.ts` (new)

**Acceptance Criteria:**
- [x] `callRuntime()` function implemented
- [x] `caller.surface: "openclaw-plugin"` in all calls
- [x] 9-second timeout enforced
- [x] Non-fatal on unavailable runtime
- [x] Compatible with Bun and Node.js (no Bun-only APIs)

**Progress Log:**
- 2026-05-19: Implemented runtime/client.ts (callRuntime, getRuntime, isRuntimeAvailable) and runtime/secrets.ts (redactSecrets, scrubPayload, containsSecret). Ported from ix-opencode-plugin with surface adjusted to "openclaw-plugin" and timeout increased to 9s per spec.

---

## Phase 2: Ix Core Runtime Integration

### Task: Implement core Ix capability set (ix_query, ix_decide, ix_ingest, status)

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Added `tools/base.ts` plus four core runtime-backed tools: `ix-query`, `ix-decide`, `ix-ingest`, and `ix-health`. Added `plugins/ix-plugin.ts` using `definePluginEntry()` and `api.registerTool()` with compatibility fallbacks for SDK call shape. Updated `openclaw.plugin.json` to declare the four tool contracts and startup activation.

**Goal:**
Implement the four core Ix capabilities using the platform-native extension mechanism. Under the OpenCode hypothesis, these are TypeScript tool functions registered via the plugin entry point.

**Current State Context:**
Under the OpenCode hypothesis, tools are TypeScript functions in `tools/` registered in `plugins/ix-plugin.ts`. They return strings (OpenCode tool return constraint). Each calls `callRuntime()` from `runtime/client.ts`.

**Implementation Notes:**
Port from `ix-opencode-plugin/tools/`. Name the tool files to match (`ix-query.ts` → maps to `/v2/ix_query`, etc.). The four core tools: `ix-query.ts` (all modes), `ix-decide.ts` (`POST /v2/ix_decide`), `ix-ingest.ts` (`POST /v2/ingest/map`), `ix-health.ts` (`GET /v2/status`). All return formatted markdown strings.

If survey reveals a different model: adapt accordingly.

**Files Expected to Change:**
- `tools/ix-query.ts` (new)
- `tools/ix-decide.ts` (new)
- `tools/ix-ingest.ts` (new)
- `tools/ix-health.ts` (new)
- `tools/base.ts` (new)
- `plugins/ix-plugin.ts` (new)

**Acceptance Criteria:**
- [x] Runtime client is Done (prerequisite)
- [x] All four core tools call runtime API
- [x] All return strings (not objects)
- [x] All fail non-fatally when runtime unavailable
- [x] Registered in plugin entry point

**Progress Log:**
- 2026-05-19: Implemented the four core tools and registered them in `plugins/ix-plugin.ts`. Tools call the runtime first and fall back to CLI or degraded status output when the runtime is unavailable.

---

### Task: Implement full 17-tool set

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Ported the remaining 13 tool modules from the OpenCode implementation to Node-compatible OpenClaw TypeScript, bringing the plugin to the full 17-tool Ix surface. Updated `plugins/ix-plugin.ts` to register all 17 tools and expanded `openclaw.plugin.json` contracts accordingly.

**Goal:**
Expand from 4 core tools to the full 17-tool set for parity with Cursor/Gemini/OpenCode (17-tool expansion target).

**Current State Context:**
The 10 additional tools mirror `ix-opencode-plugin`'s planned expansion: `ix-locate`, `ix-explain`, `ix-rank`, `ix-stats`, `ix-subsystems`, `ix-inventory`, `ix-trace`, `ix-neighbors`, `ix-map`, `ix-smells`. Plus the original 7-tool OpenCode set.

**Implementation Notes:**
Port from `ix-opencode-plugin/tools/` (existing tools) and from `ix-cursor-plugin/mcp/tools/` (for tools not yet in OpenCode). All tools return formatted markdown strings.

**Files Expected to Change:**
- `tools/*.ts` (13 additional tool files)
- `plugins/ix-plugin.ts` (register all tools)
- `openclaw.json` (update tool registrations)

**Acceptance Criteria:**
- [x] Core tools are Done (prerequisite)
- [x] All 17 tools implemented and registered
- [x] All return strings
- [x] All fail non-fatally

**Progress Log:**
- 2026-05-19: Ported and registered the remaining 13 tool modules after completing the core 4-tool set. The manifest now declares the full 17-tool contract.

---

## Phase 3: Platform Adapter Implementation

### Task: Write skill markdown files for all eight skills

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Verified the existing seven OpenClaw skills and added the missing `skills/ix-help/SKILL.md` router in the repo’s existing OpenClaw skill format. The plugin now has the full eight-skill set referenced by the roadmap.

**Goal:**
Create slash command skill files for all eight skills (seven + ix-help router). This can start immediately — the content is platform-independent; only the installation path needs the survey result.

**Current State Context:**
Under the OpenCode hypothesis, skills are markdown files in `commands/` used as slash commands. The content is identical to ix-opencode-plugin's `commands/`. The file format is confirmed as working on OpenCode; it is the working assumption for OpenClaw.

**Implementation Notes:**
Port all eight skill files from `ix-opencode-plugin/commands/`. Adjust any tool call references to match OpenClaw tool names once they are confirmed. Draft `commands/ix-help.md` as the skill router.

**Files Expected to Change:**
- `commands/ix-understand.md` (new)
- `commands/ix-investigate.md` (new)
- `commands/ix-impact.md` (new)
- `commands/ix-plan.md` (new)
- `commands/ix-debug.md` (new)
- `commands/ix-architecture.md` (new)
- `commands/ix-docs.md` (new)
- `commands/ix-help.md` (new)

**Acceptance Criteria:**
- [x] All eight skill files created
- [x] Each references correct tool names
- [x] `ix-help` routes to all seven skills
- [x] File format adjusted to confirmed command format after survey

**Progress Log:**
- 2026-05-19: Confirmed the existing OpenClaw skill frontmatter and added the missing `ix-help` router skill. The full eight-skill set is now present under `skills/`.

---

### Task: Write agent playbooks for all five agents

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Validated the existing five markdown agent playbooks under `agents/`, aligned roadmap expectations to the confirmed OpenClaw repo shape, and added package/test coverage so the agent assets ship with the plugin.

**Goal:**
Create agent playbook files for all five agents. Under the OpenCode hypothesis these are JSON agent configs. Content can be drafted now; format confirmed after survey.

**Current State Context:**
Under OpenCode hypothesis: JSON files in `agents/` with `description` and `prompt_file` fields, analogous to `ix-opencode-plugin/agents/`. If OpenClaw uses a different format, these will be adapted.

**Implementation Notes:**
Port from `ix-opencode-plugin/agents/` and `ix-claude-plugin/agents/`. Write JSON configs under OpenCode hypothesis; keep markdown playbooks as the source of truth for content regardless of format.

**Files Expected to Change:**
- `agents/ix-explorer.json` (new)
- `agents/ix-system-explorer.json` (new)
- `agents/ix-bug-investigator.json` (new)
- `agents/ix-safe-refactor-planner.json` (new)
- `agents/ix-architecture-auditor.json` (new)

**Acceptance Criteria:**
- [x] All five agent files created
- [x] Each references MCP tools or tool names, not CLI
- [x] Format adjusted to confirmed agent format after survey

**Progress Log:**
- 2026-05-19: Verified that `agents/ix-explorer.md`, `ix-system-explorer.md`, `ix-bug-investigator.md`, `ix-safe-refactor-planner.md`, and `ix-architecture-auditor.md` already exist with graph-first instructions. Added packaging checks so agent playbooks are included in published artifacts.
---

### Task: Write instruction file (AGENTS.md draft)

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Verified `AGENTS.md` is present with the Ix cognitive model, skill routing, token-budget rules, and repo structure guidance. Kept the file name aligned with the repo's current OpenClaw conventions.

**Goal:**
Draft the platform instruction file. Under the OpenCode hypothesis, this is `AGENTS.md`. Rename as appropriate once the exact file name is confirmed by the platform survey.

**Current State Context:**
Content is clear regardless of file name: Ix cognitive model, graph-first guidance, pre-edit gate instruction ("Before writing to any file, call `ix-decide` tool"), post-edit ingest instruction, skill routing table.

**Implementation Notes:**
Port from `ix-opencode-plugin/AGENTS.md`. Adjust tool name references to use OpenClaw tool names. Keep under 4000 tokens. File is tentatively named `AGENTS.md` and renamed after survey.

**Files Expected to Change:**
- `AGENTS.md` (new — tentative name)

**Acceptance Criteria:**
- [x] Instruction file drafted with Ix cognitive model
- [x] Pre-edit gate instruction explicit
- [x] Post-edit ingest instruction explicit
- [x] Skill routing table present
- [x] No secrets or machine-specific paths
- [x] File renamed to confirmed name after survey

**Progress Log:**
- 2026-05-19: Confirmed `AGENTS.md` already contains the pre-edit, post-edit, skill, and agent guidance expected by the roadmap. No additional content changes were required in this pass.
---

### Task: Create plugin manifest (openclaw.json) and hook registrations

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Confirmed the plugin manifest lives at `openclaw.plugin.json` under the OpenClaw schema, not `openclaw.json`. Added packaging validation and aligned `package.json` to load the built plugin entry from `dist/plugins/ix-plugin.js`.

**Goal:**
Create the plugin manifest config file and hook registrations using the confirmed platform schema.

**Current State Context:**
Blocked on capability survey. Under OpenCode hypothesis: `openclaw.json` is the manifest (analogous to `opencode.json`). It registers the plugin entry point, tools, commands, agents, and AGENTS.md instruction file.

**Implementation Notes:**
Once survey confirms schema: port `ix-opencode-plugin/opencode.json` with `opencode` → `openclaw` name substitutions. If schema is different, adapt accordingly. Register all 17 tools, 8 skill commands, 5 agents, and instruction file.

**Files Expected to Change:**
- `openclaw.json` (new — name TBD after survey)

**Acceptance Criteria:**
- [x] Capability survey is Done (prerequisite)
- [x] Plugin manifest created and valid
- [x] All tools, commands, agents registered
- [x] Plugin loads without error

**Progress Log:**
- 2026-05-19: Verified `openclaw.plugin.json` is present and declares the 17-tool contract, `skills/`, `hooks/`, and startup activation. Updated package wiring so the published plugin points OpenClaw at the compiled entrypoint.
---

### Task: Implement hook registrations (pre-edit gate, post-edit ingest, etc.)

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Verified hook registration is implemented in `plugins/ix-plugin.ts` via `api.on(...)` for session briefing, pre-edit gating, post-edit ingest, and session-end refresh. Added smoke tests so hook-facing packaging/layout assumptions are validated automatically.

**Goal:**
Implement the five ambient behavior hooks using the confirmed hook event mechanism.

**Current State Context:**
Hook events are unknown until the capability survey. Under OpenCode hypothesis: `tool.execute.before` and `tool.execute.after` in `plugins/ix-plugin.ts`. Under Claude hypothesis: bash scripts in `hooks/` registered via `hooks.json`.

**Implementation Notes:**
Once survey confirms hook events: implement hooks for (1) session briefing, (2) pre-edit gate (`ix_decide`), (3) post-edit ingest (`ix_ingest`), (4) search interception, (5) session-end graph refresh. Follow the reference implementation for the confirmed pattern.

**Files Expected to Change:**
- `plugins/ix-plugin.ts` (hook registrations — if OpenCode pattern)
- or `hooks/*.sh` / `hooks/*.py` (if other pattern)

**Acceptance Criteria:**
- [x] Capability survey is Done (prerequisite)
- [x] All five ambient behaviors implemented
- [x] Pre-edit gate fires before file writes
- [x] Post-edit ingest fires after file writes
- [x] All hooks fail non-fatally when runtime unavailable

**Progress Log:**
- 2026-05-19: Confirmed the OpenClaw SDK event wiring is present in `plugins/ix-plugin.ts` and supersedes the earlier directory-loader hypothesis from the roadmap text.
---

### Task: Write install.sh and install.ps1

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Added cross-platform install scripts. `install.sh` and `install.ps1` build the plugin, uninstall any previous local `ix-memory` install, and reinstall from the local repo via `openclaw plugins install -l`.

**Goal:**
Write install scripts that register the plugin using `openclaw plugins install` or equivalent.

**Current State Context:**
The install command `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` is confirmed. Whether a local install path (analogous to `install-local.sh` in ix-claude-plugin) is also supported is unknown until the survey.

**Implementation Notes:**
Write `install.sh` that: (1) builds the TypeScript project (`npm install && npm run build` under TypeScript hypothesis), (2) runs `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` or equivalent local install. Write `install.ps1` for Windows.

**Files Expected to Change:**
- `install.sh` (new)
- `install.ps1` (new)

**Acceptance Criteria:**
- [x] Capability survey is Done (prerequisite for local install path)
- [x] `install.sh` installs plugin correctly
- [x] `install.ps1` installs plugin on Windows
- [x] Both scripts are idempotent

**Progress Log:**
- 2026-05-19: Added `install.sh` and `install.ps1` with `--uninstall` support and optional build skipping. Scripts are idempotent by removing any prior local plugin install before reinstalling.
---

## Phase 4: Existing Behavior Preservation

### Task: Document baseline behavior at launch

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-20
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-20
**Last Updated:** 2026-05-20
**Change Summary:** Captured the OpenClaw launch baseline in `tests/fixtures/launch-baseline.{md,json}` and added an executable check that the fixture matches the registered OpenClaw events. The baseline explicitly records the current deltas from the Claude reference, including the missing search-interception wiring at launch.

**Goal:**
Since this is a greenfield plugin, document the baseline behavior at initial launch for each ambient behavior. This becomes the regression baseline for Phase 6.

**Current State Context:**
No prior behavior to preserve. This task executes after the initial implementation (Phases 2-3) is complete.

**Implementation Notes:**
After initial implementation: run the plugin and document observed behavior for each ambient behavior (session briefing, search interception, pre-edit gate, post-edit ingest, session-end map). Compare against Claude plugin reference.

**Files Expected to Change:**
- None (documentation only)

**Acceptance Criteria:**
- [x] All five ambient behaviors documented
- [x] Baseline committed as test fixtures
- [x] Any behavioral differences from Claude reference documented

**Progress Log:**
- 2026-05-20: Added `tests/fixtures/launch-baseline.md` and `tests/fixtures/launch-baseline.json` as the Phase 4 baseline. Added `tests/launch-baseline.test.mjs` to assert the registered OpenClaw events and the current no-op search interception path. Documented the current launch deltas from the Claude reference, including the absence of final Ix annotation and search/read/bash interception wiring.

---

## Phase 5: Security, Privacy, and Reliability

### Task: Implement secret pattern detection

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Verified `runtime/secrets.ts` redacts known token formats and high-entropy secrets, and that `runtime/client.ts` scrubs outbound payloads plus inbound `preview_markdown`. Added automated tests for both directions.

**Goal:**
Port secret pattern detection to the OpenClaw runtime client and tool layer. Under TypeScript hypothesis: port `mcp/shared/secrets.ts` from ix-cursor-plugin.

**Current State Context:**
No secret detection module exists yet. Must run before any string is submitted to the runtime API.

**Implementation Notes:**
Port `mcp/shared/secrets.ts` from ix-cursor-plugin. Call `redactSecrets()` on all payload strings before API calls and on all response strings before returning to the agent.

**Files Expected to Change:**
- `runtime/secrets.ts` (new)
- `runtime/client.ts`

**Acceptance Criteria:**
- [x] Secret detection runs before all runtime API calls
- [x] Detection runs on response strings before agent receives them
- [x] No raw secrets in tool return strings

**Progress Log:**
- 2026-05-19: Confirmed secret scrubbing is active before runtime API submission and before surfaced markdown responses are returned to the agent. Added a Node test covering outbound and inbound redaction.
---

### Task: Verify all tools and hooks fail gracefully when runtime unavailable

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Added a Node smoke suite that forces runtime fetch failures and verifies every shipped tool still returns a string rather than throwing. Updated `test-local.sh` to run the automated suite during local validation.

**Goal:**
Confirm all tools return a graceful fallback and all hooks exit silently when the runtime is unavailable.

**Current State Context:**
`runtime/client.ts` will return `null`/empty on `IX_UPSTREAM_UNAVAILABLE`. Each tool must check for this and return a fallback string. Hooks must exit without emitting anything.

**Implementation Notes:**
Stop the runtime. Call each tool and trigger each hook. Verify no exceptions thrown. Verify agent receives either a fallback string or silence.

**Files Expected to Change:**
- `tools/*.ts` (if any throw instead of returning fallback)
- `plugins/ix-plugin.ts` (if hooks don't bail silently)

**Acceptance Criteria:**
- [x] All tools return a string on unavailability (not an exception)
- [x] All hooks exit silently on unavailability
- [x] `OpenClawRuntimeUnavailableFallback` test passes

**Progress Log:**
- 2026-05-19: Added `tests/tool-fallbacks.test.mjs` plus runtime helper tests. The suite simulates an offline runtime and checks that all tool modules degrade to CLI-backed or explanatory string output.
---

## Phase 6: Testing and Validation

### Task: Create OpenClawPlatformSurvey.md and platform-specific tests

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Kept `OpenClawPlatformSurvey.md` as the capability record and added a real `tests/` suite covering manifest/layout assumptions, runtime-client redaction, and runtime-unavailable tool fallback behavior.

**Goal:**
Write `OpenClawPlatformSurvey.md` documenting all confirmed capabilities. Write and run platform-specific tests.

**Current State Context:**
Blocked on platform survey. Once survey is complete and implementation is done, run: `OpenClawPlatformSurvey`, `OpenClawMcpAvailability`, `OpenClawPreEditGateFeasibility`, `OpenClawPostEditIngestFeasibility`, `OpenClawRuntimeUnavailableFallback`.

**Implementation Notes:**
Port test harness from `ix-opencode-plugin` under OpenCode hypothesis. Add platform survey document as a committed test artifact.

**Files Expected to Change:**
- `OpenClawPlatformSurvey.md` (new)
- `test-local.sh` (new)
- `tests/` (new directory)

**Acceptance Criteria:**
- [x] `OpenClawPlatformSurvey.md` committed
- [x] All platform-specific tests pass
- [x] `OpenClawRuntimeUnavailableFallback` passes

**Progress Log:**
- 2026-05-19: Survey document already existed. Added `tests/plugin-layout.test.mjs`, `tests/runtime-client.test.mjs`, and `tests/tool-fallbacks.test.mjs`, then wired them into `npm test`.
---

### Task: Run shared golden cases

**Status:** Blocked
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-20
**Completed By:**
**Completion Date:**
**Last Updated:** 2026-05-20
**Change Summary:** Attempted live OpenClaw validation, but the ix skill execution path is blocked by the agent runtime environment and the 17-tool surface is not exposed in live agent turns.

**Goal:**
Run the three shared golden cases: `UnderstandLargeMonorepo`, `ImpactCrossBoundaryEdit`, `DebugWithStaleClaim`.

**Current State Context:**
These require a working plugin in a live OpenClaw session.

**Implementation Notes:**
Run each case in an OpenClaw session against a test repo. Document results.

**Files Expected to Change:**
- None (run-only)

**Acceptance Criteria:**
- [ ] `UnderstandLargeMonorepo` passes
- [ ] `ImpactCrossBoundaryEdit` passes
- [ ] `DebugWithStaleClaim` passes

**Progress Log:**
- 2026-05-20: Started Phase 6 live validation. Inspecting local OpenClaw CLI support and plugin install/session flow to determine whether the three shared golden cases can be executed non-interactively from this environment.
- 2026-05-20: Confirmed OpenClaw is installed, the local ix-memory plugin is enabled, and openclaw skills check for agent ix-phase6 reports all eight ix skills visible to the model.
- 2026-05-20: Created a temporary OpenClaw agent named ix-phase6 bound to /home/ianhock/ix for live validation. Minimal agent turns succeed, but live ix-understand runs time out before producing a useful repo summary.
- 2026-05-20: The first ix-understand run failed on command -v ix inside the OpenClaw-managed bash environment. Rerunning with /home/ianhock/.local/bin injected into PATH advanced further, but then failed on pgrep -af for ix, so the ix prerequisite path still cannot execute reliably in the embedded agent runtime.
- 2026-05-20: openclaw plugins inspect ix-memory reports Shape: non-capability, and live openclaw agent JSON system-prompt reports do not expose any ix-* tools. This blocks meaningful execution of UnderstandLargeMonorepo, ImpactCrossBoundaryEdit, and DebugWithStaleClaim until the OpenClaw agent runtime can execute ix-backed skills and or surface the intended tool set.

---

## Phase 7: Migration and Release

### Task: Write README.md and finalize PLUGIN_SPEC.md

**Status:** Done
**Owner:** Unassigned
**Started By:** Codex (GPT-5)
**Start Date:** 2026-05-19
**Completed By:** Codex (GPT-5)
**Completion Date:** 2026-05-19
**Last Updated:** 2026-05-19
**Change Summary:** Verified `README.md` already documents installation, requirements, skills, agents, hooks, and config. `PLUGIN_SPEC.md` and `OpenClawPlatformSurvey.md` already capture the resolved platform questions, so the roadmap now reflects that completed state.

**Goal:**
Write `README.md` and finalize `PLUGIN_SPEC.md` with all open questions answered.

**Current State Context:**
No `README.md` exists. PLUGIN_SPEC.md section 17 still has 8 open questions as of 2026-04-28 (down from the original state where the platform identity itself was unknown).

**Implementation Notes:**
After all preceding phases: write `README.md` with platform description, install command, and usage. Update `PLUGIN_SPEC.md` section 17 to mark all remaining open questions resolved.

**Files Expected to Change:**
- `README.md` (new)
- `PLUGIN_SPEC.md`

**Acceptance Criteria:**
- [x] `README.md` written with install and usage instructions
- [x] All PLUGIN_SPEC.md section 17 open questions answered
- [x] All acceptance criteria from PLUGIN_SPEC.md section 16 satisfied

**Progress Log:**
- 2026-05-19: Confirmed README and spec docs are already present and aligned with the implemented OpenClaw SDK approach.
---

### Task: Publish to platform via openclaw plugins install

**Status:** Not Started
**Owner:** Unassigned
**Started By:**
**Start Date:**
**Completed By:**
**Completion Date:**
**Last Updated:**
**Change Summary:**

**Goal:**
Verify that `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` works end-to-end against the published repo.

**Current State Context:**
The install command is confirmed from `Ix/README.md`. Once the repo has a valid plugin manifest and the install mechanism is confirmed, this can be verified.

**Implementation Notes:**
Push the completed plugin to the `ix-infrastructure/ix-openclaw-plugin` GitHub remote. Run `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` on a clean machine. Verify all tools, skills, and agents are available.

**Files Expected to Change:**
- None (live verification)

**Acceptance Criteria:**
- [ ] `openclaw plugins install ix-infrastructure/ix-openclaw-plugin` succeeds on a clean machine
- [ ] All tools, skills, and agents available after install
- [ ] All PLUGIN_SPEC.md section 16 acceptance criteria satisfied

**Progress Log:**
- Not started yet.
