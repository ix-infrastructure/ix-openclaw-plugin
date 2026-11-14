// Copyright 2026 Ix Infrastructure Inc.

/**
 * The tool's own words: its answer with every string ix's record carries
 * blanked out.
 *
 * In json mode the tools copy ix's text into their answer as is: ix-explain
 * prints ix's rendered explanation, "why it matters", "used by" and notes;
 * the others print ix's names, paths, labels and matched lines. Whatever ix
 * wrote there is ix's business, so a phrase such as "not found" or the word
 * "undefined" inside it says nothing about the tool. The failure patterns in
 * read-tools.test.mjs are matched against what is left: the words the tool
 * wrote itself.
 *
 * Only a string that itself holds a failure phrase (CRASH, NO_ANSWER, or the
 * word "none" that NONE ends in) is blanked. Any other string cannot make a
 * failure pattern match, so it is left in place: blanking it could only hurt,
 * since a short one ("de", "fin", "und") would split the tool's own
 * "undefined" or "not found" and hide a real failure.
 *
 * Each string is replaced by a NUL, never by nothing, so the text on either
 * side of it cannot join into a word that was not there. Longer strings go
 * first, so a short one inside a long one cannot split it before it is
 * removed whole.
 *
 * What stays ambiguous: a record string that is exactly a failure word
 * ("none", "NaN") also blanks that same word where the tool wrote it. Equal
 * text cannot be told apart.
 *
 * Not a test file itself: tests/real-ix/live/read-tools.test.mjs uses it, and
 * tests/real-ix-own-words.test.mjs tests it under `npm test`.
 */

/** A rendering the tool built from a value it did not have. */
export const CRASH = /\[object Object\]|undefined|NaN/;
/**
 * What a tool says when ix could not answer, or when it read no answer out of
 * one: either way, wrong for a symbol the fixture project contains.
 */
export const NO_ANSWER =
  /not found|No matches found|No results|No trace paths found|Graph is empty|ix unavailable|could not answer|Ambiguous target|error code=/i;
/** A list the tool rendered as empty ("**callers:** none"). */
export const NONE = /\*\*[^*\n]+:\*\* none\b/i;

/** Every non-empty string value anywhere in `value` (object keys excluded). */
export function recordStrings(value, into = new Set()) {
  if (typeof value === "string") {
    if (value.length > 0) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) recordStrings(item, into);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) recordStrings(item, into);
  }
  return into;
}

/** Whether ix's string `s` says something a failure pattern looks for. */
export function holdsFailurePhrase(s) {
  return CRASH.test(s) || NO_ANSWER.test(s) || /\bnone\b/i.test(s);
}

/** `out` with each string of `record` that holds a failure phrase replaced by a NUL. */
export function ownWords(out, record) {
  const strings = [...recordStrings(record)].filter(holdsFailurePhrase).sort((a, b) => b.length - a.length);
  let text = out;
  for (const s of strings) text = text.split(s).join("\u0000");
  return text;
}
