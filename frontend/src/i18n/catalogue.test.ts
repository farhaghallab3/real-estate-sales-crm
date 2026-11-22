import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parse } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { pseudoLocalize } from "../../scripts/pseudo-locale.mjs";

// Phase 3: the English catalogue (messages/en.json) that the interface now reads. Keys are typed at compile time (global.d.ts); these tests cover what the
// compiler cannot: that every message is valid ICU, that no entry is orphaned, how a missing message behaves, and interpolation with the real messages.
const ROOT = path.resolve(__dirname, "../..");
const catalogue = JSON.parse(readFileSync(path.join(ROOT, "messages/en.json"), "utf8")) as Record<string, Record<string, unknown>>;

function entries(object: Record<string, unknown>, prefix = ""): [string, unknown][] {
  return Object.entries(object).flatMap(([key, value]) => (value !== null && typeof value === "object" ? entries(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, value] as [string, unknown]]));
}
const all = entries(catalogue);

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = walk(path.join(ROOT, "src"))
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$|\.typecheck\.ts$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

describe("the English catalogue", () => {
  it("is namespaced by feature, with the shared and the enum entries apart", () => {
    expect(Object.keys(catalogue)).toEqual(expect.arrayContaining(["common", "auth", "shell", "ui", "leads", "properties", "deals", "tasks", "viewings", "commissions", "documents", "reports", "settings", "notifications", "dashboard", "pipeline", "workflows", "enums"]));
    expect(all.length).toBeGreaterThan(500);
  });

  it("holds only non-empty strings", () => {
    for (const [key, value] of all) {
      expect(typeof value, key).toBe("string");
      expect((value as string).trim().length, key).toBeGreaterThan(0);
    }
  });

  it("every message is valid ICU", () => {
    for (const [key, value] of all) expect(() => parse(value as string), key).not.toThrow();
  });

  it("every message survives the pseudo-localization generator (the Phase 1.7b input), and still parses", () => {
    for (const [key, value] of all) {
      const pseudo = pseudoLocalize(value as string);
      expect(() => parse(pseudo), key).not.toThrow();
    }
  });

  it("has no entry that nothing reads (a key is read by literal, or through a typed template: enums.<kind>.<value>, dashboard.greeting<Part>, errors.<key> (checked in api-errors.test.ts))", () => {
    const orphans = all
      .map(([key]) => key)
      .filter((key) => !key.startsWith("enums.") && !key.startsWith("errors.") && !key.startsWith("dashboard.greeting"))
      .filter((key) => !sources.includes(`"${key}"`) && !sources.includes(`'${key}'`) && !sources.includes(`\`${key}\``));
    expect(orphans).toEqual([]);
  });

  it("holds every enumerated value of the application under enums.<kind>", () => {
    const expected: Record<string, string[]> = {
      leadStatus: ["new", "contacted", "qualified", "viewing", "offer_made", "closed", "lost"],
      dealStage: ["interested", "viewing", "offer_made", "negotiation", "under_contract", "closed", "lost"],
      role: ["admin", "manager", "salesperson"],
      offerStatus: ["submitted", "countered", "accepted", "rejected", "withdrawn"],
    };
    for (const [kind, values] of Object.entries(expected)) expect(Object.keys(catalogue.enums[kind] as object).sort(), kind).toEqual([...values].sort());
    // the same English word for two entities is two entries, never one shared entry (gender agreement in Arabic)
    expect((catalogue.enums.leadStatus as Record<string, string>).closed).toBe("Closed");
    expect((catalogue.enums.dealStage as Record<string, string>).closed).toBe("Closed");
  });
});

describe("reading the catalogue", () => {
  type Format = (key: string, values?: Record<string, string | number>) => string;
  const t = createTranslator({ locale: "en", messages: catalogue as never }) as unknown as Format;

  it("returns the English wording the interface always had", () => {
    expect(t("common.cancel")).toBe("Cancel");
    expect(t("enums.dealStage.under_contract")).toBe("Under Contract");
    expect(t("enums.leadStatus.offer_made")).toBe("Offer Made");
    expect(t("shell.navSettings")).toBe("Profile / Settings");
  });

  it("interpolates values without touching them (numbers print as plain digits, text as it is)", () => {
    expect(t("shell.notificationsUnread", { unread: 3 })).toBe("Notifications, 3 unread");
    expect(t("shell.notificationsUnread", { unread: 1234 })).toBe("Notifications, 1234 unread");
    expect(t("deals.ratePercent", { rate: 2.5 })).toBe("Rate (2.5%)");
    expect(t("ui.pageOfPages", { page: 2, pages: 9 })).toBe("Page 2 / 9");
    expect(t("ui.rangeOfCount", { from: 1, to: 25, count: 98 })).toBe("1–25 of 98");
    expect(t("auth.useLabel", { label: "Fatima" })).toBe("Use Fatima");
  });

  it("a missing message reports the problem and shows its key, instead of throwing or showing nothing", () => {
    const errors: string[] = [];
    const broken = createTranslator({ locale: "en", messages: {} as never, onError: (e) => errors.push(e.code) }) as unknown as Format;
    expect(broken("common.cancel")).toBe("common.cancel");
    expect(errors).toEqual(["MISSING_MESSAGE"]);
  });

  it("a missing interpolation value is reported too (the wrong call never fails silently)", () => {
    const errors: string[] = [];
    const strict = createTranslator({ locale: "en", messages: catalogue as never, onError: (e) => errors.push(e.code) }) as unknown as Format;
    strict("shell.notificationsUnread");
    expect(errors.length).toBe(1);
  });
});

describe("the interface reads the catalogue, not literals", () => {
  it("no component, page or hook of the application is left without the translation hook where it renders catalogue text", () => {
    const usesT = /\b(t|tr)\("[a-z]+\.[A-Za-z0-9]+"/;
    expect(usesT.test(sources)).toBe(true);
  });
});
