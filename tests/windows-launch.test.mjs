// Copyright 2026 Ix Infrastructure Inc.

/**
 * How the plugin starts `ix` (tools/ix-command.ts).
 *
 * The first group runs everywhere: it drives the Windows resolver with an
 * in-memory host, so the PATH x PATHEXT lookup, the installer-layout check and
 * the cmd.exe command line are checked on every CI runner. The POSIX group
 * runs the real runIx against a fake `ix` and proves the argv still reaches it
 * bare, with no shell. The Windows group runs only on Windows (the CI job
 * "Windows launch") against a two-level fake launcher shaped like the one the
 * Ix installer writes.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { autoMapSpawnOptions } from "../dist/runtime/auto-map.js";
import { runIx } from "../dist/tools/base.js";
import { IxLaunchError, ixLaunch, quoteForCmd } from "../dist/tools/ix-command.js";

const isWindows = process.platform === "win32";

// ── Windows resolver, in memory ─────────────────────────────────────────────

/** A Windows host whose files live in a map (keys compared case-insensitively). */
function winHost({ files = {}, env = {}, execPath = "C:\\Program Files\\nodejs\\node.exe" } = {}) {
  const table = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    platform: "win32",
    env: { SystemRoot: "C:\\Windows", ...env },
    execPath,
    isFile: (p) => table.has(p.toLowerCase()) || p.toLowerCase() === "c:\\windows\\system32\\cmd.exe",
    readFile: (p) => {
      const v = table.get(p.toLowerCase());
      return typeof v === "string" ? v : null;
    },
  };
}

// `%IX_HOME%\bin\ix.cmd` exactly as the Ix installer (scripts/install/install.ps1)
// writes it.
const OUTER = [
  "@echo off",
  'if not exist "%~dp0..\\cli\\ix.cmd" goto :ix_missing',
  '"%~dp0..\\cli\\ix.cmd" %*',
  "exit /b %errorlevel%",
  "",
  ":ix_missing",
  "echo(",
  'echo   The Ix CLI is not at "%~dp0..\\cli\\ix.cmd".',
  "echo(",
  "echo   An 'ix upgrade' from a version before 0.9.0 moved the CLI and left",
  "echo   this launcher pointing at the old path. Reinstalling repairs it:",
  "echo(",
  "echo     irm https://ix-infra.com/install.ps1 ^| iex",
  "echo(",
  "exit /b 1",
  "",
].join("\r\n");

// `%IX_HOME%\cli\ix.cmd` exactly as the Ix release workflow writes it; the
// script it names is therefore `%IX_HOME%\cli\cli\dist\cli\main.js`.
const INNER = '@echo off\nnode "%~dp0cli\\dist\\cli\\main.js" %*\n';

test("POSIX: ix is started by bare name with the argv untouched and no shell options", () => {
  const args = ["text", "a|b & c", "$(x)", "'q'", ""];
  const launch = ixLaunch(args, { platform: "linux", env: {}, execPath: "/usr/bin/node", isFile: () => false, readFile: () => null });
  assert.equal(launch.file, "ix");
  assert.deepEqual(launch.args, args);
  assert.deepEqual(launch.options, {});
});

test("Windows: the installer layout starts node with the CLI script, no shell", () => {
  const host = winHost({
    env: { PATH: "C:\\Users\\u\\.ix\\bin;C:\\Windows\\System32", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    files: {
      "C:\\Users\\u\\.ix\\bin\\ix.cmd": OUTER,
      "C:\\Users\\u\\.ix\\cli\\ix.cmd": INNER,
      "C:\\Users\\u\\.ix\\cli\\cli\\dist\\cli\\main.js": "",
    },
  });
  const args = ["text", 'a|b&c"d%PATH%^!x', "C:\\dir\\"];
  const launch = ixLaunch(args, host);
  assert.equal(launch.file, "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(launch.args, ["C:\\Users\\u\\.ix\\cli\\cli\\dist\\cli\\main.js", ...args]);
  assert.equal(launch.options.windowsVerbatimArguments, undefined);
  assert.equal(launch.options.shell, undefined);
  assert.equal(launch.options.env, undefined);
});

test("Windows: an absolute script path in cli\\ix.cmd is used as written", () => {
  const host = winHost({
    env: { Path: "D:\\ix\\bin" },
    files: {
      "D:\\ix\\bin\\ix.cmd": OUTER,
      "D:\\ix\\cli\\ix.cmd": '@node "D:\\ix\\cli\\other\\main.js" %*\r\n',
      "D:\\ix\\cli\\other\\main.js": "",
    },
  });
  assert.deepEqual(ixLaunch(["--version"], host).args, ["D:\\ix\\cli\\other\\main.js", "--version"]);
});

test("Windows: when the plugin's own runtime is not node, node is taken from PATH", () => {
  const host = winHost({
    execPath: "C:\\Apps\\host.exe",
    env: { PATH: "relative\\dir;;D:\\ix\\bin;C:\\nodejs" },
    files: {
      "D:\\ix\\bin\\ix.cmd": OUTER,
      "D:\\ix\\cli\\ix.cmd": INNER,
      "D:\\ix\\cli\\cli\\dist\\cli\\main.js": "",
      "C:\\nodejs\\node.exe": "",
      "relative\\dir\\node.exe": "",
    },
  });
  assert.equal(ixLaunch(["--version"], host).file, "C:\\nodejs\\node.exe");
});

test("Windows: without the node line in cli\\ix.cmd no script path is guessed; cmd.exe is used", () => {
  const host = winHost({
    env: { PATH: "D:\\ix\\bin" },
    files: {
      "D:\\ix\\bin\\ix.cmd": OUTER,
      "D:\\ix\\cli\\ix.cmd": "@echo off\r\ncall something-else %*\r\n",
      "D:\\ix\\cli\\dist\\cli\\main.js": "",
      "D:\\ix\\cli\\cli\\dist\\cli\\main.js": "",
    },
  });
  const launch = ixLaunch(["--version"], host);
  assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(launch.args[5], '""D:\\ix\\bin\\ix.cmd" "--version""');
});

test("Windows: the cmd.exe route sets NoDefaultCurrentDirectoryInExePath=1 on the host environment", () => {
  const host = winHost({
    env: { PATH: "C:\\tools", Foo: "bar", nodefaultcurrentdirectoryinexepath: "" },
    files: { "C:\\tools\\ix.cmd": "" },
  });
  const launch = ixLaunch(["--version"], host);
  assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(launch.options.env.NoDefaultCurrentDirectoryInExePath, "1");
  assert.equal(launch.options.env.Foo, "bar");
  assert.equal(launch.options.env.PATH, "C:\\tools");
  assert.deepEqual(
    Object.keys(launch.options.env).filter((k) => k.toLowerCase() === "nodefaultcurrentdirectoryinexepath"),
    ["NoDefaultCurrentDirectoryInExePath"]
  );
});

test("auto-map keeps the cmd.exe route's environment and adds IX_AUTO_MAP=1", () => {
  const host = winHost({ env: { PATH: "C:\\tools", Foo: "bar" }, files: { "C:\\tools\\ix.cmd": "" } });
  const options = autoMapSpawnOptions(ixLaunch(["map", "C:\\repo", "--silent"], host), "C:\\repo");
  assert.equal(options.env.NoDefaultCurrentDirectoryInExePath, "1");
  assert.equal(options.env.Foo, "bar");
  assert.equal(options.env.IX_AUTO_MAP, "1");
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.cwd, "C:\\repo");

  const posix = autoMapSpawnOptions({ file: "ix", args: [], options: {} }, "/repo");
  assert.equal(posix.env.IX_AUTO_MAP, "1");
  assert.equal(posix.env.PATH, process.env.PATH);
});

test("Windows: an ix.cmd outside the installer layout goes through cmd.exe with depth-proof quoting", () => {
  const host = winHost({
    env: { PATH: "C:\\tools", PATHEXT: ".EXE;.CMD" },
    files: { "C:\\tools\\ix.cmd": "@node C:\\x\\main.js %*\r\n" },
  });
  const launch = ixLaunch(["text", 'a"b', "100%", "end\\", ""], host);
  assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(launch.options.windowsVerbatimArguments, true);
  assert.deepEqual(launch.args.slice(0, 5), ["/e:on", "/d", "/v:off", "/s", "/c"]);
  assert.equal(
    launch.args[5],
    '""C:\\tools\\ix.cmd" "text" "a""b" "100%%cd:~,%" "end\\\\" """'
  );
});

test("quoteForCmd: every argument quoted, quotes doubled, percent neutralised, no carets", () => {
  assert.equal(quoteForCmd(""), '""');
  assert.equal(quoteForCmd("a b"), '"a b"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
  assert.equal(quoteForCmd('a\\"b'), '"a\\\\""b"');
  assert.equal(quoteForCmd("dir\\\\"), '"dir\\\\\\\\"');
  assert.equal(quoteForCmd("a\\b"), '"a\\b"');
  assert.equal(quoteForCmd("%PATH%"), '"%%cd:~,%PATH%%cd:~,%"');
  assert.equal(quoteForCmd("a^b|c&d<e>f(g)!h"), '"a^b|c&d<e>f(g)!h"');
});

test("quoteForCmd: an argument with CR or LF is refused", () => {
  for (const bad of ["a\nb", "a\rb", "a\r\nb", "nul\u0000"]) {
    assert.throws(() => quoteForCmd(bad), IxLaunchError);
  }
  const host = winHost({ env: { PATH: "C:\\tools" }, files: { "C:\\tools\\ix.cmd": "" } });
  assert.throws(() => ixLaunch(["text", "line1\nline2"], host), (error) => {
    assert.ok(error instanceof IxLaunchError);
    assert.match(error.message, /line break/);
    return true;
  });
});

test("Windows: PATH lookup skips empty and relative entries and follows PATHEXT order", () => {
  const host = winHost({
    env: { PATH: ';.;tools;"C:\\Quoted Dir";C:\\later', PATHEXT: ".EXE;.CMD" },
    files: {
      "ix.cmd": "",
      ".\\ix.cmd": "",
      "tools\\ix.exe": "",
      "C:\\Quoted Dir\\ix.cmd": "",
      "C:\\Quoted Dir\\ix.exe": "",
      "C:\\later\\ix.exe": "",
    },
  });
  const launch = ixLaunch(["--version"], host);
  assert.equal(launch.file, "C:\\Quoted Dir\\ix.exe");
  assert.deepEqual(launch.args, ["--version"]);
});

test("Windows: no ix on PATH is ENOENT, never a lookup in the working directory", () => {
  const host = winHost({ env: { PATH: ".;bin" }, files: { "ix.cmd": "", ".\\ix.cmd": "", "bin\\ix.cmd": "" } });
  assert.throws(() => ixLaunch(["--version"], host), (error) => {
    assert.ok(error instanceof IxLaunchError);
    assert.equal(error.code, "ENOENT");
    assert.match(error.message, /ENOENT/);
    return true;
  });
});

// ── POSIX, real process ─────────────────────────────────────────────────────

test("POSIX: runIx hands the argv to ix without a shell", { skip: isWindows }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ix-posix-launch-"));
  const log = path.join(dir, "argv.json");
  const marker = path.join(dir, "marker");
  const script = path.join(dir, "ix");
  writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, "main.mjs")}" "$@"\n`, { mode: 0o755 });
  writeFileSync(
    path.join(dir, "main.mjs"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`
  );
  const previous = process.env.PATH;
  process.env.PATH = [dir, "/usr/bin", "/bin"].join(path.delimiter);
  try {
    const args = ["text", "a|b", `x; touch ${marker}`, "$(touch " + marker + ")", "'\"", "", "%PATH%"];
    await runIx(args, { cwd: dir });
    assert.deepEqual(JSON.parse(readFileSync(log, "utf8")), args);
    assert.equal(existsSync(marker), false);
  } finally {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Windows, real cmd.exe and a two-level fake launcher ─────────────────────

/**
 * <root>\<binName>\ix.cmd -> <root>\cli\ix.cmd -> node
 * <root>\cli\cli\dist\cli\main.js, which writes its argv as JSON to
 * <root>\argv.json. Both launchers are the installer's and the release's text.
 */
function twoLevelLauncher(binName) {
  const root = mkdtempSync(path.join(tmpdir(), "ix-win-launch-"));
  const bin = path.join(root, binName);
  const cli = path.join(root, "cli");
  mkdirSync(bin);
  mkdirSync(path.join(cli, "cli", "dist", "cli"), { recursive: true });
  const main = path.join(cli, "cli", "dist", "cli", "main.js");
  const log = path.join(root, "argv.json");
  writeFileSync(
    main,
    `require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`
  );
  writeFileSync(path.join(bin, "ix.cmd"), OUTER);
  writeFileSync(path.join(cli, "ix.cmd"), INNER);
  return { root, bin, main, log, marker: path.join(root, "marker.txt") };
}

function canaryArgs(marker) {
  const make = `type nul > "${marker}"`;
  return [
    "text",
    "& | < > ^ \" % ! ( )",
    "with spaces",
    "trailing\\",
    "",
    "%PATH%",
    "%PATH:a=b%",
    "!PATH!",
    "^^^&",
    "a\\\"b",
    `x & ${make}`,
    `x" & ${make} & "`,
    `x"" & ${make} & ""`,
    `^" & ${make} & ^"`,
    `%cd:~,% & ${make}`,
    `) & ${make} & (`,
  ];
}

async function withPath(dir, fn) {
  const previous = process.env.PATH;
  process.env.PATH = [dir, path.dirname(process.execPath), path.join(process.env.SystemRoot ?? "C:\\Windows", "System32")].join(path.delimiter);
  try {
    return await fn();
  } finally {
    process.env.PATH = previous;
  }
}

test("Windows: the installer layout is started through node, arguments intact", { skip: !isWindows }, async () => {
  const fake = twoLevelLauncher("bin");
  try {
    await withPath(fake.bin, async () => {
      const args = [...canaryArgs(fake.marker), "two\nlines"];
      assert.equal(ixLaunch(args).file, process.execPath);
      await runIx(args, { cwd: fake.root });
      assert.deepEqual(JSON.parse(readFileSync(fake.log, "utf8")), args);
      assert.equal(existsSync(fake.marker), false);
    });
  } finally {
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("Windows: a nested ix.cmd through cmd.exe receives every argument intact", { skip: !isWindows }, async () => {
  // Not under a directory named `bin`, so the layout check does not apply and
  // the call goes through cmd.exe and both .cmd files.
  const fake = twoLevelLauncher("launcher");
  try {
    await withPath(fake.bin, async () => {
      const args = canaryArgs(fake.marker);
      assert.match(path.basename(ixLaunch(args).file), /^cmd\.exe$/i);
      await runIx(args, { cwd: fake.root });
      assert.deepEqual(JSON.parse(readFileSync(fake.log, "utf8")), args);
      assert.equal(existsSync(fake.marker), false);
    });
  } finally {
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("Windows: a line break is refused before cmd.exe runs", { skip: !isWindows }, async () => {
  const fake = twoLevelLauncher("launcher");
  try {
    await withPath(fake.bin, async () => {
      await assert.rejects(runIx(["text", "a\nb"], { cwd: fake.root }), /line break/);
      assert.equal(existsSync(fake.log), false);
    });
  } finally {
    rmSync(fake.root, { recursive: true, force: true });
  }
});

test("Windows: ix-health reports the version from an installer-layout ix.cmd", { skip: !isWindows }, async () => {
  const fake = twoLevelLauncher("bin");
  writeFileSync(
    fake.main,
    'process.stdout.write(JSON.stringify({ version: "9.8.7" }) + "\\n");\n'
  );
  try {
    await withPath(fake.bin, async () => {
      const { execute } = await import("../dist/tools/ix-health.js");
      const out = await execute({}, { directory: fake.root });
      assert.match(out, /ix 9\.8\.7/);
    });
  } finally {
    rmSync(fake.root, { recursive: true, force: true });
  }
});
