import { expect, test as base } from "@playwright/test";

/** Every test runs behind a guard: the browser may only talk to the local test stack. A request to any other host is blocked and fails the
 *  test, so a misconfigured build (for example one that points at a real API) can never send traffic, credentials or test data anywhere else. */
export const test = base.extend<{ localOnly: void }>({
  localOnly: [
    async ({ context, baseURL }, use) => {
      const allowed = new URL(baseURL ?? "http://127.0.0.1").origin;
      const blocked: string[] = [];
      await context.route(
        (url) => !/^(data|blob|about):/.test(url.href) && url.origin !== allowed,
        (route) => {
          blocked.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await use();
      expect(blocked, "the page tried to reach a host outside the local test stack").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
