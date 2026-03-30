/**
 * ix-intercept — before_tool_call hook
 *
 * Fires before Grep/Glob. Runs ix text + ix locate/inventory in parallel
 * and injects a concise one-line summary as context.
 */

import {
  ixAvailable,
  ixHealthy,
  runIx,
  parseIxJson,
  captureErrorAsync,
} from "../ix-utils.js";

const handler = async (event: any) => {
  if (event.type !== "tool" || event.action !== "before_tool_call") return;

  const toolName = event.context?.toolName;
  if (toolName !== "Grep" && toolName !== "Glob") return;
  if (!ixAvailable() || !(await ixHealthy())) return;

  const input = event.context?.toolInput ?? {};

  if (toolName === "Grep") {
    await handleGrep(event, input);
  } else if (toolName === "Glob") {
    await handleGlob(event, input);
  }
};

async function handleGrep(event: any, input: any) {
  const pattern = input.pattern;
  if (!pattern || pattern.length < 3) return;

  const textArgs = [pattern, "--limit", "15", "--format", "json"];
  if (input.path) textArgs.push("--path", input.path);
  if (input.type) textArgs.push("--language", input.type);

  const isPlain = !/[\\^$[\](){}|*+?]/.test(pattern);

  const promises: Promise<string>[] = [
    runIx(["text", ...textArgs]).catch((e) => {
      captureErrorAsync("ix", "ix-text", "text search failed", 1, `ix text '${pattern}'`, e.message);
      return "";
    }),
  ];

  if (isPlain) {
    promises.push(
      runIx(["locate", pattern, "--limit", "5", "--format", "json"]).catch((e) => {
        captureErrorAsync("ix", "ix-locate", "locate failed", 1, `ix locate '${pattern}'`, e.message);
        return "";
      }),
    );
  }

  const [textRaw, locRaw] = await Promise.all(promises);
  if (!textRaw && !locRaw) return;

  const parts: string[] = [`[ix] '${pattern}'`];

  // Summarize locate results
  if (locRaw) {
    const locJson = parseIxJson(locRaw) as any;
    if (locJson?.resolvedTarget?.name) {
      const kind = locJson.resolvedTarget.kind || "";
      const file = (locJson.resolvedTarget.path || "").split("/").pop() || "";
      parts.push(`symbol: ${locJson.resolvedTarget.name} (${kind}${file ? `, ${file}` : ""})`);
    } else if (locJson?.candidates?.length) {
      const cands = locJson.candidates
        .slice(0, 3)
        .map((c: any) => `${c.name} (${c.kind})`)
        .join(", ");
      parts.push(`candidates: ${cands}`);
    }
  }

  // Summarize text results
  if (textRaw) {
    const textJson = parseIxJson(textRaw) as any[];
    if (Array.isArray(textJson) && textJson.length > 0) {
      const files = [...new Set(textJson.map((r: any) => (r.path || "").split("/").pop()))].slice(0, 4).join(", ");
      const more = textJson.length > 4 ? ` (+${textJson.length - 4} more)` : "";
      parts.push(`${textJson.length} text hits in ${files}${more}`);
    }
  }

  if (parts.length <= 1) return;

  parts.push("Use ix explain/trace/impact for deeper analysis, ix read <symbol> for source");
  event.messages.push(parts.join(" | "));
}

async function handleGlob(event: any, input: any) {
  const pathArg = input.path;
  if (!pathArg) return;

  try {
    const invRaw = await runIx(["inventory", "--format", "json", "--path", pathArg]);
    if (!invRaw) return;

    const invJson = parseIxJson(invRaw) as any;
    if (!invJson) return;

    const total = invJson.summary?.total ?? invJson.results?.length ?? 0;
    if (total === 0) return;

    const sample = (invJson.results || [])
      .slice(0, 5)
      .map((r: any) => r.name)
      .join(", ");

    const pattern = input.pattern || "";
    const ctx = `[ix] glob '${pattern}' in ${pathArg}: ${total} entities — ${sample}${total > 5 ? " ..." : ""}`;
    event.messages.push(ctx);
  } catch (e: any) {
    captureErrorAsync("ix", "ix-inventory", "inventory failed", 1, `ix inventory '${pathArg}'`, e.message);
  }
}

export default handler;
