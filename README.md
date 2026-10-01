# ix-openclaw-plugin

[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2)](https://github.com/sponsors/ix-infrastructure)

An OpenClaw plugin that turns your agent into a **graph-reasoning engineering agent** using [Ix Memory](https://github.com/ix-infrastructure/Ix) as its structured memory backend.

OpenClaw + Ix = reasoning engine + persistent code knowledge graph. Skills are cognitive abstractions (not CLI wrappers) that minimize token usage and maximize accuracy.

## Installation

```bash
openclaw plugins install ix-infrastructure/ix-openclaw-plugin && openclaw gateway restart
```

## Requirements

### Ix Memory backend

[Ix Memory](https://github.com/ix-infrastructure/Ix) must be installed and running:

```bash
ix status   # should return ok
ix map      # index the codebase if not already done
```

### Agent model — gateway-based only

This plugin's tools and skills run through the OpenClaw gateway. **The OpenClaw Codex sandbox harness does not support plugin tools and will not work.** Use any gateway-based model instead:

| Provider | Setup |
|----------|-------|
| **Anthropic** (recommended) | Get a key at [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI platform** | Get a key at [platform.openai.com](https://platform.openai.com) (not a ChatGPT account) |
| **Groq** (free tier) | Get a key at [console.groq.com](https://console.groq.com) |
| **Google Gemini** (free tier) | Get a key at [aistudio.google.com](https://aistudio.google.com) |

### Wiring an agent

**1. Add your API key to the agent's auth-profiles file:**

```bash
# Find your agent's auth file
cat ~/.openclaw/agents/<your-agent-id>/agent/auth-profiles.json
```

Add an entry for your provider (example for Anthropic):

```json
{
  "version": 1,
  "profiles": {
    "anthropic:manual": {
      "type": "token",
      "provider": "anthropic",
      "token": "sk-ant-..."
    }
  }
}
```

**2. Set the model in `~/.openclaw/openclaw.json`:**

Find your agent in `agents.list` and set the model:

```json
{
  "agents": {
    "list": [
      {
        "id": "your-agent-id",
        "workspace": "/path/to/your/project",
        "model": "anthropic/claude-sonnet-4-6"
      }
    ]
  }
}
```

Supported model strings: `anthropic/claude-sonnet-4-6`, `anthropic/claude-opus-4-7`, `openai/gpt-4o`, `groq/llama-3.3-70b-versatile`, `google/gemini-2.0-flash`.

**3. Restart the gateway:**

```bash
openclaw gateway restart
```

**Ix Pro** is optional. All skills and hooks work with basic Ix. Pro adds the session briefing (goals, bugs, decisions) that the plugin prepends to prompts.

## Skills

High-level cognitive skills — each one infers intent, orchestrates multiple graph queries, and synthesizes output. None are CLI aliases.

| Skill | What it does | Key rule |
|-------|-------------|----------|
| `/ix-understand [target]` | Build a mental model of a system or the whole repo | Graph only — no source reads |
| `/ix-investigate <symbol>` | Deep dive: what it is, how it connects, execution path | Graph first, one symbol read max |
| `/ix-impact <target>` | Change risk: blast radius, affected systems, test targets | Depth scales with risk level |
| `/ix-plan <targets...>` | Risk-ordered implementation plan for a set of changes | Parallel impact, finds shared dependents |
| `/ix-debug <symptom>` | Root cause analysis from symptom to candidates | Targeted reads at suspects only |
| `/ix-architecture [scope]` | Design health: coupling, smells, hotspots | Graph only — never reads source |
| `/ix-docs <target> [--full] [--style narrative\|reference\|hybrid] [--split] [--single-doc] [--out <path>]` | Generate narrative-first system documentation with a selective reference layer | Default is onboarding-focused; `--full --style hybrid` gives the deepest coverage |

All skills auto-disable when `ix` is not available (via `requires.bins` gating).

## Agents

Autonomous multi-step agents for complex tasks:

| Agent | Purpose |
|-------|---------|
| `ix-explorer` | General-purpose graph exploration, open-ended questions |
| `ix-system-explorer` | Full architectural model of a codebase or region |
| `ix-bug-investigator` | Autonomous investigation from symptom to root cause candidates |
| `ix-safe-refactor-planner` | Blast radius + safe change sequencing for refactors |
| `ix-architecture-auditor` | Full structural health report with ranked improvements |

## Automatic hooks

All of them are typed plugin hooks (`api.on(...)` in `plugins/ix-plugin.ts`); the
plugin ships no folder hooks.

| Event | Tools | Effect |
|-------|-------|--------|
| `before_prompt_build` | — | Prepends the session briefing (goals, bugs, decisions), fetched at most once per 10 min per workspace — **requires Ix Pro** and `allowConversationAccess` (see Configuration) |
| `before_tool_call` | `edit`, `write`, `apply_patch` | Runs `ix-decide` on the files being written: `BLOCK` blocks the call, `REVIEW` asks you to approve it, `ALLOW` is silent |
| `after_tool_call` | `edit`, `write`, `apply_patch` | Requests the guarded root map (below) |
| `session_end` | — | Requests the guarded root map for the agent workspace |

All hooks bail silently if `ix` is not in PATH or the backend is unreachable.
Search calls (`read`, `exec`) get no Ix context: an OpenClaw `before_tool_call`
handler can block, rewrite or ask for approval, but cannot add context for the
model.

**Guarded root map.** Automatic refresh runs `ix map <git root> --silent` in the
background (with `IX_AUTO_MAP=1`) only when the project is a git repo whose root
is not `$HOME`, `ix status` reports the project is already mapped, and no
automatic map started for that root in the last 5 minutes
(`IX_MAP_DEBOUNCE_SECONDS`). It never creates a workspace — run `ix map` yourself
once per project. Debounce stamps live in `${XDG_STATE_HOME:-~/.local/state}/ix-openclaw-plugin/`.

## Configuration

Plugin config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ix-memory": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true }
      }
    }
  }
}
```

`allowConversationAccess` is needed only for the session briefing: OpenClaw
drops a non-bundled plugin's `before_prompt_build` hook without it (`openclaw
plugins inspect ix-memory --runtime` then reports the hook as blocked). Tools and
the edit hooks work either way.

## Uninstall

```
openclaw plugins uninstall ix-memory
```

## License

[Apache License 2.0](LICENSE)
