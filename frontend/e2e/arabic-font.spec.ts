import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { authState, open } from "./helpers";

// Phase 2 Gate B: IBM Plex Sans Arabic is requested only by Arabic pages (here: lang="ar" forced after load, as in rtl.spec.ts), never by an English
// session; only the three approved weights and the subsets a page really uses are fetched; the transfer stays inside the budget (about 200 KB).
test.use({ storageState: authState("manager") });

const BUDGET = 200 * 1024; // ADR-0002 / plan criterion 11
const FONT = /ibm-plex-sans-arabic/i;

/** Font files this page has fetched so far (resource timing), with the size that crossed the network. */
const fontRequests = (page: Page) =>
  page.evaluate((pattern) => {
    const re = new RegExp(pattern, "i");
    return performance
      .getEntriesByType("resource")
      .filter((e) => re.test(e.name))
      .map((e) => {
        const r = e as PerformanceResourceTiming;
        return { url: r.name, transfer: r.transferSize, encoded: r.encodedBodySize };
      });
  }, FONT.source);

const familyFaces = (page: Page) =>
  page.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "IBM Plex Sans Arabic").map((f) => ({ weight: f.weight, status: f.status, range: f.unicodeRange.slice(0, 20) })));

async function arabic(page: Page) {
  await page.evaluate(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
  });
}

test("an English session requests no Arabic font file and never loads a face of the family", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => {
    if (FONT.test(r.url())) requested.push(r.url());
  });
  for (const route of ["/dashboard", "/leads", "/properties", "/settings"]) await open(page, route);
  await page.evaluate(() => document.fonts.ready);
  expect(requested, "no request for the Arabic font in English").toEqual([]);
  expect(await fontRequests(page)).toEqual([]);
  expect((await familyFaces(page)).filter((f) => f.status === "loaded")).toEqual([]);
  // the English interface keeps its own stack
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).not.toMatch(/Plex/i);
  expect(family).toMatch(/ui-sans-serif/);
});

test("an Arabic session loads only woff2 files of the approved weights, and the transfer stays within the budget", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (r) => {
    if (FONT.test(r.url())) requested.push(r.url());
  });
  await open(page, "/leads"); // the list holds the long Arabic fixtures from the global setup
  await arabic(page);
  await page.waitForFunction(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "IBM Plex Sans Arabic" && f.status === "loaded"));
  await page.evaluate(() => document.fonts.ready);
  // the semibold and medium weights are used on the screen: wait for them too
  await page.evaluate(() => Promise.all(["400", "500", "600"].map((w) => document.fonts.load(`${w} 14px "IBM Plex Sans Arabic"`, "عبد Ab1"))));
  const files = await fontRequests(page);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(file.url, "only woff2 is fetched").toMatch(/\.woff2(\?|$)/);
    expect(file.url, "only the approved weights").toMatch(/-(400|500|600)-normal/);
  }
  expect(files.some((f) => /-arabic-(400|500|600)-normal/.test(f.url)), "the Arabic subset is fetched").toBe(true);
  expect(files.some((f) => /-cyrillic/.test(f.url)), "unused subsets are not fetched").toBe(false);
  const total = files.reduce((sum, f) => sum + (f.transfer || f.encoded), 0);
  process.stdout.write(`FONT-TRANSFER ${JSON.stringify({ files: files.map((f) => ({ file: f.url.split("/").pop()?.split("?")[0], bytes: f.transfer || f.encoded })), totalBytes: total, totalKB: +(total / 1024).toFixed(1), budgetKB: BUDGET / 1024 })}\n`);
  expect(total, `the Arabic font transfer (${(total / 1024).toFixed(1)} KB) must stay within ${BUDGET / 1024} KB`).toBeLessThanOrEqual(BUDGET);
  expect(requested.length).toBe(files.length); // every request is one of the counted files
});

test("the font is applied to Arabic text and to the Latin text next to it, in the three weights, and the layout does not overflow", async ({ page }) => {
  await open(page, "/leads");
  await arabic(page);
  await page.evaluate(() => Promise.all(["400", "500", "600"].map((w) => document.fonts.load(`${w} 14px "IBM Plex Sans Arabic"`, "عبد Ab1"))));
  const used = await page.evaluate(() => {
    const family = (el: Element) => getComputedStyle(el).fontFamily;
    const th = document.querySelector("th") as HTMLElement;
    return { body: family(document.body), th: family(th), main: family(document.querySelector("main") as HTMLElement), weights: [...new Set([...document.querySelectorAll("main *")].map((el) => getComputedStyle(el).fontWeight))] };
  });
  for (const f of [used.body, used.th, used.main]) expect(f).toMatch(/^"?IBM Plex Sans Arabic"?,/);
  const horizontal = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontal).toBeLessThanOrEqual(0);
});

test("digits are tabular in Arabic text: every digit has the same width with tabular-nums", async ({ page }) => {
  await open(page, "/leads");
  await arabic(page);
  const widths = await page.evaluate(async () => {
    // every weight that is measured must be loaded first, or the measurement would be of the fallback font
    await Promise.all([400, 500, 600].map((w) => document.fonts.load(`${w} 14px "IBM Plex Sans Arabic"`, "0123456789")));
    const measure = (weight: number, text: string, numeric: string) => {
      const span = document.createElement("span");
      span.textContent = text;
      span.style.cssText = `position:absolute;white-space:nowrap;visibility:hidden;font:${weight} 14px "IBM Plex Sans Arabic";font-variant-numeric:${numeric}`;
      document.body.appendChild(span);
      const w = span.getBoundingClientRect().width;
      span.remove();
      return w;
    };
    const out: Record<string, number[]> = {};
    for (const weight of [400, 500, 600]) out[`tabular-${weight}`] = [..."0123456789"].map((d) => +measure(weight, d.repeat(8), "tabular-nums").toFixed(3));
    out.proportional400 = [..."0123456789"].map((d) => +measure(400, d.repeat(8), "proportional-nums").toFixed(3));
    return out;
  });
  process.stdout.write(`FONT-DIGITS ${JSON.stringify(widths)}\n`);
  for (const weight of [400, 500, 600]) {
    const w = widths[`tabular-${weight}`];
    expect(Math.max(...w) - Math.min(...w), `digit widths at weight ${weight}: ${w.join(", ")}`).toBeLessThan(0.05);
  }
});
