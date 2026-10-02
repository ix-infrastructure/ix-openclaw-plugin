// Copyright 2026 Ix Infrastructure Inc.

/**
 * How much of the session briefing goes into a prompt, and how often.
 *
 * `before_prompt_build` (plugins/ix-plugin.ts) is the only path that injects
 * the briefing. Its `getBriefing` cache stops `ix briefing` from re-running,
 * but on its own it did not stop the injection: the same ~1.3 KB was prepended
 * on every prompt build for the whole window, to a model that had already read
 * it. The claim below makes it once per window per workspace.
 *
 * The claim is in-process state, not a file. A file marker existed only to
 * share the claim with the `message:received` folder hook, which ran in another
 * runtime; that hook is gone. A prompt build runs its hooks in the process that
 * loaded this plugin. The only other processes OpenClaw runs sessions in are
 * `openclaw worker` processes, created per session with a private temporary
 * state dir and possibly on another machine, so a per-user file would not be
 * shared with them either.
 */

/** One injection per workspace per this window. Matches getBriefing's cache. */
export const BRIEFING_TTL_MS = 10 * 60 * 1000;

/** The most of a briefing that is put into a prompt. */
export const BRIEFING_MAX_CHARS = 2_000;

// workspace root -> when its briefing was claimed (ms since epoch).
const claims = new Map<string, number>();

/**
 * Claim this window's briefing injection for `workspaceDir`.
 *
 * Returns the claim time if the caller may inject, or null if a claim made
 * within the last `ttl` ms still holds. The claim is taken before the caller
 * awaits anything, so two prompt builds that overlap cannot both inject; a
 * caller that ends up with nothing to inject hands it back with
 * `releaseBriefingClaim`, so a failed or empty `ix briefing` does not use up
 * the window. Keyed by workspace, so one project's window never suppresses
 * another's.
 */
export function claimBriefing(
  workspaceDir: string,
  now: number = Date.now(),
  ttl: number = BRIEFING_TTL_MS
): number | null {
  const claimedAt = claims.get(workspaceDir);
  if (claimedAt !== undefined && now - claimedAt < ttl) return null;
  claims.set(workspaceDir, now);
  return now;
}

/** Give back a claim that did not end in an injection. */
export function releaseBriefingClaim(workspaceDir: string, claimedAt: number): void {
  if (claims.get(workspaceDir) === claimedAt) claims.delete(workspaceDir);
}

/** Forget every claim. For tests. */
export function resetBriefingClaims(): void {
  claims.clear();
}

/**
 * Trim a briefing to something a prompt can carry.
 *
 * A briefing grows with the project -- goals, plans, recent decisions -- and it
 * is injected unread, so nothing downstream bounds it.
 */
export function capBriefing(text: string, limit: number = BRIEFING_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}\n… (briefing truncated; run \`ix briefing\` for the rest)`;
}
