# OpenClaw Launch Baseline

Captured on 2026-05-20 from the shipped OpenClaw plugin implementation.

## Source Of Truth

- Runtime wiring: `plugins/ix-plugin.ts`
- Reference comparison: `../ix-claude-plugin/README.md`
- Supporting docs: `README.md`

The baseline below records what the OpenClaw plugin actually does at launch. When the hook subdirectories or README describe broader behavior, `plugins/ix-plugin.ts` wins.

## Ambient Behaviors

| Behavior | Launch status | Runtime event | Baseline | Claude delta |
|---|---|---|---|---|
| Session briefing | Implemented | `before_prompt_build` | Prepends `[ix] Session briefing:` plus the Ix Pro text briefing (capped at 2,000 characters) when `workspaceDir` is available, once per workspace per 10-minute window. The `ix briefing` result is cached for the same 10 minutes. | Claude triggers on `UserPromptSubmit` and also asks Claude to append a final Ix help summary. OpenClaw only prepends context. |
| Search interception | Not implemented at launch | `before_tool_call` | `read` and `exec` (OpenClaw has no `Grep`/`Glob`) receive no Ix-injected context: a `before_tool_call` result can block, rewrite params, or ask for approval, but cannot add context. | Claude front-runs `Grep`/`Glob` and grep-like `Bash` calls with Ix context. OpenClaw does not yet do this. |
| Pre-edit gate | Implemented | `before_tool_call` | For OpenClaw `edit`, `write`, and `apply_patch` on non-skipped paths (every file of a patch), the plugin runs `ix-decide`. `REVIEW` requires approval (a high-risk change is a `REVIEW` with critical severity, never a block); `ALLOW` is silent. | Claude's baseline is warning-oriented. OpenClaw forces approval for risky edits. |
| Post-edit ingest | Implemented | `after_tool_call` | After a successful write tool call on a non-skipped path, the plugin requests the guarded root map: `ix map <git root> --silent` in the background, only for an already-mapped git repo (root not `$HOME`), debounced 5 minutes per root. Never `ix map <file>`. No user-visible output. | Similar to Claude's async post-edit ingest behavior. |
| Session-end map | Implemented | `session_end` | On session end, the plugin requests the same guarded root map for the agent's workspace directory (never the session transcript directory). No user-visible output. | Claude refreshes the graph on `Stop` and also has a separate final Ix annotation hook. OpenClaw only refreshes the graph. |

## Notes

- The launch runtime registers exactly four OpenClaw events: `before_prompt_build`, `before_tool_call`, `after_tool_call`, and `session_end`.
- The folder hooks (`hooks/*`) were removed in 2.4.2: six subscribed to events folder hooks never receive (`before_tool_call`, `tool_result_persist`, `agent_end`), and `ix-briefing` duplicated the plugin's `before_prompt_build` briefing.
- Skipped paths for the pre-edit and post-edit hooks include markdown, text, lockfiles, common binary assets, and compiled artifacts.
- All launch hooks fail silently when Ix is unavailable.
