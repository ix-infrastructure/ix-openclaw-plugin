# OpenClaw Launch Baseline

Captured on 2026-05-20 from the shipped OpenClaw plugin implementation.

## Source Of Truth

- Runtime wiring: `plugins/ix-plugin.ts`
- Reference comparison: `../ix-claude-plugin/README.md`
- Supporting docs: `README.md`, `hooks/*/HOOK.md`

The baseline below records what the OpenClaw plugin actually does at launch. When the hook subdirectories or README describe broader behavior, `plugins/ix-plugin.ts` wins.

## Ambient Behaviors

| Behavior | Launch status | Runtime event | Baseline | Claude delta |
|---|---|---|---|---|
| Session briefing | Implemented | `before_prompt_build` | Prepends `[ix] Session briefing:` plus the Ix Pro JSON briefing when `workspaceDir` is available and the cached briefing is stale. Cache TTL is 10 minutes per workspace. | Claude triggers on `UserPromptSubmit` and also asks Claude to append a final Ix help summary. OpenClaw only prepends context. |
| Search interception | Not implemented at launch | `before_tool_call` | `Grep`, `Glob`, `Read`, and `Bash` currently receive no Ix-injected context. The handler only records a target path when one is derivable. | Claude front-runs `Grep`/`Glob` and grep-like `Bash` calls with Ix context. OpenClaw does not yet do this. |
| Pre-edit gate | Implemented | `before_tool_call` | For `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` on non-skipped paths, the plugin runs `ix-decide`. `BLOCK` blocks the tool call; `REVIEW` requires approval; `ALLOW` is silent. | Claude's baseline is warning-oriented. OpenClaw can hard-block or force approval. |
| Post-edit ingest | Implemented | `after_tool_call` | After a successful write tool call on a non-skipped path, the plugin runs `ix map <targetPath>` asynchronously. No user-visible output. | Similar to Claude's async post-edit ingest behavior. |
| Session-end map | Implemented | `session_end` | On session end, the plugin runs `ix map` asynchronously in the directory that contains the session file. No user-visible output. | Claude refreshes the graph on `Stop` and also has a separate final Ix annotation hook. OpenClaw only refreshes the graph. |

## Notes

- The launch runtime registers exactly four OpenClaw events: `before_prompt_build`, `before_tool_call`, `after_tool_call`, and `session_end`.
- The `hooks/ix-intercept`, `hooks/ix-read`, and `hooks/ix-bash` directories are present, but their described interception behavior is not wired through `plugins/ix-plugin.ts` at launch.
- Skipped paths for the pre-edit and post-edit hooks include markdown, text, lockfiles, common binary assets, and compiled artifacts.
- All launch hooks fail silently when Ix is unavailable.
