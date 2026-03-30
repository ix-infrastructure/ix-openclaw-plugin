/**
 * ix-bash — before_tool_call hook
 *
 * Fires before Bash. Detects grep/rg commands and front-runs with
 * ix text + ix locate for graph-aware context.
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
  if (event.context?.toolName !== "Bash") return;

  const command = event.context?.toolInput?.command;
  if (!command) return;

  // Only intercept grep/rg invocations
  if (!/^\s*(grep|rg)\s/.test(command)) return;

  if (!ixAvailable() || !(await ixHealthy())) return;

  // Extract search pattern from command
  let pattern = "";
  let match = command.match(/\s"([^"]+)"/);
  if (match) {
    pattern = match[1];
  } else {
    match = command.match(/\s'([^']+)'/);
    if (match) {
      pattern = match[1];
    } else {
      match = command.match(/^\s*(?:grep|rg)\s+(?:-[a-zA-Z0-9]+\s+|--[a-zA-Z-]+=\S+\s+)*([^-][^ ]*)/);
      if (match) pattern = match[1];
    }
  }

  if (!pattern || pattern.length < 3) return;

  const isPlain = !/[\\^$[\](){}|*+?]/.test(pattern);

  const promises: Promise<string>[] = [
    runIx(["text", pattern, "--limit", "15", "--format", "json"]).catch((e) => {
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

  const parts: string[] = [`[ix] bash grep intercepted for '${pattern}'`];

  // Summarize symbol results
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

  parts.push(`Prefer: ix text '${pattern}' or ix locate '${pattern}' over shell grep`);
  event.messages.push(parts.join(" | "));
};

export default handler;
