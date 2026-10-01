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
  case "--version":
    process.stdout.write("0.11.1\\n");
    break;
  default:
    process.stdout.write("{}\\n");
}
`;

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
