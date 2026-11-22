import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { headerAlignment } from "./table-align";

// Regression guard: after text-left became text-start, table headers were centered by the browser (the table's `start` is the initial value, so the
// user-agent `th` centering came back). Every header now carries its own alignment.
describe("headerAlignment", () => {
  it.each([undefined, "", "font-medium", "whitespace-nowrap w-24", "md:text-end", "sm:text-center lg:text-start"])("an ordinary header (%j) is aligned to the inline start", (className) => {
    expect(headerAlignment(className)).toBe("text-start");
  });

  it.each(["text-end", "text-right", "text-left", "text-center", "text-start", "tabular text-end", "w-24 text-end font-medium", "text-justify"])(
    "a header that already chooses an alignment (%j) is left alone, so numbers stay end-aligned",
    (className) => {
      expect(headerAlignment(className)).toBeUndefined();
    },
  );

  it("does not mistake a longer class name for an alignment", () => {
    expect(headerAlignment("text-endless")).toBe("text-start");
    expect(headerAlignment("context-end")).toBe("text-start");
  });
});

describe("Th uses it", () => {
  const source = readFileSync(new URL("../components/ui/primitives.tsx", import.meta.url), "utf8");
  const th = source.slice(source.indexOf("export function Th"), source.indexOf("export function Td"));

  it("puts the default alignment before the caller's class list and does not rely on the order of two conflicting utilities", () => {
    expect(source).toMatch(/import \{ headerAlignment \} from "@\/lib\/table-align"/);
    expect(th).toMatch(/headerAlignment\(className\),[^\n]*\n\s*className,/);
    expect(th).not.toMatch(/text-(start|end)/); // the alignment never appears as a literal class in the base list
  });

  it("the numeric headers of the application (money, counts, percentages) pass text-end explicitly", () => {
    const root = new URL("../app/", import.meta.url);
    const walk = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(new URL(e.name + "/", dir)) : e.name.endsWith(".tsx") ? [readFileSync(new URL(e.name, dir), "utf8")] : []));
    const pages = walk(root).join("\n");
    expect((pages.match(/<Th [^>]*className="text-end"/g) ?? []).length).toBeGreaterThanOrEqual(30);
    expect(pages).not.toMatch(/<Th [^>]*className="text-(right|left)"/);
  });
});
