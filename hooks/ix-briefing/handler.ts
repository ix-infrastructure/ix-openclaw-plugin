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
} from "../ix-utils.js";

const handler = async (event: any) => {
  if (event.type !== "message" || event.action !== "received") return;
  if (!ixAvailable()) return;

  // Check briefing cache freshness
  const cached = readCache("ix-briefing", BRIEFING_TTL);
  if (cached) return;

  if (!(await ixHealthy())) return;

  // Check if Ix Pro is available
  const proCache = readCache("ix-pro-check", 30_000);
  let isPro = proCache === "1";
  if (!proCache) {
    try {
      await runIx(["briefing", "--help"]);
      writeCache("ix-pro-check", "1");
      isPro = true;
    } catch {
      writeCache("ix-pro-check", "0");
      return;
    }
  }
  if (!isPro) return;

  try {
    const briefing = await runIx(["briefing", "--format", "json"]);
    if (!briefing.trim()) return;

    writeCache("ix-briefing", briefing);

    event.messages.push(`[ix] Session briefing:\n${briefing}`);
  } catch (err: any) {
    captureErrorAsync("ix", "ix-briefing", "ix briefing failed", 1, "ix briefing", err.message);
  }
};

export default handler;
