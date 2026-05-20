#!/usr/bin/env bash
# test-local.sh — Validate ix-openclaw-plugin structure and hook readiness
# Run from anywhere: bash ~/ix/ix-openclaw-plugin/test-local.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ok()   { echo "  [ok] $*"; }
fail() { echo "  [FAIL] $*"; FAILURES=$((FAILURES+1)); }
info() { echo "  ---  $*"; }

FAILURES=0

echo ""
echo "═══════════════════════════════════════════"
echo "  ix-openclaw-plugin — local validation"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. Prereqs ────────────────────────────────────────────────────────────────
echo "── Checking prereqs ──"

[ -d "$REPO" ] && ok "dev repo found: $REPO" || { fail "dev repo not found: $REPO"; exit 1; }
command -v jq  >/dev/null 2>&1 && ok "jq"   || { fail "jq not in PATH"; exit 1; }
command -v npm >/dev/null 2>&1 && ok "npm"  || { fail "npm not in PATH"; exit 1; }
command -v ix  >/dev/null 2>&1 && ok "ix"   || fail "ix not in PATH — hook tests will be skipped"
IX_OK=$(command -v ix >/dev/null 2>&1 && echo 1 || echo 0)

echo ""

# ── 2. Validate manifest ────────────────────────────────────────────────────
echo "── Validating manifest ──"

MANIFEST="$REPO/openclaw.plugin.json"
jq -e . "$MANIFEST" >/dev/null 2>&1 \
  && ok "openclaw.plugin.json is valid JSON" \
  || fail "openclaw.plugin.json is invalid JSON"

PLUGIN_ID=$(jq -r '.id' "$MANIFEST" 2>/dev/null || echo "")
[ "$PLUGIN_ID" = "ix-memory" ] \
  && ok "plugin id: $PLUGIN_ID" \
  || fail "unexpected plugin id: $PLUGIN_ID"

PLUGIN_VERSION=$(jq -r '.version' "$MANIFEST" 2>/dev/null || echo "")
[ -n "$PLUGIN_VERSION" ] \
  && ok "plugin version: $PLUGIN_VERSION" \
  || fail "missing plugin version"

echo ""

# ── 3. Validate workspace files ──────────────────────────────────────────────
echo "── Checking workspace files ──"

[ -f "$REPO/SOUL.md" ]   && ok "SOUL.md"   || fail "missing SOUL.md"
[ -f "$REPO/AGENTS.md" ] && ok "AGENTS.md" || fail "missing AGENTS.md"
[ ! -f "$REPO/CLAUDE.md" ] && ok "CLAUDE.md removed" || fail "stale CLAUDE.md still present"
[ ! -d "$REPO/.claude-plugin" ] && ok ".claude-plugin/ removed" || fail "stale .claude-plugin/ still present"

echo ""

# ── 4. Validate skills ──────────────────────────────────────────────────────
echo "── Skills ──"
for skill in ix-understand ix-investigate ix-impact ix-plan ix-debug ix-architecture ix-docs ix-help; do
  SKILL_FILE="$REPO/skills/$skill/SKILL.md"
  if [ -f "$SKILL_FILE" ]; then
    # Check for OpenClaw metadata
    grep -q 'metadata:' "$SKILL_FILE" \
      && ok "$skill (with metadata)" \
      || fail "$skill: missing OpenClaw metadata"
  else
    fail "missing: skills/$skill/SKILL.md"
  fi
done

echo ""

# ── 5. Validate agents ──────────────────────────────────────────────────────
echo "── Agents ──"
for agent in ix-explorer ix-system-explorer ix-bug-investigator ix-safe-refactor-planner ix-architecture-auditor; do
  [ -f "$REPO/agents/$agent.md" ] && ok "$agent" || fail "missing: agents/$agent.md"
done

echo ""

# ── 6.5 Validate installers and package wiring ──────────────────────────────
echo "── Installers and package wiring ──"
[ -f "$REPO/install.sh" ]  && ok "install.sh"  || fail "missing install.sh"
[ -f "$REPO/install.ps1" ] && ok "install.ps1" || fail "missing install.ps1"

grep -q "./dist/plugins/ix-plugin.js" "$REPO/package.json" \
  && ok "package.json points OpenClaw at built dist entry" \
  || fail "package.json does not point OpenClaw at dist/plugins/ix-plugin.js"

echo ""

# ── 6. Validate hooks ───────────────────────────────────────────────────────
echo "── Hooks ──"
for hook in ix-briefing ix-intercept ix-read ix-bash ix-pre-edit ix-ingest ix-map; do
  HOOK_DIR="$REPO/hooks/$hook"
  if [ -d "$HOOK_DIR" ]; then
    [ -f "$HOOK_DIR/HOOK.md" ]    && ok "$hook/HOOK.md"    || fail "$hook: missing HOOK.md"
    [ -f "$HOOK_DIR/handler.ts" ] && ok "$hook/handler.ts" || fail "$hook: missing handler.ts"
  else
    fail "missing hook directory: hooks/$hook/"
  fi
done

[ -f "$REPO/hooks/ix-utils.ts" ] \
  && ok "ix-utils.ts (shared utilities)" \
  || fail "missing: hooks/ix-utils.ts"

echo ""

# ── 7. Check for stale files ────────────────────────────────────────────────
echo "── Checking for stale files ──"
STALE=0
for f in "$REPO/hooks/"*.sh "$REPO/hooks/hooks.json"; do
  if [ -f "$f" ]; then
    fail "stale file: $(basename "$f")"
    STALE=1
  fi
done
[ "$STALE" -eq 0 ] && ok "no stale shell hooks or hooks.json"

echo ""

# ── 8. Ix health check ──────────────────────────────────────────────────────
echo "── Ix status ──"
if [ "$IX_OK" = "1" ]; then
  ix status >/dev/null 2>&1 \
    && ok "ix status: healthy" \
    || fail "ix status: unhealthy — hooks will bail silently"
else
  info "ix not available — skipping health check"
fi

echo ""

# ── 8.5 Run Node test suite ─────────────────────────────────────────────────
echo "── Node test suite ──"
if (cd "$REPO" && npm test >/dev/null 2>&1); then
  ok "npm test"
else
  fail "npm test failed"
fi

echo ""

# ── 9. Summary ───────────────────────────────────────────────────────────────
echo "── Summary ──"
echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "  ✓ All checks passed."
  echo ""
  echo "  Install the plugin locally:"
  echo ""
  echo "    ./install.sh"
  echo ""
  echo "  Then try:"
  echo ""
  echo "    /ix-understand                  ← full repo mental model"
  echo "    /ix-investigate <symbol>        ← deep dive into a component"
  echo "    /ix-impact <file or symbol>     ← blast radius before editing"
  echo "    /ix-debug <symptom>             ← root cause analysis"
  echo "    /ix-architecture                ← design health audit"
  echo "    /ix-docs <target>               ← narrative-first system documentation"
  echo ""
else
  echo "  ✗ $FAILURES check(s) failed — see [FAIL] lines above."
fi

echo ""
exit $FAILURES
