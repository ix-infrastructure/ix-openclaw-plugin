// Copyright 2026 Ix Infrastructure Inc.

/**
 * How to start the `ix` CLI as a child process.
 *
 * POSIX: `ix` by bare name with the argv as is and no shell, exactly as
 * before.
 *
 * Windows: the Ix installer puts `%IX_HOME%\bin\ix.cmd` on PATH, and Node
 * cannot start a `.cmd` file without cmd.exe (nor does it apply PATHEXT). That
 * `bin\ix.cmd` calls `..\cli\ix.cmd`, which runs `node "<main.js>" %*`, so an
 * argument started as `cmd.exe /c ix.cmd ...` goes through cmd.exe's parser
 * three times. Arguments come from the agent (patterns, paths), and cmd.exe
 * could interpret them through that nested launcher unless they are quoted
 * for every level. So:
 *
 *  1. `ix` is resolved once through PATH x PATHEXT, absolute entries only; the
 *     working directory is never searched.
 *  2. For the installer layout, node is started directly with the CLI script
 *     and the argv as an array. No shell, nothing to quote.
 *  3. Any other `.cmd`/`.bat` goes through cmd.exe with quoting that holds at
 *     any depth (the scheme Rust's standard library uses for batch files):
 *     every argument in double quotes, `"` written as `""`, backslashes before
 *     a quote or the end doubled, `%` neutralised, no carets, `/v:off`. An
 *     argument with CR, LF or NUL cannot be passed safely and is refused.
 */

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The file to execute, its argv, and the spawn options it needs. */
export interface IxLaunch {
  file: string;
  args: string[];
  options: { windowsVerbatimArguments?: boolean; windowsHide?: boolean };
}

/** `ix` could not be started safely, or was not found (`code` "ENOENT"). */
export class IxLaunchError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "IxLaunchError";
    this.code = code;
  }
}

/** What the resolver reads from the machine; injectable for tests. */
export interface LaunchHost {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  execPath: string;
  isFile(file: string): boolean;
  /** The file's text, or null when it cannot be read. */
  readFile(file: string): string | null;
}

type WindowsPlan =
  | { kind: "direct"; file: string }
  | { kind: "node"; node: string; script: string }
  | { kind: "cmd"; cmdExe: string; script: string };

const win = path.win32;
const RUNNABLE_EXTENSIONS = new Set([".com", ".exe", ".bat", ".cmd"]);
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function defaultHost(): LaunchHost {
  return {
    platform: process.platform,
    env: process.env,
    execPath: process.execPath,
    isFile(file) {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    },
    readFile(file) {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
  };
}

// Resolved plans for the default host, keyed by the PATH/PATHEXT they came
// from, so a changed PATH is looked up again. A miss is not cached: installing
// ix while the host runs is picked up on the next call.
const planCache = new Map<string, WindowsPlan>();

/**
 * How to run `ix <args>` on this machine. Throws IxLaunchError when ix is not
 * on PATH (Windows only; on POSIX the spawn itself reports ENOENT) or an
 * argument cannot be passed through cmd.exe safely.
 */
export function ixLaunch(args: readonly string[], host?: LaunchHost): IxLaunch {
  const h = host ?? defaultHost();
  if (h.platform !== "win32") return { file: "ix", args: [...args], options: {} };

  let plan: WindowsPlan | undefined;
  const key = host ? "" : [envValue(h.env, "PATH"), envValue(h.env, "PATHEXT"), h.execPath].join("\0");
  if (!host) plan = planCache.get(key);
  if (!plan) {
    plan = resolveWindowsPlan(h);
    if (!host) planCache.set(key, plan);
  }

  const options = { windowsHide: true };
  switch (plan.kind) {
    case "direct":
      return { file: plan.file, args: [...args], options };
    case "node":
      return { file: plan.node, args: [plan.script, ...args], options };
    case "cmd": {
      const line = [quoteForCmd(plan.script), ...args.map(quoteForCmd)].join(" ");
      return {
        file: plan.cmdExe,
        args: ["/e:on", "/d", "/v:off", "/s", "/c", `"${line}"`],
        options: { ...options, windowsVerbatimArguments: true },
      };
    }
  }
}

/**
 * One argument for a cmd.exe command line that runs a batch file, safe however
 * many times cmd.exe re-parses it: every character stays inside a quoted
 * region at every level, and `%` cannot expand a variable.
 */
export function quoteForCmd(arg: string): string {
  if (/[\r\n\0]/.test(arg)) {
    throw new IxLaunchError(
      "an argument contains a line break, which cannot be passed to ix.cmd through cmd.exe safely",
      "EINVAL"
    );
  }
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes += 1;
      out += ch;
      continue;
    }
    if (ch === '"') out += "\\".repeat(backslashes) + '"';
    else if (ch === "%") out += "%%cd:~,";
    backslashes = 0;
    out += ch;
  }
  return out + "\\".repeat(backslashes) + '"';
}

function resolveWindowsPlan(host: LaunchHost): WindowsPlan {
  const found = findOnPath(host, "ix", [...RUNNABLE_EXTENSIONS]);
  if (!found) throw new IxLaunchError("spawn ix ENOENT: ix was not found on PATH", "ENOENT");

  const ext = win.extname(found).toLowerCase();
  if (ext === ".exe" || ext === ".com") return { kind: "direct", file: found };

  const direct = installerEntry(host, found);
  if (direct) return direct;

  if (found.includes('"')) throw new IxLaunchError(`cannot start ${found} through cmd.exe`, "EINVAL");
  return { kind: "cmd", cmdExe: cmdExe(host), script: found };
}

/**
 * The installer layout: `<root>\bin\ix.cmd` delegating to `<root>\cli\ix.cmd`,
 * which runs `node "<script>" %*`. Returns node + script, or null when the
 * layout or a node to run it with is not found.
 */
function installerEntry(host: LaunchHost, found: string): WindowsPlan | null {
  const binDir = win.dirname(found);
  if (win.basename(found).toLowerCase() !== "ix.cmd" || win.basename(binDir).toLowerCase() !== "bin") return null;
  const outer = host.readFile(found);
  if (outer === null || !/\.\.\\cli\\ix\.cmd/i.test(outer)) return null;

  const cliDir = win.join(win.dirname(binDir), "cli");
  const inner = host.readFile(win.join(cliDir, "ix.cmd"));
  if (inner === null) return null;

  let script: string | null = null;
  const match = inner.match(/^[ \t]*@?[ \t]*"?node(?:\.exe)?"?[ \t]+"([^"\r\n]+)"[ \t]+%\*[ \t]*\r?$/im);
  if (match) {
    const written = match[1].replace(/^%~dp0/i, cliDir + "\\");
    if (!/[%!]/.test(written) && isAbsoluteWindows(written)) {
      const candidate = win.normalize(written);
      if (host.isFile(candidate)) script = candidate;
    }
  }
  if (!script) {
    const known = win.join(cliDir, "dist", "cli", "main.js");
    if (host.isFile(known)) script = known;
  }
  if (!script) return null;

  const node = nodeExecutable(host);
  return node ? { kind: "node", node, script } : null;
}

/** The node running this plugin, else `node.exe` from PATH; null if neither. */
function nodeExecutable(host: LaunchHost): string | null {
  if (/^node(\.exe)?$/i.test(win.basename(host.execPath)) && isAbsoluteWindows(host.execPath)) {
    return host.execPath;
  }
  return findOnPath(host, "node", [".exe"]);
}

function cmdExe(host: LaunchHost): string {
  const systemRoot = envValue(host.env, "SystemRoot");
  if (systemRoot && isAbsoluteWindows(systemRoot)) {
    const candidate = win.join(systemRoot, "System32", "cmd.exe");
    if (host.isFile(candidate)) return candidate;
  }
  const comspec = envValue(host.env, "ComSpec");
  if (comspec && isAbsoluteWindows(comspec) && host.isFile(comspec)) return comspec;
  throw new IxLaunchError("cannot find cmd.exe to start ix.cmd (SystemRoot and ComSpec are unset)", "ENOENT");
}

/**
 * `name` + an extension from PATHEXT (restricted to `allowed`), in the first
 * absolute PATH directory that has one. Relative and empty entries are
 * skipped, and the working directory is never searched.
 */
function findOnPath(host: LaunchHost, name: string, allowed: string[]): string | null {
  const exts = (envValue(host.env, "PATHEXT") || DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => allowed.includes(e));
  for (const raw of (envValue(host.env, "PATH") ?? "").split(";")) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || !isAbsoluteWindows(dir)) continue;
    for (const ext of exts) {
      const candidate = win.join(dir, name + ext);
      if (host.isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** A drive-letter path (`C:\...`) or a UNC path; not `\x` or `C:x`. */
function isAbsoluteWindows(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/]{2}[^\\/]/.test(p);
}

/** Environment lookup ignoring case, as Windows does (`Path` vs `PATH`). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}
