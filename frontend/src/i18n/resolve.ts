import { DEFAULT, SUPPORTED } from "./config";

// Locale resolution (ADR-0001 2.2): profile > cookie > company > browser (Accept-Language) > default.
// Pure functions: no I/O, no globals, no mutation of the inputs.

export interface ResolveInput {
  /** The signed-in user's saved preference (`user.language`; null = none). Source of truth when present. */
  userLanguage?: unknown;
  /** The value of the `crm_lang` cookie. Untrusted: it can be tampered with. */
  cookie?: unknown;
  /** The company's default language (`GET /api/config/`). */
  companyLanguage?: unknown;
  /** The raw `Accept-Language` request header. Untrusted. */
  acceptLanguage?: unknown;
}

// A header longer than this, or with more entries, is not a browser's: it is cut off instead of processed without limit.
const MAX_HEADER_LENGTH = 1000;
const MAX_ENTRIES = 40;

// A language tag as it can appear in Accept-Language: `en`, `ar-EG`, `zh-Hant-TW` (letters, digits, hyphens) or the wildcard.
const TAG = /^(?:[a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)$/i;

/** True only for a string that is exactly one of the supported languages (no trimming, no case folding: stored values are exact). */
export function isSupported(value: unknown, supported: readonly string[] = SUPPORTED): value is string {
  return typeof value === "string" && supported.includes(value);
}

interface Entry {
  tag: string;
  q: number;
  index: number;
}

function parseAcceptLanguage(header: string): Entry[] {
  const entries: Entry[] = [];
  const parts = header.slice(0, MAX_HEADER_LENGTH).split(",");
  for (let i = 0; i < parts.length && entries.length < MAX_ENTRIES; i++) {
    const [rawTag, ...params] = parts[i].split(";");
    const tag = rawTag.trim();
    if (!TAG.test(tag)) continue; // malformed (for example `ar_EG`): ignored, never an error
    let q = 1;
    let valid = true;
    for (const param of params) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/i.exec(param);
      if (!match) continue;
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1])) valid = false; // RFC 9110: 0 to 1, at most three decimals
      else q = Number(match[1]);
    }
    if (valid) entries.push({ tag: tag.toLowerCase(), q, index: i });
  }
  return entries;
}

/**
 * The best supported language for an `Accept-Language` header, or null when it says nothing usable.
 * Highest q first (ties keep header order); `q=0` means "not acceptable"; `ar-EG` matches `ar`; `*` matches the first supported
 * language that was not excluded. Returns the spelling used in `supported`.
 */
export function negotiate(acceptLanguage: unknown, supported: readonly string[] = SUPPORTED): string | null {
  if (typeof acceptLanguage !== "string" || acceptLanguage.trim() === "") return null;
  const entries = parseAcceptLanguage(acceptLanguage);
  const lowered = supported.map((s) => s.toLowerCase());
  const matchTag = (tag: string): number => {
    for (let t = tag; t; t = t.includes("-") ? t.slice(0, t.lastIndexOf("-")) : "") {
      const hit = lowered.indexOf(t);
      if (hit !== -1) return hit;
    }
    return -1;
  };
  const excluded = new Set<number>();
  for (const e of entries) {
    if (e.q !== 0 || e.tag === "*") continue;
    const hit = matchTag(e.tag);
    if (hit !== -1) excluded.add(hit);
  }
  const ranked = entries.filter((e) => e.q > 0).sort((a, b) => b.q - a.q || a.index - b.index);
  for (const e of ranked) {
    if (e.tag === "*") {
      const first = supported.findIndex((_, i) => !excluded.has(i));
      if (first !== -1) return supported[first];
      continue;
    }
    const hit = matchTag(e.tag);
    if (hit !== -1 && !excluded.has(hit)) return supported[hit];
  }
  return null;
}

/**
 * The interface language for one request. `supported` defaults to the application's allow-list (English only in Phase 1);
 * tests pass `["en", "ar"]` to exercise the whole matrix without enabling Arabic in the app.
 */
export function resolveLocale(input: ResolveInput = {}, supported: readonly string[] = SUPPORTED): string {
  if (isSupported(input.userLanguage, supported)) return input.userLanguage;
  if (isSupported(input.cookie, supported)) return input.cookie;
  if (isSupported(input.companyLanguage, supported)) return input.companyLanguage;
  return negotiate(input.acceptLanguage, supported) ?? DEFAULT;
}
