/**
 * ix-pre-edit — before_tool_call hook
 *
 * Fires before Edit/Write/MultiEdit. Runs ix impact on the target file
 * and injects a blast-radius warning when the file has significant dependents.
 */

import {
  ixAvailable,
  ixHealthy,
  runIx,
  parseIxJson,
  captureErrorAsync,
} from "../ix-utils.js";
import { basename } from "node:path";

const SKIP_EXT = /\.(md|txt|lock|png|jpg|gif|ico|pdf|bin)$/;
const SKIP_COMPILED = /(__pycache__|\.pyc|\.class|\.o)$/;

const handler = async (event: any) => {
  if (event.type !== "tool" || event.action !== "before_tool_call") return;

  const toolName = event.context?.toolName;
  if (toolName !== "Edit" && toolName !== "Write" && toolName !== "MultiEdit") return;

  const filePath = event.context?.toolInput?.file_path;
  if (!filePath) return;

  // Skip non-code and config files
  if (SKIP_EXT.test(filePath) || SKIP_COMPILED.test(filePath)) return;

  if (!ixAvailable() || !(await ixHealthy())) return;

  const filename = basename(filePath);

  let impRaw: string;
  try {
    impRaw = await runIx(["impact", filename, "--format", "json"]);
  } catch (e: any) {
    captureErrorAsync("ix", "ix-impact", `ix impact failed for ${filename}`, 1, `ix impact ${filename}`, e.message);
    return;
  }

  if (!impRaw) return;

  const impJson = parseIxJson(impRaw) as any;
  if (!impJson) return;

  const riskLevel = impJson.riskLevel || "unknown";
  const directDeps = impJson.summary?.directDependents || 0;
  const memberCallers = impJson.summary?.memberLevelCallers || 0;
  const riskSummary = impJson.riskSummary || "";
  const topMembers = (impJson.topImpactedMembers || []).slice(0, 3).map((m: any) => m.name).join(", ");
  const nextStep = impJson.nextStep || "";
  const effDeps = Math.max(directDeps, memberCallers);

  // Only warn when impact is meaningful
  if (riskLevel === "unknown" || riskLevel === "low") return;
  if (effDeps < 3) return;

  let prefix: string;
  switch (riskLevel) {
    case "critical":
      prefix = "[ix] CRITICAL EDIT";
      break;
    case "high":
      prefix = "[ix] HIGH-RISK EDIT";
      break;
    case "medium":
      prefix = "[ix] NOTE";
      break;
    default:
      return;
  }

  let warning = `${prefix} — ${filename} has ${effDeps} dependents. ${riskSummary}`;
  if (topMembers) warning += ` Hot spots: ${topMembers}.`;
  if (nextStep) warning += ` → ${nextStep}`;

  event.messages.push(warning);
};

export default handler;
