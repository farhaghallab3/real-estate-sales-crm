import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { describeError, describeMessage, errorText, EXACT_MESSAGES, fieldErrorTexts, PATTERN_MESSAGES, primaryMessage, type ErrorTranslate } from "./api-errors";

// Phase 6: backend errors in the user's language, through the narrow table of the backend's own messages. These tests cover the table against the backend source
// (so a backend wording change is noticed), the catalogue (both languages), the classification by status, the text for known and unknown errors in English and
// Arabic, and the guarantees: server text of a 5xx never shown, the contract of ApiError untouched, field errors kept on their own fields.
const ROOT = path.resolve(__dirname, "../..");
const catalogue = (name: string) => JSON.parse(readFileSync(path.join(ROOT, `messages/${name}.json`), "utf8")) as Record<string, Record<string, string>>;
const en = catalogue("en");
const ar = catalogue("ar");
const translator = (locale: "en" | "ar") => createTranslator({ locale, messages: catalogue(locale) as never }) as unknown as ErrorTranslate;
const tEn = translator("en");
const tAr = translator("ar");

const GENERIC_KEYS = ["network", "server", "unknown", "unknownWithDetail", "sessionExpired", "forbidden", "notFound", "rateLimited", "passwordChangeRequired", "schedulingConflict"];

describe("the table and the catalogue agree", () => {
  const tableKeys = new Set([...EXACT_MESSAGES.map(([key]) => key as string), ...PATTERN_MESSAGES.map(([key]) => key as string), ...GENERIC_KEYS]);

  it("every key of the errors namespace is used by the table (or is a generic status message), and every table key exists in both catalogues", () => {
    expect(Object.keys(en.errors).sort()).toEqual([...tableKeys].sort());
    expect(Object.keys(ar.errors).sort()).toEqual(Object.keys(en.errors).sort());
  });

  it("no backend message is mapped twice (one text, one key)", () => {
    const texts = EXACT_MESSAGES.map(([, text]) => text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  // Messages owned by the backend source of THIS repository: each must still be written there (a changed backend wording must be noticed here).
  const FRAMEWORK = new Set([
    "notAuthenticated", "forbidden", "required", "blank", "nullValue", "invalidEmail", "invalidUrl", "validNumber", "validInteger", "sessionExpired", "badCredentials",
    "passwordTooCommon", "passwordNumeric",
  ]);
  const backend = path.resolve(ROOT, "../backend");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === "tests" || e.name === "migrations" || e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : /\.py$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const source = existsSync(backend) ? walk(backend).map((f) => readFileSync(f, "utf8")).join("\n") : "";

  it.skipIf(!source)("every backend-owned message is still written in the backend source", () => {
    for (const [key, text] of EXACT_MESSAGES) {
      if (FRAMEWORK.has(key)) continue;
      // a message built from the SOLD constant plus a sentence is checked by its two parts
      const parts = text.startsWith("This property has already been sold in another deal.") ? [text.slice(0, 51), text.slice(52)].filter(Boolean) : [text];
      for (const part of parts) expect(source.includes(part), `${key}: ${part}`).toBe(true);
    }
  });

  it.skipIf(!source)("English keeps the backend's own wording for every backend-owned message", () => {
    for (const [key, text] of EXACT_MESSAGES) if (!FRAMEWORK.has(key)) expect(en.errors[key], key).toBe(text);
  });
});

describe("describeMessage", () => {
  it.each([
    ["Only managers can reassign leads.", "managersReassignLeads", undefined],
    ["File exceeds the 10 MB limit.", "fileTooLarge", { size: 10 }],
    ["File type 'exe' is not allowed. Allowed: pdf, doc.", "fileTypeNotAllowed", { type: "exe", allowed: "pdf, doc" }],
    ["Unknown stage 'x'.", "unknownStage", { stage: "x" }],
    ["Ensure this value is greater than or equal to 0.", "minValue", { value: "0" }],
    ["Ensure this field has no more than 1 character.", "maxLength", { count: 1 }],
    ["Ensure this field has no more than 120 characters.", "maxLength", { count: 120 }],
    ["This password is too short. It must contain at least 8 characters.", "passwordTooShort", { count: 8 }],
    ["The password is too similar to the email address.", "passwordSimilar", undefined],
    ['"abc" is not a valid choice.', "invalidChoice", { value: "abc" }],
    ['Invalid pk "5" - object does not exist.', "invalidReference", undefined],
    ["No Lead matches the given query.", "notFound", undefined],
    ["Request was throttled. Expected available in 37 seconds.", "rateLimitedWait", { seconds: 37 }],
    ["  This field is required.  ", "required", undefined],
  ])("%s", (text, key, values) => {
    expect(describeMessage(text)).toEqual({ key, ...(values ? { values } : {}) } as never);
  });

  it.each(["", "Something nobody mapped.", "only managers can reassign leads.", "Only managers can reassign leads", null, undefined, 5, {}])("does not map %j", (text) => {
    expect(describeMessage(text)).toBeNull();
  });
});

describe("describeError: what an error is", () => {
  const api = (status: number, data: unknown) => new ApiError(status, data);

  it("no connection (a failed fetch) is the network error, never an HTTP answer", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "network", key: "network" });
    expect(describeError(new Error("NetworkError when attempting to fetch resource."))).toMatchObject({ kind: "network" });
    expect(describeError(new Error("something else"))).toMatchObject({ kind: "unknown", key: null });
    expect(describeError(null)).toMatchObject({ kind: "unknown", key: null });
  });

  it("5xx is the generic server error whatever the body says", () => {
    for (const status of [500, 502, 503, 504]) expect(describeError(api(status, "<html>Traceback (most recent call last)</html>"))).toEqual({ kind: "server", key: "server" });
    expect(describeError(api(500, { detail: "Only managers can reassign leads." })).key).toBe("server");
  });

  it("401: an expired or revoked session, bad credentials, missing credentials", () => {
    expect(describeError(api(401, { detail: "Given token not valid for any token type", code: "token_not_valid" }))).toMatchObject({ kind: "session", key: "sessionExpired" });
    expect(describeError(api(401, { detail: "This session is no longer valid. Please sign in again.", code: "token_revoked" }))).toMatchObject({ kind: "session", key: "sessionRevoked" });
    expect(describeError(api(401, { detail: "Authentication credentials were not provided." }))).toMatchObject({ kind: "session", key: "notAuthenticated" });
    expect(describeError(api(401, { detail: "No active account found with the given credentials" }))).toMatchObject({ kind: "known", key: "badCredentials" });
    expect(describeError(api(401, null))).toMatchObject({ kind: "session", key: "sessionExpired" });
  });

  it("403: the temporary-password gate by its code, a known refusal by its text, any other 403 generically", () => {
    expect(describeError(api(403, { detail: "You must change your temporary password before continuing.", code: "password_change_required" })).key).toBe("passwordChangeRequired");
    expect(describeError(api(403, { detail: "You do not have permission to perform this action." }))).toMatchObject({ kind: "forbidden", key: "forbidden" });
    expect(describeError(api(403, { detail: "Some new refusal text" }))).toMatchObject({ kind: "forbidden", key: "forbidden" });
    expect(describeError(api(403, null)).key).toBe("forbidden");
  });

  it("404: DRF's not-found texts and an empty 404 are the not-found message", () => {
    expect(describeError(api(404, { detail: "No Lead matches the given query." })).kind).toBe("notFound");
    expect(describeError(api(404, { detail: "Not found." })).key).toBe("notFound");
    expect(describeError(api(404, "<html>")).key).toBe("notFound");
  });

  it("429: with the wait in seconds when the server says it, generic otherwise", () => {
    expect(describeError(api(429, { detail: "Request was throttled. Expected available in 37 seconds." }))).toEqual({ kind: "rateLimited", key: "rateLimitedWait", values: { seconds: 37 } });
    expect(describeError(api(429, { detail: "Request was throttled." }))).toEqual({ kind: "rateLimited", key: "rateLimited" });
    expect(describeError(api(429, null)).key).toBe("rateLimited");
  });

  it("409 conflict by its stable code, business rules by their text, validation by the first message of the first field", () => {
    expect(describeError(api(409, { detail: "This time overlaps with another scheduled viewing.", code: "scheduling_conflict", conflicts: [] })).key).toBe("schedulingConflict");
    expect(describeError(api(400, { detail: "Closed or lost deals can no longer be edited." })).key).toBe("closedDealNoEdit");
    expect(describeError(api(400, { phone: ["This field may not be blank."] })).key).toBe("blank");
    expect(describeError(api(400, { non_field_errors: ["Only scheduled viewings can be cancelled."] })).key).toBe("onlyScheduledCancelled");
  });

  it("an unknown 4xx message is unknown, and keeps the server's text as the detail", () => {
    expect(describeError(api(400, { detail: "A brand new rule." }))).toEqual({ kind: "unknown", key: null, detail: "A brand new rule." });
    expect(describeError(api(418, null))).toEqual({ kind: "unknown", key: null, detail: undefined });
  });
});

describe("errorText in English and Arabic", () => {
  const api = (status: number, data: unknown) => new ApiError(status, data);
  const both = (error: unknown, fallback?: string) => ({ en: errorText(error, tEn, "en", fallback), ar: errorText(error, tAr, "ar", fallback) });

  it("a known message: the backend's own English wording, and the Arabic catalogue message", () => {
    const e = api(400, { detail: "Only managers can reassign leads." });
    expect(both(e)).toEqual({ en: "Only managers can reassign leads.", ar: "إعادة إسناد العملاء متاحة للمديرين فقط." });
  });

  it("a known message with values", () => {
    const e = api(400, { detail: "File exceeds the 10 MB limit." });
    expect(both(e)).toEqual({ en: "File exceeds the 10 MB limit.", ar: "حجم الملف يتجاوز الحد الأقصى وهو 10 MB." });
    const t = api(400, { detail: "Unknown stage 'zzz'." });
    expect(errorText(t, tEn, "en")).toBe("Unknown stage 'zzz'.");
  });

  it("an unknown 4xx message is never hidden: English as before (ApiError.message), Arabic after a localized sentence", () => {
    const e = api(400, { detail: "A brand new rule." });
    expect(errorText(e, tEn, "en")).toBe(e.message);
    expect(errorText(e, tAr, "ar")).toBe("حدث خطأ ما: A brand new rule.");
    expect(errorText(api(418, null), tAr, "ar")).toBe("حدث خطأ ما. يُرجى المحاولة مرة أخرى.");
  });

  it("5xx and non-JSON bodies show a safe generic message and never the server's text", () => {
    const secret = "Traceback (most recent call last): File '/app/secret.py', line 1, password=hunter2";
    for (const e of [api(500, secret), api(502, { detail: secret }), api(503, `<html>${secret}</html>`)]) {
      const text = both(e);
      expect(text.en).toBe("Something went wrong on our side. Please try again in a moment.");
      expect(text.ar).toBe("حدث خطأ من جانبنا. يُرجى المحاولة بعد قليل.");
      expect(text.en + text.ar).not.toMatch(/Traceback|secret|hunter2|html/);
    }
  });

  it("no connection, expired session, forbidden, not found and rate limits", () => {
    expect(both(new TypeError("Failed to fetch")).ar).toBe("تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.");
    expect(both(new TypeError("Failed to fetch")).en).toBe("Could not reach the server. Check your connection and try again.");
    expect(both(api(401, null))).toEqual({ en: "Your session has expired. Please sign in again.", ar: "انتهت جلستك. يُرجى تسجيل الدخول مرة أخرى." });
    expect(both(api(403, null))).toEqual({ en: "You do not have permission to perform this action.", ar: "ليس لديك صلاحية لتنفيذ هذا الإجراء." });
    expect(both(api(404, { detail: "No Lead matches the given query." })).ar).toBe("لم يتم العثور على هذا العنصر. ربما تمت إزالته.");
    expect(both(api(429, null)).ar).toContain("عدد الطلبات كبير جدًا");
  });

  it("the wait of a rate limit follows the Arabic plural forms (one, two, few, many, other) and the English ones", () => {
    const wait = (n: number) => both(api(429, { detail: `Request was throttled. Expected available in ${n} seconds.` }));
    expect(wait(1).en).toBe("Too many requests. Please try again in 1 second.");
    expect(wait(37).en).toBe("Too many requests. Please try again in 37 seconds.");
    expect(wait(1).ar).toBe("عدد الطلبات كبير جدًا. يُرجى المحاولة بعد ثانية واحدة.");
    expect(wait(2).ar).toBe("عدد الطلبات كبير جدًا. يُرجى المحاولة بعد ثانيتين.");
    expect(wait(5).ar).toBe("عدد الطلبات كبير جدًا. يُرجى المحاولة بعد 5 ثوانٍ.");
    expect(wait(37).ar).toBe("عدد الطلبات كبير جدًا. يُرجى المحاولة بعد 37 ثانية.");
    expect(wait(100).ar).toBe("عدد الطلبات كبير جدًا. يُرجى المحاولة بعد 100 ثانية.");
  });

  it("a failure that is not an HTTP answer uses the action's own message, or the generic one", () => {
    expect(errorText(new Error("TypeError: x is undefined at app.js:12"), tAr, "ar", "تعذّر حفظ العميل.")).toBe("تعذّر حفظ العميل.");
    expect(errorText(new Error("boom"), tEn, "en", "Could not save the lead.")).toBe("Could not save the lead.");
    expect(errorText(undefined, tAr, "ar")).toBe("حدث خطأ ما. يُرجى المحاولة مرة أخرى.");
    expect(errorText(new Error("boom"), tEn, "en")).toBe("Something went wrong. Please try again.");
  });

  it("every key of the errors namespace formats in both languages with sample values (no runtime exception, no placeholder left)", () => {
    for (const [language, t] of [["en", tEn], ["ar", tAr]] as const) {
      for (const key of Object.keys(en.errors)) {
        const out = t(`errors.${key as never}`, { stage: "x", type: "exe", allowed: "pdf", size: 10, value: "5", count: 3, seconds: 7, detail: "d" });
        expect(out, `${language} ${key}`).not.toMatch(/\{\w+\}/);
        expect(out.length, `${language} ${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("field errors stay on their own fields", () => {
  const api = (data: unknown) => new ApiError(400, data);

  it("known messages are translated, unknown ones are kept, field names are untouched", () => {
    const e = api({ phone: ["This field may not be blank."], email: ["Enter a valid email address.", "second"], budget: ["Budget cannot be negative."], extra: ["Something unmapped."] });
    expect(fieldErrorTexts(e, tEn)).toEqual({ phone: "This field may not be blank.", email: "Enter a valid email address.", budget: "Budget cannot be negative.", extra: "Something unmapped." });
    expect(fieldErrorTexts(e, tAr)).toEqual({ phone: "لا يمكن ترك هذا الحقل فارغًا.", email: "أدخل بريدًا إلكترونيًا صالحًا.", budget: "لا يمكن أن تكون الميزانية سالبة.", extra: "Something unmapped." });
  });

  it("`detail`, `code` and `conflicts` are not fields, and a non-API error has none", () => {
    expect(fieldErrorTexts(api({ detail: "x", code: "y", conflicts: [] }), tAr)).toEqual({});
    expect(fieldErrorTexts(new Error("x"), tAr)).toEqual({});
  });
});

describe("the contract of ApiError and the response bodies is untouched", () => {
  it("message, status, data and fieldErrors are exactly what they were", () => {
    const data = { phone: ["This field may not be blank."], title: ["Required."] };
    const e = new ApiError(400, data);
    expect(e.status).toBe(400);
    expect(e.data).toBe(data);
    expect(e.message).toBe("phone: This field may not be blank. · title: Required.");
    expect(e.fieldErrors).toEqual({ phone: "This field may not be blank.", title: "Required." });
    expect(new ApiError(404, { detail: "Not found." }).message).toBe("Not found.");
    expect(new ApiError(502, null).message).toBe("Request failed (502)");
  });

  it("primaryMessage reads detail, non_field_errors, then the first field, in that order", () => {
    expect(primaryMessage({ detail: "a", phone: ["b"] })).toBe("a");
    expect(primaryMessage({ phone: ["b"], non_field_errors: ["c"] })).toBe("c");
    expect(primaryMessage({ phone: ["b"] })).toBe("b");
    expect(primaryMessage(["x", "y"])).toBe("x");
    expect(primaryMessage(null)).toBeNull();
    expect(primaryMessage({ code: "k", conflicts: [] })).toBeNull();
  });

  it("the module only reads errors: it makes no request and touches no token or storage", () => {
    const code = readFileSync(path.join(ROOT, "src/lib/api-errors.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/fetch\(|localStorage|tokens\.|setUnauthorizedHandler|window\.|document\.(cookie|body|querySelector|getElementById)/);
  });
});
