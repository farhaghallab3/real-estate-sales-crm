import fs from "node:fs";

import { request as pwRequest } from "@playwright/test";

import { expect, test } from "./fixtures";
import { LONG, VIEWPORTS, authState, expectNoHorizontalOverflow, ids, open, setDirection } from "./helpers";

// Arabic names, addresses and notes are long, have no word breaks inside a compound name and mix scripts and digits. The screens must wrap or
// clip them, never push the page sideways. The records are created once in the global setup. Phone numbers from Egypt and the Gulf must be
// accepted and shown as typed.
test.describe("long Arabic and unbroken text", () => {
  test.use({ storageState: authState("manager") });
  for (const dir of ["ltr", "rtl"] as const) {
    for (const vp of VIEWPORTS) {
      test(`dashboard, lists, details and the pipeline hold at ${vp.name} ${dir}`, async ({ page }) => {
        const { longLead, longProperty } = ids();
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const path of ["/dashboard", "/leads", `/leads/${longLead}`, "/properties", `/properties/${longProperty}`, "/pipeline", "/deals", "/tasks"]) {
          await open(page, path);
          await setDirection(page, dir);
          await expectNoHorizontalOverflow(page);
        }
        await open(page, `/leads/${longLead}`);
        await expect(page.getByText(LONG.arabicName.slice(0, 12)).first()).toBeVisible();
      });
    }
  }
});

test.describe("international phone numbers", () => {
  test("Egypt and Gulf numbers are accepted and kept exactly as typed", async ({ baseURL }) => {
    const token = JSON.parse(fs.readFileSync(authState("manager"), "utf8")).origins[0].localStorage[0].value as string;
    const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    for (const phone of LONG.phones) {
      const res = await api.post("/api/leads/", { data: { first_name: "Phone", last_name: "Format", phone } });
      expect(res.status(), `${phone}: ${await res.text()}`).toBe(201);
      expect(((await res.json()) as { phone: string }).phone).toBe(phone);
    }
    await api.dispose();
  });
});
