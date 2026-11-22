import { expect, test } from "./fixtures";
import { ROUTES, authState, open, resolvePath } from "./helpers";

// The global rule `overflow-wrap: anywhere` lets a long Arabic name or URL wrap instead of stretching the page. It must never cut a number,
// a money amount, a table heading or a control label in the middle: those have no spaces to wrap at, so if they ever span two lines the rule
// (or a narrow column) has broken them. Checked on every screen at phone and tablet width.
for (const vp of [{ name: "phone", width: 375, height: 812 }, { name: "tablet", width: 768, height: 1024 }]) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ storageState: authState("manager"), viewport: { width: vp.width, height: vp.height } });
    for (const route of ROUTES) {
      test(`${route.name}: numbers, headings and controls are not cut in the middle`, async ({ page }) => {
        await open(page, resolvePath(route.path));
        const broken = await page.evaluate(() => {
          const out: string[] = [];
          const numberish = /^[−+-]?\s?[$€£¥]?\s?\d[\d,.٫٬]*\s?[KMB%]?$/;
          for (const el of Array.from(document.querySelectorAll("body *"))) {
            if (el.children.length > 0) continue;
            const text = (el.textContent ?? "").trim();
            if (!text || /\s/.test(text) || text.length > 24) continue;   // only single tokens: they have no place to wrap at
            const cs = getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") continue;
            const control = el.closest("button, [role='button'], select, th, label, nav a, [class*='rounded-full']") !== null;
            if (!numberish.test(text) && !control) continue;
            const range = document.createRange();
            range.selectNodeContents(el);
            const lines = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
            if (lines > 1) out.push(`${el.tagName.toLowerCase()} "${text}" is cut into ${lines} lines`);
            if (out.length >= 5) break;
          }
          return out;
        });
        expect(broken, broken.join("\n")).toEqual([]);
      });
    }
  });
}
