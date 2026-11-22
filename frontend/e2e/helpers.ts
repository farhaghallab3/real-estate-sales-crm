import fs from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

export const ROLES = { admin: "admin@crm.local", manager: "manager@crm.local", sales: "sofia@crm.local" } as const;
export type Role = keyof typeof ROLES;

/** Text that real customers will type: long Arabic names without word breaks, mixed scripts, and Egyptian and Gulf phone numbers. */
export const LONG = {
  arabicName: "عبدالرحمن بن محمد بن عبدالعزيز آل سعود الحمادي العتيبي",
  arabicUnbroken: "عبدالرحمنعبدالرحمنعبدالرحمنعبدالرحمنعبدالرحمنعبدالرحمنعبدالرحمنعبدالرحمن",
  latinUnbroken: "Averyveryveryveryveryveryverylonglatintokenwithoutanyspacesatall0123456789",
  phones: ["+20 100 123 4567", "+966 50 123 4567", "+971 50 123 4567", "+965 5123 4567", "+974 3312 3456", "+973 3612 3456", "+968 9123 4567"],
};

export const authState = (role: Role) => path.join(__dirname, ".auth", `${role}.json`);

export function ids(): { lead: number; property: number; deal: number; longLead: number; longProperty: number } {
  return JSON.parse(fs.readFileSync(path.join(__dirname, ".auth", "ids.json"), "utf8"));
}

/** Every screen a signed-in user can open from the menu. Detail pages use {lead} {property} {deal}, resolved when the test runs
 *  (the ids exist only after the global setup has read them from the seeded database). */
export const ROUTES: { name: string; path: string }[] = [
  { name: "dashboard", path: "/dashboard" },
  { name: "leads", path: "/leads" },
  { name: "lead detail", path: "/leads/{lead}" },
  { name: "properties", path: "/properties" },
  { name: "property detail", path: "/properties/{property}" },
  { name: "pipeline", path: "/pipeline" },
  { name: "tasks", path: "/tasks" },
  { name: "viewings", path: "/viewings" },
  { name: "deals", path: "/deals" },
  { name: "deal detail", path: "/deals/{deal}" },
  { name: "commissions", path: "/commissions" },
  { name: "documents", path: "/documents" },
  { name: "reports", path: "/reports" },
  { name: "notifications", path: "/notifications" },
  { name: "settings", path: "/settings" },
];

export function resolvePath(template: string): string {
  const i = ids();
  return template.replace("{lead}", String(i.lead)).replace("{property}", String(i.property)).replace("{deal}", String(i.deal));
}

export const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 800 },
] as const;

/** Text direction is set on <html> after load: the layout is expected to hold in both directions (Arabic/RTL comes later). */
export async function setDirection(page: Page, dir: "ltr" | "rtl") {
  await page.evaluate((d) => document.documentElement.setAttribute("dir", d), dir);
}

/** Open a screen and wait until it has rendered (heading visible, network quiet). */
export async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1").first()).toBeVisible();
}

export interface OverflowReport {
  vw: number;
  scrollWidth: number;
  offenders: string[];
}

/** Horizontal overflow of the PAGE: the document is wider than the screen, or some element sticks out of the screen without sitting inside
 *  its own scrolling container (a table wrapped in overflow-x:auto is fine, a card pushing the whole page sideways is not). */
export async function overflowReport(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const contained = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) {
          const r = p.getBoundingClientRect();
          if (r.right <= vw + 1 && r.left >= -1) return true;
        }
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !contained(el)) {
        offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} [${Math.round(r.left)}..${Math.round(r.right)}] of ${vw}`);
        if (offenders.length >= 5) break;
      }
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const report = await overflowReport(page);
  expect(report.scrollWidth, `the page is ${report.scrollWidth}px wide on a ${report.vw}px screen. Offenders: ${report.offenders.join(" | ")}`).toBeLessThanOrEqual(report.vw);
  expect(report.offenders, "elements stick out of the screen").toEqual([]);
}

/** Collects what a user would experience as "broken": uncaught errors, console errors and failed API calls. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (/favicon/i.test(text)) return;                 // there is no favicon yet (tracked separately)
    if (/Failed to load resource/.test(text)) return;  // reported below with its URL and status
    problems.push(`console error: ${text.slice(0, 200)}`);
  });
  page.on("response", (r) => {
    const url = r.url();
    if (/favicon/i.test(url)) return;
    if (r.status() >= 400 && /\/api\//.test(url)) problems.push(`HTTP ${r.status()} ${new URL(url).pathname}`);
    if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${new URL(url).pathname}`);
  });
  return problems;
}
