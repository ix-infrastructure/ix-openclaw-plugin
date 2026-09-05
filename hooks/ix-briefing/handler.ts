/**
 * ix-briefing — message:received hook
 *
 * Injects a compact Ix session briefing once per 10 minutes.
 * Requires Ix Pro — no-op if Pro is unavailable.
 */

import {
  ixAvailable,
  ixHealthy,
  runIx,
  readCache,
  writeCache,
  captureErrorAsync,
  BRIEFING_TTL,
  PRO_TTL,
} from "../ix-utils.js";

const handler = async (event: any) => {
  if (event.type !== "message" || event.action !== "received") return;
  if (!ixAvailable()) return;

  // Check briefing cache freshness
  const cached = readCache("ix-briefing", BRIEFING_TTL);
  if (cached) return;

  if (!(await ixHealthy())) return;

  // Skip fast if a previous run established Pro is unavailable.
  if (readCache("ix-pro-check", PRO_TTL) === "0") return;

  // No separate `--help` probe. Pro commands are always *registered* — without
  // @ix/pro the CLI installs a stub whose action prints "requires Ix Pro" and
  // exits non-zero — but --help is handled before any action runs, so
  // `ix briefing --help` succeeded on a stub exactly as on the real command.
  // That reported Pro as available on every OSS install. Running the briefing
  // we actually want is both the discriminator and the payload, so it also
  // saves an ix invocation.
  try {
    const briefing = await runIx(["briefing", "--format", "json"]);
    writeCache("ix-pro-check", "1");
    if (!briefing.trim()) return;

    writeCache("ix-briefing", briefing);

    event.messages.push(`[ix] Session briefing:\n${briefing}`);
  } catch (err: any) {
    const message = String(err?.message ?? "");
    if (/requires Ix Pro/i.test(message)) {
      // Definitively not a Pro install: cache the negative and stay quiet.
      writeCache("ix-pro-check", "0");
      return;
    }
    // Anything else is a transient failure. Do NOT poison the Pro cache with
    // it, or one backend hiccup would suppress briefings for a Pro user until
    // PRO_TTL expires.
    captureErrorAsync("ix", "ix-briefing", "ix briefing failed", 1, "ix briefing", message);
  }
};

export default handler;
