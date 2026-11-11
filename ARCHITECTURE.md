# Architecture

How the `ix-memory` OpenClaw plugin is built today. For install and usage see
[README.md](./README.md); for the working rules of agents editing this repo see
[AGENTS.md](./AGENTS.md).

## What OpenClaw loads

| Piece | Declared in | Loaded by |
|---|---|---|
| Plugin entry `dist/plugins/ix-plugin.js` (built from `plugins/ix-plugin.ts`) | `package.json` → `openclaw.extensions` | OpenClaw's plugin loader, at gateway start (`activation.onStartup`) |
| 17 tools (`ix-query` … `ix-smells`) | `openclaw.plugin.json` → `contracts.tools`; registered by the entry | The entry calls `api.registerTool` once per module in `tools/` |
| Hooks | Registered by the entry with `api.on(...)` | OpenClaw's hook runner. There are no folder hooks |
| Skills (`skills/<name>/SKILL.md`) | `openclaw.plugin.json` → `skills: ["skills"]` | OpenClaw's skills loader. Each skill gates on `requires.bins: ["ix"]` |

Nothing else in the repository reaches an agent. `AGENTS.md` is read by
OpenClaw only from an agent's workspace, so it applies when the workspace is
this repo; it is not installed with the plugin. The manifest has no field for
agent prompts, so the plugin ships none.

## Entry point

`plugins/ix-plugin.ts` exports one `definePluginEntry({ id: "ix-memory", register })`.
`register(api)`:

1. Registers every tool module as a factory. The factory reads the agent
   workspace from the tool context and passes it to the tool as `directory`
   (falling back to the process working directory).
2. Registers four hooks (below).

## Hooks

| Event | Matcher | What it does |
|---|---|---|
| `before_prompt_build` | — | Prepends `[ix] Session briefing:` with the output of `ix briefing --format text`, capped at 2,000 characters, at most once per 10 minutes per workspace (`runtime/briefing.ts`). Needs Ix Pro, and OpenClaw drops the hook unless `allowConversationAccess` is set |
| `before_tool_call` | `edit`, `write`, `apply_patch` | The pre-edit gate. Resolves the files the call writes (`runtime/host-tools.ts`), runs the `ix-decide` tool on them (one `ix impact <file> --format json` per file, 8 s cap overall), and on `REVIEW` returns `requireApproval` (allow once or deny). `ALLOW`, or a file Ix cannot assess, is silent |
| `after_tool_call` | `edit`, `write`, `apply_patch` | On success, requests the guarded root map for each written file's directory |
| `session_end` | — | Requests the guarded root map for the agent workspace |

Every hook stays silent when `ix` is missing or the backend is down.

## Data flow

```
OpenClaw agent ──tool call──▶ tools/<name>.ts ──execFile──▶ ix CLI ──▶ Ix backend
                ◀─markdown──                  ◀──json / llm text──
```

- Every Ix read and write goes through the `ix` CLI (`runIx` in
  `tools/base.ts`, `execFile("ix", args, { cwd })`, 60 s default timeout). No
  code calls the backend over HTTP: the CLI scopes requests to the workspace
  and carries the token.
- Tools ask for `--format json` and render markdown. Where the installed CLI
  is new enough, `runtime/llm.ts` asks for `--format llm` instead and keeps the
  tool's own header. The CLI version is probed once per process.
  `runtime/secrets.ts` redacts secrets from that text.
- The guarded root map (`runtime/auto-map.ts`) is the only automatic
  `ix map`. It runs `ix map <git root> --silent` detached, with `IX_AUTO_MAP=1`,
  only for a git repo whose root is not `$HOME`, that `ix status` reports as
  already mapped, and that has not been auto-mapped within the debounce
  window (`IX_MAP_DEBOUNCE_SECONDS`, default 300).

## State

| State | Where | Lifetime |
|---|---|---|
| Auto-map debounce stamps | `${XDG_STATE_HOME:-~/.local/state}/ix-openclaw-plugin/` (directory mode 0700), one file per hashed git root | On disk |
| Briefing cache and once-per-window claim | Module memory in `plugins/ix-plugin.ts` and `runtime/briefing.ts` | Gateway process |
| Paths of pending write calls (for `after_tool_call`) | Module memory in `plugins/ix-plugin.ts`, capped at 256 | Gateway process |
| ix CLI version probe | Module memory in `runtime/llm.ts` | Gateway process |

The graph itself, decisions and smells live in the Ix backend, not in the plugin.

## Tests

`npm test` builds and runs `tests/*.test.mjs`; the tool and hook tests use a
fake `ix` (`tests/fake-ix.mjs`). `tests/real-ix/` holds checks against a real
ix and backend. `tests/docs-layout.test.mjs` keeps this file, the shipped
files and the document links in step with the code.

## Historical documents

`PLUGIN_SPEC.md`, `ROADMAP.md` and `OpenClawPlatformSurvey.md` are the May
2026 plan and platform survey. They are superseded by this file and kept only
as a record.
