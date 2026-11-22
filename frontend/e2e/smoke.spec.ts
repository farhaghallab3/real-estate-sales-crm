import { expect, test } from "./fixtures";

import { ROLES, ROUTES, authState, open, resolvePath, watchProblems, type Role } from "./helpers";
import { EXTERNAL_TEXT } from "./strings";

// Every screen opens for every role, renders its heading and content, and produces no uncaught error, console error or failed API call.
for (const role of Object.keys(ROLES) as Role[]) {
  test.describe(`${role}`, () => {
    test.use({ storageState: authState(role) });
    for (const route of ROUTES) {
      test(`${route.name} opens without errors`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, resolvePath(route.path));
        await expect(page.locator("main")).toBeVisible();
        await expect(page.getByText(EXTERNAL_TEXT.nextErrorPage)).toHaveCount(0); // Next.js's own error page: framework text, not an application string
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }
  });
}
