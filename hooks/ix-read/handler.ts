/**
 * ix-read — before_tool_call hook
 *
 * Fires before Read. Runs ix inventory + ix overview + ix impact in parallel
 * and injects a concise summary with key entities and risk level.
 */

import {
  ixAvailable,
  ixHealthy,
  runIx,
  parseIxJson,
  readCache,
  writeCache,
  captureErrorAsync,
  READ_CACHE_TTL,
} from "../ix-utils.js";
import { basename } from "node:path";
import { createHash } from "node:crypto";

const SKIP_EXT = /\.(png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|bin|exe)$/;
const SKIP_PATH = /\/(node_modules|\.git|dist|build|generated|__pycache__)\//;
const SKIP_LOCK = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|go\.sum|Cargo\.lock)$/;

const handler = async (event: any) => {
  if (event.type !== "tool" || event.action !== "before_tool_call") return;
  if (event.context?.toolName !== "Read") return;

  const filePath = event.context?.toolInput?.file_path;
  if (!filePath) return;

  // Skip binary/generated/vendor/lock files
  if (SKIP_EXT.test(filePath) || SKIP_PATH.test(filePath) || SKIP_LOCK.test(filePath)) return;

  if (!ixAvailable() || !(await ixHealthy())) return;

  // Per-file TTL cache (5 min) — avoid repeating context for the same file
  const fileKey = createHash("md5").update(filePath).digest("hex");
  if (readCache(`read-${fileKey}`, READ_CACHE_TTL)) return;
  writeCache(`read-${fileKey}`, "1");

  const filename = basename(filePath);

  const [invRaw, ovRaw, impRaw] = await Promise.all([
    runIx(["inventory", "--kind", "file", "--path", filename, "--format", "json"]).catch((e) => {
      captureErrorAsync("ix", "ix-inventory", "inventory failed", 1, `ix inventory ${filename}`, e.message);
      return "";
    }),
    runIx(["overview", filename, "--format", "json"]).catch((e) => {
      captureErrorAsync("ix", "ix-overview", "overview failed", 1, `ix overview ${filename}`, e.message);
      return "";
    }),
    runIx(["impact", filename, "--format", "json"]).catch((e) => {
      captureErrorAsync("ix", "ix-impact", "impact failed", 1, `ix impact ${filename}`, e.message);
      return "";
    }),
  ]);

  if (!invRaw && !ovRaw) return;

  // Summarize overview: key definitions + children
  const ovJson = parseIxJson(ovRaw) as any;
  let entityPart = "";
  if (ovJson) {
    const keyItems = (ovJson.keyItems || []).slice(0, 5).map((i: any) => i.name).join(", ");
    const children = Object.entries(ovJson.childrenByKind || {})
      .map(([kind, count]) => `${count} ${kind}`)
      .join(", ");
    if (keyItems) {
      entityPart = `key: ${keyItems}`;
      if (children) entityPart += ` (${children})`;
    }
  }

  // Summarize impact: risk warning
  const impJson = parseIxJson(impRaw) as any;
  let riskPart = "";
  if (impJson) {
    const riskLevel = impJson.riskLevel || "unknown";
    const directDeps = impJson.summary?.directDependents || 0;
    const memberCallers = impJson.summary?.memberLevelCallers || 0;
    const effDeps = Math.max(directDeps, memberCallers);

    if (effDeps > 2 && riskLevel !== "low" && riskLevel !== "unknown") {
      if (riskLevel === "critical") riskPart = `CRITICAL: ${effDeps} dependents`;
      else if (riskLevel === "high") riskPart = `HIGH RISK: ${effDeps} dependents`;
      else if (riskLevel === "medium") riskPart = `${effDeps} dependents`;
    }
  }

  if (!entityPart && !riskPart) return;

  const parts = [`[ix] ${filename}`];
  if (entityPart) parts.push(entityPart);
  if (riskPart) parts.push(riskPart);
  parts.push("Use ix read <symbol> to get just a symbol's source instead of the full file");

  event.messages.push(parts.join(" | "));
};

export default handler;
