// Copyright 2026 Ix Infrastructure Inc.

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
  briefingAlreadyInjected,
  markBriefingInjected,
  capBriefing,
  PRO_TTL,
} from "../ix-utils.js";

const handler = async (event: any) => {
  if (event.type !== "message" || event.action !== "received") return;
  if (!ixAvailable()) return;

  // One injection per window, across both paths that do it — the plugin's
  // before_prompt_build injects the same briefing, and used to do it on every
  // prompt build.
  if (briefingAlreadyInjected()) return;

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
    // text, not json: this is injected into a prompt for the model to read,
    // never parsed. Measured on a real graph, the same briefing is 4,352 bytes
    // as json and 1,305 as text. Not `llm` — briefing has no record renderer,
    // which is why it is absent from runtime/llm.ts's version table, and `llm`
    // routes to exactly this text anyway. Explicit, because the CLI's default
    // format is configurable (IX_FORMAT / config.format).
    const briefing = await runIx(["briefing", "--format", "text"]);
    writeCache("ix-pro-check", "1");
    const text = capBriefing(briefing);
    if (!text) return;

    writeCache("ix-briefing", text);
    markBriefingInjected();

    event.messages.push(`[ix] Session briefing:\n${text}`);
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
