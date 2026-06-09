# ix-openclaw-plugin

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

**Ix Pro** is optional. All skills and hooks work with basic Ix. Pro adds session briefing injection (goals, bugs, decisions) via the `ix-briefing` hook.

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

| Event | Hook | Effect |
|-------|------|--------|
| `message:received` | `ix-briefing` | Injects session briefing (goals, bugs, decisions) once per 10 min — **requires Ix Pro** |
| `before_tool_call` (Grep/Glob) | `ix-intercept` | Front-runs with `ix text` + `ix locate`/`ix inventory` |
| `before_tool_call` (Read) | `ix-read` | Front-runs with `ix inventory` + `ix overview` for the file |
| `before_tool_call` (Bash grep/rg) | `ix-bash` | Extracts pattern, front-runs with `ix text` + `ix locate` |
| `before_tool_call` (Edit/Write) | `ix-pre-edit` | Runs `ix impact` before the edit |
| `tool_result_persist` (Edit/Write) | `ix-ingest` | Runs `ix map <file>` to update the graph (async) |
| `agent_end` | `ix-map` | Runs `ix map` to refresh the full graph (async) |

All hooks bail silently if `ix` is not in PATH or the backend is unreachable.

## Configuration

Plugin config in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "ix-memory": {
        "enabled": true
      }
    }
  }
}
```

## Uninstall

```
openclaw plugins uninstall ix-memory
```

## License

[Apache License 2.0](LICENSE)
