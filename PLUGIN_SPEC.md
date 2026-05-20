# ix-openclaw-plugin — Plugin Specification

Version: 2.0.0-draft  
Root spec: [IX_PLUGIN_OVERHAUL_SPEC.md](../IX_PLUGIN_OVERHAUL_SPEC.md)  
Status: **Active target — platform confirmed. Capability survey next. Risk: medium until runtime and plugin API are verified.**

---

## 1. Plugin name

`ix-memory` (OpenClaw plugin ID — to be confirmed against platform manifest schema)  
Repository: `ix-openclaw-plugin`

---

## 2. Target AI platform

**OpenClaw** — A real external AI coding agent CLI tool. Confirmed from multiple sources, including direct documentation survey (2026-05-19).

- **GitHub:** https://github.com/openclaw/openclaw (public, open-source)
- **Website:** https://openclaw.ai/
- **Docs:** https://docs.openclaw.ai/
- **Marketplace:** ClawHub (https://documentation.openclaw.ai/clawhub)

### What is confirmed

- **OpenClaw is a real platform**, not an internal codename, placeholder, or prototype. It is listed in `Ix/README.md` alongside Claude Code CLI, OpenAI Codex CLI, and Google Gemini CLI in the supported surfaces badge.
- **Install command confirmed:** `openclaw plugins install git:ix-infrastructure/ix-openclaw-plugin`. The CLI entry point is `openclaw`. Git repos use the `git:owner/repo` prefix. ClawHub packages use `clawhub:<package>`. npm packages use the bare name.
- **Runtime confirmed:** TypeScript, Node 24 (recommended) or Node 22.19+ minimum. ESM modules mandatory. No Bun dependency.
- **Plugin manifest confirmed:** `openclaw.plugin.json` with `id`, `name`, `description`, `contracts.tools`, `configSchema`, `activation.onStartup`.
- **Plugin SDK confirmed:** `openclaw/plugin-sdk`. Entry point via `definePluginEntry()` from `openclaw/plugin-sdk/plugin-entry`. Tools registered with `api.registerTool()`. Hooks registered with `api.on("event_name", handler)`.
- **Hook events confirmed:** `before_tool_call`, `after_tool_call`, `tool_result_persist`, `message_received`, `agent_end`, `session_start`, `session_end`, `before_prompt_build`, `agent_turn_prepare`, `before_agent_run`, `before_agent_reply`, `subagent_spawning`, `gateway_start`, and others. Full list in `OpenClawPlatformSurvey.md`.
- **Instruction file confirmed:** `AGENTS.md` (confirmed in platform README).
- **Skill format confirmed:** `skills/<name>/SKILL.md` with frontmatter (matches current repo structure).
- **MCP support confirmed:** Supported via MCP Registry.
- **Agent delegation confirmed:** Supported via subagent hooks (`subagent_spawning`, `subagent_delivery_target`, `subagent_spawned`, `subagent_ended`).
- **Active production target:** Listed in `IX_PLUGIN_OVERHAUL_SPEC.md` as a planned surface with an alpha date of 2027-03-01.

### What is not confirmed

- Nothing significant remaining. See `OpenClawPlatformSurvey.md` for full capability record.

### OpenCode hypothesis result

**Partially confirmed, partially refuted.**
- **Confirmed:** Skills use `SKILL.md` format in subdirectories (matches OpenCode/Claude pattern). `AGENTS.md` is the instruction file (matches OpenCode).
- **Refuted:** OpenClaw has its own `openclaw/plugin-sdk` — it is NOT an OpenCode fork or derivative. Hook registration uses `api.on()` not OpenCode's `plugin.ts` pattern. Tool registration uses `api.registerTool()` not OpenCode's API.
- **Selected pattern:** Hybrid — `ix-claude-plugin` for skill and agent content semantics; OpenClaw SDK for all platform wiring (entry point, hooks, tools, manifest).

### Why this matters for implementation

The install command confirms a plugin registry exists. The structural similarity to OpenCode means implementation work can begin on content artifacts (skills, agents, instruction file) and the runtime client immediately — only the platform-native wiring (hooks, manifest, config file) requires the full capability survey.

---

## 3. Current implementation summary

**No implementation exists.** This directory was created during the plugin spec distribution pass. There are no source files, no hook scripts, no skills, no agents, and no install scripts.

---

## 4. Existing files and behavior to preserve

No existing files. Nothing to preserve.

---

## 5. Known gaps and stale areas

| Gap | Impact | Status |
|---|---|---|
| Platform GitHub URL / docs not found in repo | Cannot verify exact plugin manifest schema or hook events | **Blocks** hook/tool wiring only — not content work |
| Hook event types unconfirmed | Cannot implement pre-edit gate or post-edit ingest automatically | Medium — agent-driven fallback available |
| MCP support unconfirmed | Cannot decide between MCP-first or tool-first implementation | Medium |
| Instruction file name unknown | Cannot finalize AGENTS.md vs OPENCLAW.md | Low — easy to rename at survey time |
| Plugin manifest schema unknown | Cannot publish to any marketplace | Low — install via `plugins install` still works |
| No implementation files | 100% of work remains | Expected for spec-only stage |

---

## 6. Desired outcome

This is a greenfield implementation. The goal is full parity with the seven-skill, five-agent capability set across all Ix plugins.

**Confirmed implementation plan (Hybrid pattern — survey complete as of 2026-05-19):**

1. ~~Confirm platform identity~~ — Done
2. ~~Verify/falsify OpenCode hypothesis~~ — Done: hybrid pattern selected
3. Skills, agents, AGENTS.md — Done (exists in repo, SKILL.md format confirmed)
4. Hooks — Exists but needs event shape fixes (see `OpenClawPlatformSurvey.md` for details)
5. Runtime client (`runtime/client.ts`) — Done
6. Plugin entry point (`plugins/ix-plugin.ts`) with `definePluginEntry`, `api.registerTool`, `api.on` — Next
7. Tools (`tools/*.ts`) using `runtime/client.ts` — Phase 2
8. Fix hook event shapes to match confirmed OpenClaw API — Phase 3 Task 5
9. `install.sh` / `install.ps1` — Phase 3 Task 6
10. Run shared golden cases — Phase 6

---

## 7. Platform-specific integration model

Partial — based on confirmed evidence and OpenCode-model hypothesis.

| Mechanism | Status | Evidence / Hypothesis |
|---|---|---|
| CLI entry point | **Confirmed** | `openclaw` binary |
| Plugin installation | **Confirmed** | `openclaw plugins install git:ix-infrastructure/ix-openclaw-plugin` |
| Plugin registry | **Confirmed** | ClawHub (primary), npm, git: prefixed GitHub repos |
| Plugin config file | **Confirmed** | `openclaw.plugin.json` with `id`, `name`, `description`, `contracts.tools`, `configSchema` |
| Tool surface | **Confirmed** | `api.registerTool()` in `definePluginEntry` from `openclaw/plugin-sdk/plugin-entry` |
| Skills | **Confirmed** | `skills/<name>/SKILL.md` with frontmatter (matches current repo structure) |
| Instruction file | **Confirmed** | `AGENTS.md` |
| Hook events | **Confirmed** | `api.on("event_name", handler)` — see `OpenClawPlatformSurvey.md` for full event list |
| MCP support | **Confirmed** | Supported via MCP Registry |
| Agent delegation | **Confirmed** | Subagent hooks: `subagent_spawning`, `subagent_spawned`, `subagent_ended` |
| Plugin manifest schema | **Confirmed** | `openclaw.plugin.json` — tools declared in `contracts.tools` array |
| Distribution | **Confirmed** | ClawHub marketplace + `git:` direct install |

---

## 8. Required Ix capabilities

Target: same capability set as all other plugins.

| Capability | Priority | Status |
|---|---|---|
| `POST /v2/ix_query` (all modes) | High | Needs runtime client implementation |
| `POST /v2/ix_decide` | High | Needs runtime client + pre-edit hook |
| `POST /v2/ingest/map` | High | Needs runtime client + post-edit hook |
| `GET /v2/status` | High | Needs runtime client |
| Pre-edit gate | High | Hook mechanism needs survey |
| Post-edit ingest | High | Hook mechanism needs survey |
| Session briefing | High | Instruction file mechanism needs confirmation |
| All seven skills | High | Content ready to draft; packaging mechanism needs confirmation |
| All five agents | Medium | Content ready to draft; delegation mechanism needs survey |
| MCP tools | Medium | MCP support needs survey |

---

## 9. Required hooks, skills, agents, commands, and MCP integrations

**Ambient behaviors (all required, mechanism TBD):**
- Session briefing (`ix_query` mode `"status"`)
- Pre-edit gate (`ix_decide` before file writes)
- Post-edit ingest (`ingest/map` after file writes)
- Search interception (front-run grep/search with `ix_query` locate)
- Full graph refresh at session end

**Skills (eight, including router):**
`ix-understand`, `ix-investigate`, `ix-impact`, `ix-plan`, `ix-debug`, `ix-architecture`, `ix-docs`, `ix-help`

**Agents (five):**
`ix-explorer`, `ix-system-explorer`, `ix-bug-investigator`, `ix-safe-refactor-planner`, `ix-architecture-auditor`

**Tools (if tool-based model confirmed):**
Same 17-tool set as Cursor/Gemini/OpenCode (17-tool expansion target).

---

## 10. Required folder structure after implementation

Working hypothesis based on OpenCode model (subject to revision after survey):

```
ix-openclaw-plugin/
├── openclaw.json              # Plugin manifest (analogous to opencode.json)
├── AGENTS.md                  # Instruction file (name TBD after survey)
├── plugins/
│   └── ix-plugin.ts           # Plugin entry point — registers tools and hooks
├── tools/
│   ├── base.ts
│   ├── [7 existing tools matching OpenCode pattern, migrated to runtime API]
│   └── [10 new tools for 17-tool parity]
├── commands/
│   ├── ix-help.md
│   ├── ix-understand.md
│   ├── ix-investigate.md
│   ├── ix-impact.md
│   ├── ix-plan.md
│   ├── ix-debug.md
│   ├── ix-architecture.md
│   └── ix-docs.md
├── agents/
│   ├── ix-explorer.json
│   ├── ix-system-explorer.json
│   ├── ix-bug-investigator.json
│   ├── ix-safe-refactor-planner.json
│   └── ix-architecture-auditor.json
├── runtime/
│   └── client.ts              # Ix Core Runtime HTTP client
├── install.sh
├── install.ps1
├── PLUGIN_SPEC.md             # This file
├── ROADMAP.md
└── README.md
```

**This structure will be finalized once the platform survey (Phase 0) confirms or refutes the OpenCode-model hypothesis.**

---

## 11. Shared Ix Core Runtime requirements

See [IX_PLUGIN_OVERHAUL_SPEC.md](../IX_PLUGIN_OVERHAUL_SPEC.md). Plugin-specific notes:

- `caller.surface = "openclaw-plugin"` in all API calls.
- Runtime client must handle `IX_UPSTREAM_UNAVAILABLE` gracefully; tools must fail non-fatally.
- Git revision must be detected from workspace root; fall back to content hash if not in a git repo.
- If MCP is available: prefer MCP tool calls over direct HTTP.

---

## 12. API contracts used by this plugin

Target: same as all other plugins.

| API | Mechanism | Notes |
|---|---|---|
| `POST /v2/ix_query` | TypeScript tool or hook | `caller.surface = "openclaw-plugin"` |
| `POST /v2/ix_decide` | Pre-edit hook or tool | |
| `POST /v2/ingest/map` | Post-edit hook or tool | |
| `GET /v2/status` | Health tool or startup probe | |

Specific mechanism (TypeScript tool vs. MCP vs. hook) depends on platform survey findings.

---

## 13. Security and privacy requirements

Same shared requirements as all other plugins (see root spec).

- No secrets or tokens in distributed config files (`openclaw.json`, `AGENTS.md`)
- No long-lived credentials in plugin manifests or instruction files
- Secret pattern detection before any string is submitted to Ix via tools or hooks
- Thin wrapper scripts/tools — no business logic in glue code
- Tool/hook telemetry must not log raw prompt text, code snippets, or tool parameters

---

## 14. Testing requirements

| Test | Coverage | Blocked? |
|---|---|---|
| `OpenClawPlatformSurvey` | Documents confirmed capabilities: hooks, tools, MCP, instruction file, skill loading | Needs platform survey |
| `OpenClawMcpAvailability` | MCP support status verified | Needs platform survey |
| `OpenClawPreEditGateFeasibility` | Pre-edit gate mechanism confirmed and working | Needs hook event survey |
| `OpenClawPostEditIngestFeasibility` | Post-edit ingest mechanism confirmed and working | Needs hook event survey |
| `OpenClawRuntimeUnavailableFallback` | All behaviors degrade gracefully | After implementation |
| Shared golden cases | `UnderstandLargeMonorepo`, `ImpactCrossBoundaryEdit`, `DebugWithStaleClaim` | After implementation |

---

## 15. Migration plan

This is a greenfield implementation. Build order after survey confirms/refutes OpenCode hypothesis:

| Step | Action | Blocker |
|---|---|---|
| 1. Platform survey | Confirm GitHub URL, runtime, hook events, MCP, manifest schema | GitHub URL needed |
| 2. Hypothesis confirm/refute | Validate or discard OpenCode-model hypothesis | Survey |
| 3. Runtime client | Implement `runtime/client.ts` HTTP client | None — can start now |
| 4. Content artifacts | Draft skills, agents, instruction file | None — can start now |
| 5. Plugin wiring | Implement tools, hooks, manifest using confirmed platform model | Survey |
| 6. Install scripts | `install.sh`, `install.ps1` using confirmed install path | Survey |
| 7. Testing | Run platform-specific tests + shared golden cases | Implementation |
| 8. Distribution | Register in marketplace if available | Survey |

---

## 16. Acceptance criteria

**Phase 0 (platform survey):**
- [x] OpenClaw confirmed as a real external AI coding agent CLI tool
- [x] Install mechanism confirmed (`openclaw plugins install git:ix-infrastructure/ix-openclaw-plugin`)
- [x] OpenCode-model hypothesis evaluated — hybrid pattern selected
- [x] GitHub URL / documentation source confirmed (https://github.com/openclaw/openclaw)
- [x] Runtime confirmed (TypeScript/Node 24, ESM)
- [x] Hook event types confirmed (full list in OpenClawPlatformSurvey.md)
- [x] MCP support status confirmed (supported)
- [x] Instruction file name and format confirmed (AGENTS.md)
- [x] Plugin manifest schema confirmed (openclaw.plugin.json)

**Implementation:**
- [ ] All seven skill workflows are reachable
- [ ] Pre-edit gate calls `ix_decide` before file writes
- [ ] Post-edit ingest calls `ix_ingest` after file writes
- [ ] Session briefing injects Ix context
- [ ] All five agents are available
- [ ] All behaviors degrade gracefully when runtime is unavailable
- [ ] Shared golden cases pass
- [ ] No secrets or machine-specific paths in distributed config files

---

## 17. Open questions

Unknown count: reduced to **0**. All platform unknowns resolved as of 2026-05-19. See `OpenClawPlatformSurvey.md` for the full capability record.

**Resolved:**
1. ~~What is OpenClaw?~~ **Resolved:** Real external AI coding agent CLI tool. GitHub: https://github.com/openclaw/openclaw. Listed alongside Claude, Codex, Gemini. Alpha target date: 2027-03-01.
2. ~~Should this plugin remain an active target?~~ **Resolved:** Yes. Active target — not a candidate for archiving or merging.
3. ~~Exact runtime.~~ **Resolved:** TypeScript/Node 24 (Node 22.19+ minimum). ESM modules mandatory. No Bun dependency.
4. ~~Plugin manifest and schema.~~ **Resolved:** `openclaw.plugin.json` with `id`, `name`, `description`, `contracts.tools` array, `configSchema`, `activation.onStartup`.
5. ~~Hook and event support.~~ **Resolved:** Full hook system via `api.on("event_name", handler)` in `definePluginEntry`. Events include `before_tool_call`, `after_tool_call`, `tool_result_persist`, `message_received`, `agent_end`, `session_start`, `session_end`, `before_prompt_build`, `agent_turn_prepare`, and many more.
6. ~~MCP, agent delegation, skill loading, instruction file.~~ **Resolved:** MCP supported via MCP Registry. Agent delegation via subagent hooks. Skills loaded from `skills/<name>/SKILL.md`. Instruction file is `AGENTS.md`.

---

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for phased implementation tasks and progress tracking.
