import { test } from "./fixtures";

import { ROUTES, VIEWPORTS, authState, expectNoHorizontalOverflow, open, resolvePath, setDirection } from "./helpers";

// The page never scrolls sideways on a phone, a tablet or a desktop, in either text direction. The manager's screens are the widest
// (team tables, charts); the admin's settings screen adds the company card. RTL is checked now so that Arabic can be added without a redesign.
for (const dir of ["ltr", "rtl"] as const) {
  for (const vp of VIEWPORTS) {
    test.describe(`${vp.name} ${vp.width}px, ${dir}`, () => {
      test.use({ storageState: authState("manager"), viewport: { width: vp.width, height: vp.height } });
      for (const route of ROUTES) {
        test(`${route.name}: no horizontal overflow`, async ({ page }) => {
          await open(page, resolvePath(route.path));
          await setDirection(page, dir);
          await expectNoHorizontalOverflow(page);
        });
      }
    });
  }
}

test.describe("admin settings with the company card", () => {
  test.use({ storageState: authState("admin") });
  for (const vp of VIEWPORTS) {
    for (const dir of ["ltr", "rtl"] as const) {
      test(`settings ${vp.name} ${dir}: no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await open(page, "/settings");
        await setDirection(page, dir);
        await expectNoHorizontalOverflow(page);
      });
    }
  }
});
