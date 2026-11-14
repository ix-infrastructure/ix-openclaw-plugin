// Copyright 2026 Ix Infrastructure Inc.

/**
 * Reads a tool's answer and the CLI's own record for the same question while
 * the graph held still.
 *
 * The live test files run in parallel against one backend, and a sibling
 * file's `ix map` can change totals, ranks or regions between two reads. So the
 * record is read before and after the tool; if the two differ, the graph moved
 * under the tool and the pair is read again, up to `tries` times.
 *
 * If the record never holds still, the last pair is still returned, so its
 * checks can run, but with `steady: false`, and `why` (the text every check on
 * the pair should fail with) says so. A mismatch then reads as "the graph
 * never held still", not as a wrong value.
 *
 * Not a test file itself: tests/real-ix/live/read-tools.test.mjs uses it, and
 * tests/real-ix-steady.test.mjs tests it under `npm test`.
 */

export const STEADY_TRIES = 5;

/**
 * @param {() => Promise<string>} runTool  the tool's answer
 * @param {() => { raw: string }} readCli  the CLI's record; `raw` is compared
 * @param {{ label: string, tries?: number, waitMs?: number }} options
 * @returns {Promise<{ out: string, raw: string, steady: boolean, why: string }>}
 *   plus every other field readCli returned (such as `record`)
 */
export async function readSteady(runTool, readCli, { label, tries = STEADY_TRIES, waitMs = 1000 }) {
  let before = readCli();
  for (let attempt = 1; ; attempt++) {
    const out = await runTool();
    const after = readCli();
    const steady = after.raw === before.raw;
    if (steady || attempt >= tries) {
      const note = steady
        ? ""
        : `\n--- NOT STEADY ---\n\`ix ${label}\` printed a different record on each of ${tries + 1} reads, ` +
          "so the graph never held still and the tool may have answered from a different graph than the record above.";
      return { ...after, out, steady, why: `${out}\n--- ix ${label} ---\n${after.raw}${note}` };
    }
    before = after;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/**
 * The shape of ix `--format llm` text: each record's kind, keys and bare
 * words, with every `key=value` value (quoted or not) replaced by `…`.
 *
 * Used only when the CLI never printed the same llm text twice (a pair that
 * is not steady): then the values may hold something volatile, such as a
 * timing, and only the shape can be compared. A tool that fell back to JSON,
 * or dropped or added a record, still changes the shape.
 */
export function llmShape(text) {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/([^\s="]+)=(?:"(?:[^"\\]|\\.)*"|[^\s"]*)/g, "$1=…"))
    .join("\n");
}
