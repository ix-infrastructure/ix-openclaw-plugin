// Copyright 2026 Ix Infrastructure Inc.

/**
 * A strict fake `ix` for tests.
 *
 * Strict where the real CLI is strict, so a regression to an argv the real CLI
 * rejects fails here too instead of being swallowed by a stub that accepts
 * anything:
 *
 *   ix map <non-directory>   -> exit 1, "Map path is not a directory"
 *   ix locate ... --limit    -> exit 1, "unknown option '--limit'"
 *   ix smells ... --path     -> exit 1, "unknown option '--path'"
 *   ix bugs | ix connect     -> exit 1, "unknown command"
 *
 * Every invocation is appended to `calls.log` as one JSON line
 * ({argv, cwd, autoMap}). `ix status --format json --root <r>` reports
 * graphCompleted=true only for roots listed in `mapped-roots` (one per line).
 * `ix impact <target>` answers from `impact.json` when a test set one, and
 * otherwise with the low-risk record the real CLI prints for a file nothing
 * depends on. Build canned answers with `impactRecord()`, which gives the real
 * shape; a canned record in the old `risk`/`dependentCount` shape, which no
 * released ix ever printed, fails loudly, so no test can pass on fields ix
 * never sends.
 * `ix briefing` answers from `briefing.txt` (text|json only, like @ix/pro) and
 * fails as if Ix Pro were absent when no test set one.
 *
 * Nothing here talks to a backend: the fake never maps anything.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = `#!/bin/sh
dir=$(dirname "$0")
node "$dir/fake-ix-impl.mjs" "$@"
`;

const IMPL = `
import { appendFileSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
appendFileSync(
  path.join(dir, "calls.log"),
  JSON.stringify({ argv, cwd: process.cwd(), autoMap: process.env.IX_AUTO_MAP ?? null }) + "\\n"
);

function fail(message) {
  process.stderr.write(message + "\\n");
  process.exit(1);
}

const [command, ...rest] = argv;
const has = (flag) => rest.includes(flag);

// setUnmapped(): graph reads answer as the real CLI does where no workspace
// covers the directory -- an error record on stdout, exit 1.
let unmapped = false;
try { statSync(path.join(dir, "unmapped")); unmapped = true; } catch {}
if (unmapped && ["locate", "overview", "stats", "impact", "explain", "inventory"].includes(command)) {
  process.stdout.write(JSON.stringify({ error: "workspace_not_mapped", message: "No workspace covers this directory. Run ix map." }) + "\\n");
  process.exit(1);
}

// setUnreachable(): every backend call fails as the real CLI (v0.12.0) does in
// a registered workspace with its backend down -- nothing on stdout, the
// reason on stderr (in ANSI red), exit 1. Only --version and the ripgrep-backed \`text\`
// work without a backend.
let unreachable = false;
try { statSync(path.join(dir, "unreachable")); unreachable = true; } catch {}
if (unreachable && command !== "--version" && command !== "text") {
  // Coloured, as the real CLI's stderr is even when piped.
  fail("\\u001b[31mError: fetch failed (bad port)\\u001b[39m");
}

const DEFAULT_IMPACT = ${JSON.stringify(impactRecord())};

switch (command) {
  case "map": {
    const positional = rest.filter((arg) => !arg.startsWith("-"));
    const target = positional[0];
    if (target !== undefined) {
      let isDir = false;
      try { isDir = statSync(path.resolve(process.cwd(), target)).isDirectory(); } catch {}
      if (!isDir) fail("Map path is not a directory: " + target);
    }
    process.stdout.write("mapped\\n");
    break;
  }
  case "locate":
    if (has("--limit")) fail("error: unknown option '--limit'");
    process.stdout.write(JSON.stringify({ resolvedTarget: null }) + "\\n");
    break;
  case "smells":
    if (has("--path")) fail("error: unknown option '--path'");
    process.stdout.write(rest.includes("llm") ? "smells none\\n" : JSON.stringify({ candidates: [], count: 0 }) + "\\n");
    break;
  case "status": {
    const rootIndex = rest.indexOf("--root");
    const root = rootIndex >= 0 ? rest[rootIndex + 1] : process.cwd();
    let mapped = [];
    try { mapped = readFileSync(path.join(dir, "mapped-roots"), "utf8").split("\\n").filter(Boolean); } catch {}
    const graphCompleted = mapped.includes(root);
    process.stdout.write(JSON.stringify({ backend: "ok", graphCompleted, mapCompleted: graphCompleted }) + "\\n");
    break;
  }
  case "bugs":
  case "connect":
    fail("error: unknown command '" + command + "'");
    break;
  case "impact": {
    // Canned per-target answers from impact.json ({"<target>": {...}}), else {}.
    let canned = {};
    try { canned = JSON.parse(readFileSync(path.join(dir, "impact.json"), "utf8")); } catch {}
    const target = rest.find((arg) => !arg.startsWith("-") && arg !== "json");
    // "FAIL": answer as the real CLI does for a file it cannot measure.
    if (canned[target] === "FAIL") {
      process.stdout.write(JSON.stringify({ error: "workspace_not_mapped", message: "No workspace covers this directory." }) + "\\n");
      process.exit(1);
    }
    // A canned error record ({"error": ...}) is printed and exits 1, as the
    // real CLI does for every record it reports as an error.
    if (canned[target] && typeof canned[target] === "object" && "error" in canned[target]) {
      process.stdout.write(JSON.stringify(canned[target]) + "\\n");
      process.exit(1);
    }
    const record = canned[target] ?? DEFAULT_IMPACT;
    if ("risk" in record || "dependentCount" in record || "subsystems" in record) {
      fail("fake ix: canned impact record uses fields no released ix prints (risk/dependentCount/subsystems); use impactRecord()");
    }
    process.stdout.write(JSON.stringify(record) + "\\n");
    break;
  }
  case "callers": {
    // Canned rows from callers.json ({"<target>": [{name, kind, path}]}), in
    // the real \`results\` shape; nothing canned answers with no callers.
    let canned = {};
    try { canned = JSON.parse(readFileSync(path.join(dir, "callers.json"), "utf8")); } catch {}
    const target = rest.find((arg) => !arg.startsWith("-") && arg !== "json" && !/^\\d+$/.test(arg));
    process.stdout.write(JSON.stringify({ results: canned[target] ?? [], resultSource: "graph" }) + "\\n");
    break;
  }
  case "briefing": {
    // @ix/pro declares text|json only. No briefing.txt means Pro is absent.
    const formatIndex = rest.indexOf("--format");
    const format = formatIndex >= 0 ? rest[formatIndex + 1] : "text";
    if (format !== "text" && format !== "json") fail("error: invalid format '" + format + "'");
    let briefing;
    try { briefing = readFileSync(path.join(dir, "briefing.txt"), "utf8"); } catch {
      fail("ix briefing requires Ix Pro");
    }
    process.stdout.write(format === "json" ? JSON.stringify({ briefing }) + "\\n" : briefing);
    break;
  }
  case "--version":
    process.stdout.write("0.11.1\\n");
    break;
  default:
    process.stdout.write("{}\\n");
}
`;

/**
 * An `ix impact <file> --format json` record in the shape the released CLI
 * prints (v0.12.0 and main, ix-cli/src/cli/commands/impact.ts containerImpact),
 * captured from a real run against a throwaway backend. A file resolves as a
 * container, so its counts are `summary.{members, directImporters,
 * directDependents, memberLevelCallers}`; a symbol (`kind` other than "file")
 * resolves as a leaf and has `summary.{callers, callees}` instead; the regions its dependents sit in
 * are `propagationBuckets[].region`. There is no `risk`, `dependentCount`
 * or `subsystems` field.
 */
export function impactRecord({
  riskLevel = "low",
  kind = "file",
  name = "core.ts",
  members = 2,
  importers = 0,
  dependents = 0,
  memberCallers = 0,
  callers = 0,
  callees = 0,
  regions = [],
} = {}) {
  const record = {
    resolvedTarget: { kind, name },
    depth: 1,
    systemPath: [{ name: "Core", kind: "region" }],
    riskSummary: riskLevel === "low" ? "Low risk — localized impact with limited propagation." : "High risk — widely shared dependency affecting the core layer.",
    riskLevel,
    riskCategory: riskLevel === "low" ? "localized" : "shared",
    atRiskBehavior: ["Limited to immediate callers"],
    // A symbol (leaf) target carries only its caller/callee counts (leafImpact).
    summary: kind === "file"
      ? { members, directImporters: importers, directDependents: dependents, memberLevelCallers: memberCallers }
      : { callers, callees },
  };
  if (regions.length > 0) {
    record.propagationBuckets = regions.map((region) => ({ region, regionKind: "region", count: 1, members: [{ name: "user.ts", kind: "file" }] }));
  }
  return record;
}

/**
 * Install the fake on PATH (replacing it, so a real `ix` cannot be reached).
 * Returns helpers to read calls, mark roots as mapped, and restore.
 */
export function installFakeIx() {
  const dir = mkdtempSync(path.join(tmpdir(), "ix-fake-"));
  const bin = path.join(dir, "ix");
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  writeFileSync(path.join(dir, "fake-ix-impl.mjs"), IMPL);

  const nodeDir = path.dirname(process.execPath);
  const previousPath = process.env.PATH;
  process.env.PATH = [dir, nodeDir, "/usr/bin", "/bin"].join(path.delimiter);

  const logFile = path.join(dir, "calls.log");
  return {
    dir,
    calls() {
      if (!existsSync(logFile)) return [];
      return readFileSync(logFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
    mapCalls() {
      return this.calls().filter((call) => call.argv[0] === "map");
    },
    /**
     * Answer `ix impact <target>` with `responses[target]` (ix-decide reads it):
     * an impact object (exit 0), an error record object (exit 1), or "FAIL".
     */
    setImpact(responses) {
      writeFileSync(path.join(dir, "impact.json"), JSON.stringify(responses));
    },
    /**
     * Answer `ix callers <target>` with `responses[target]`, an array of rows
     * in the real `results[]` shape ({name, kind, path}).
     */
    setCallers(responses) {
      writeFileSync(path.join(dir, "callers.json"), JSON.stringify(responses));
    },
    /** Answer `ix briefing` with `text`; without it, briefing says Pro is absent. */
    setBriefing(text) {
      writeFileSync(path.join(dir, "briefing.txt"), text);
    },
    /** Make graph reads fail with ix's workspace_not_mapped record. */
    setUnmapped() {
      writeFileSync(path.join(dir, "unmapped"), "");
    },
    /** Make graph reads fail as ix does with its backend down: stderr only. */
    setUnreachable() {
      writeFileSync(path.join(dir, "unreachable"), "");
    },
    setMapped(roots) {
      writeFileSync(path.join(dir, "mapped-roots"), roots.join("\n") + "\n");
    },
    restore() {
      process.env.PATH = previousPath;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Poll until `predicate()` is truthy or the timeout passes. */
export async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return Boolean(predicate());
}
