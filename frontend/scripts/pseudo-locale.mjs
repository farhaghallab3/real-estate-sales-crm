import { isLiteralElement, isPluralElement, isSelectElement, isTagElement, parse } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";

// Pseudo-localization generator (Phase 1.7a, ADR-0001 2.5): turns an ICU message into an accented, about 35% longer English look-alike ("en-XA") so
// that layout tests can see text that is wider than the English source. PURE: no file, no network, no clock, no randomness. NOT wired into the
// application, the build, Playwright or the E2E stack, and it does not generate messages/en-XA.json (that is Phase 1.7b, after Phase 3).
//
// What it changes: only LITERAL TEXT. The message is parsed with the ICU parser (@formatjs/icu-messageformat-parser, a declared dev dependency; no
// hand-written parser), the text nodes are transformed, and the result is printed back by the parser's own printer, so the output is valid ICU again.
// What it never changes: arguments (`{name}`), number/date/time formats, `plural` and `select` structure and their keys (`one`, `other`, `=0`...), the `#`
// marker, rich-text tag names (`<b>...</b>`), and inside a literal: URLs, e-mail addresses, digits and numbers, snake_case identifiers, reference codes
// such as `PR-00042`, and every non-ASCII letter (Arabic, for example) or symbol.
//
// Policy for already-transformed input: a message that already starts with the opening marker and ends with the closing marker is returned unchanged,
// so `pseudoLocalize(pseudoLocalize(x)) === pseudoLocalize(x)`. A source message that really begins with "⟦" and ends with "⟧" is therefore never expanded.
//
// The printed ICU is normalized by the parser's printer (spacing inside arguments, the order of plural clauses); the meaning is identical.

/** Marks the beginning and the end of a transformed message: a clipped or truncated label shows at once that a marker is missing. */
export const OPEN_MARK = "⟦";
export const CLOSE_MARK = "⟧";

/** Share of extra length added to every literal: 35% of the length of its transformable text (the text outside the protected technical tokens), rounded to the nearest whole character. */
export const EXPANSION = 0.35;

/** The character that carries the expansion (it is not an ICU syntax character). */
const FILLER = "~";

const LOWER = "áƀçďéƒĝĥíĵķĺḿńóṕǫŕśťúṽŵẍýž"; // a-z
const UPPER = "ÁƁÇĎÉƑĜĤÍĴĶĹḾŃÓṔǪŔŚŤÚṼŴẌÝŽ"; // A-Z
const MAP = new Map();
for (let i = 0; i < 26; i++) {
  MAP.set(String.fromCharCode(97 + i), LOWER[i]);
  MAP.set(String.fromCharCode(65 + i), UPPER[i]);
}

// Technical tokens inside a literal that must stay byte for byte as they are.
const TECHNICAL = new RegExp(
  [
    String.raw`https?:\/\/[^\s<>{}]+`, // URLs
    String.raw`www\.[^\s<>{}]+`,
    String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+`, // e-mail addresses
    String.raw`\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b`, // snake_case identifiers
    String.raw`\b[A-Z]{2,}-\d+\b`, // reference codes such as PR-00042
    String.raw`\d+(?:[.,:/-]\d+)*`, // digits, numbers, times, dates
  ].join("|"),
  "g",
);

export class PseudoLocaleError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "PseudoLocaleError";
  }
}

/** Transforms one run of plain text (no ICU syntax in it: the parser has already taken that apart). */
function expandLiteral(text) {
  let letters = 0;
  let plain = 0; // length of the text that is not a protected token
  let out = "";
  let lastLetterEnd = -1; // index in `out` just after the last transformed letter
  let last = 0;
  const append = (piece, protectedToken) => {
    if (protectedToken) {
      out += piece;
      return;
    }
    plain += piece.length;
    for (const ch of piece) {
      const mapped = MAP.get(ch);
      if (mapped === undefined) {
        out += ch;
      } else {
        out += mapped;
        letters++;
        lastLetterEnd = out.length;
      }
    }
  };
  for (const match of text.matchAll(TECHNICAL)) {
    append(text.slice(last, match.index), false);
    append(match[0], true);
    last = match.index + match[0].length;
  }
  append(text.slice(last), false);
  if (letters === 0) return { text, letters: 0 };
  const padding = FILLER.repeat(Math.round(plain * EXPANSION));
  return { text: out.slice(0, lastLetterEnd) + padding + out.slice(lastLetterEnd), letters };
}

/** Transforms the text nodes of an AST (recursively through tags, plural and select branches); returns the number of letters it transformed. */
function transform(elements) {
  let letters = 0;
  const result = elements.map((el) => {
    if (isLiteralElement(el)) {
      const done = expandLiteral(el.value);
      letters += done.letters;
      // `rawValue` (the source spelling) is dropped: the printer then escapes the new value itself
      return { type: el.type, value: done.text };
    }
    if (isTagElement(el)) {
      const inner = transform(el.children);
      letters += inner.letters;
      return { ...el, children: inner.elements };
    }
    if (isPluralElement(el) || isSelectElement(el)) {
      const options = {};
      for (const [key, option] of Object.entries(el.options)) {
        const inner = transform(option.value);
        letters += inner.letters;
        options[key] = { ...option, value: inner.elements };
      }
      return { ...el, options };
    }
    return el; // argument, number, date, time, pound: structure and names stay as they are
  });
  return { elements: result, letters };
}

function parseOrThrow(message) {
  try {
    return parse(message);
  } catch (error) {
    const kind = error instanceof Error && typeof error.message === "string" ? error.message : String(error);
    throw new PseudoLocaleError(`Malformed ICU message (${kind}): ${JSON.stringify(message)}`, { cause: error });
  }
}

/** True when `message` is already pseudo-localized (starts with the opening and ends with the closing marker). */
export function isPseudoLocalized(message) {
  return typeof message === "string" && message.startsWith(OPEN_MARK) && message.endsWith(CLOSE_MARK);
}

/**
 * The pseudo-localized ICU message. Throws PseudoLocaleError for anything that is not a string or not valid ICU (it never returns a corrupted message).
 * An empty message, and a message without any transformable letter (`{count}`, `—`, `100%`, an e-mail address alone), is returned unchanged.
 */
export function pseudoLocalize(message) {
  if (typeof message !== "string") throw new PseudoLocaleError(`A message must be a string, got ${message === null ? "null" : typeof message}`);
  const ast = parseOrThrow(message); // validates first: a malformed message is rejected even when it would not be transformed
  if (message === "" || isPseudoLocalized(message)) return message;
  const { elements, letters } = transform(ast);
  if (letters === 0) return message;
  const marked = [{ type: 0, value: OPEN_MARK }, ...elements, { type: 0, value: CLOSE_MARK }];
  const printed = printAST(marked);
  parseOrThrow(printed); // the result must parse again: never hand out ICU that does not
  return printed;
}

/** A catalogue (nested objects of messages, as in messages/en.json) with every message pseudo-localized; keys and structure are kept. */
export function pseudoLocalizeCatalogue(catalogue, path = "") {
  if (catalogue === null || typeof catalogue !== "object" || Array.isArray(catalogue)) {
    throw new PseudoLocaleError(`A catalogue must be an object of messages${path ? ` (at ${path})` : ""}`);
  }
  const out = {};
  for (const [key, value] of Object.entries(catalogue)) {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === "string") {
      try {
        out[key] = pseudoLocalize(value);
      } catch (error) {
        throw new PseudoLocaleError(`${here}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    } else {
      out[key] = pseudoLocalizeCatalogue(value, here);
    }
  }
  return out;
}
