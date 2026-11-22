import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Phase 2 Gate A guard: the interface is written with LOGICAL classes, so it mirrors in RTL. A physical class that creeps back in fails here.
const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = files(SRC)
  .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
  .map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));
const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");

describe("logical classes only", () => {
  it.each([
    ["text-left / text-right", /\btext-(left|right)\b/],
    ["ml-/mr-/pl-/pr- (and negative margins)", /(?<![\w-])-?(m|p)(l|r)-(\d|\[)/],
    ["left-/right- positioning", /(?<![\w-])-?(left|right)-(\d|\[|px|full|auto)/],
    ["border-l / border-r", /\bborder-(l|r)(-|\b)/],
    ["rounded-l / rounded-r / corner variants", /\brounded-(l|r|tl|tr|bl|br)(?![a-z])/],
    ["float-left / float-right", /\bfloat-(left|right)\b/],
    ["translate-x (direction dependent)", /(?<![\w-])-?translate-x-/],
    ["divide-x without its RTL counterpart", /\bdivide-x(?!-reverse)\b(?![^"`]*rtl:divide-x-reverse)/],
  ])("no %s in the application", (_name, pattern) => {
    const hits = sources.filter((s) => pattern.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it("every directional icon is mirrored in RTL, and the non-directional ones are not", () => {
    const directional = /<(ArrowLeft|ArrowRight|ChevronLeft|ChevronRight|ChevronsLeft|ChevronsRight)\b[^>]*>/g;
    let seen = 0;
    for (const { file, text } of sources) {
      for (const match of text.matchAll(directional)) {
        seen++;
        expect(match[0], `${file}: ${match[0]}`).toContain("rtl:-scale-x-100");
      }
      for (const match of text.matchAll(/<(ArrowRightLeft|ChevronDown|ChevronUp|Search|Bell|Menu)\b[^>]*>/g)) {
        expect(match[0], `${file}: ${match[0]}`).not.toContain("rtl:-scale-x-100");
      }
    }
    expect(seen).toBeGreaterThanOrEqual(9); // 3 back arrows, 2 week chevrons, 2 pagination chevrons, 2 sidebar-collapse chevrons
  });

  it("the shell and the overlays use inline-start / inline-end", () => {
    const shell = sources.find((s) => s.file === "components/layout/app-shell.tsx")!.text;
    expect(shell).toMatch(/fixed inset-y-0 start-0/); // desktop sidebar
    expect(shell).toMatch(/absolute inset-y-0 start-0/); // mobile drawer
    expect(shell).toMatch(/md:ps-16/);
    expect(shell).toMatch(/md:ps-60/);
    expect(shell).toMatch(/absolute end-0 mt-1/); // profile menu
    expect(shell).toMatch(/absolute end-1\.5 top-1\.5/); // notification dot
    expect(sources.find((s) => s.file === "components/ui/toast.tsx")!.text).toMatch(/bottom-4 end-4/);
    expect(sources.find((s) => s.file === "components/ui/modal.tsx")!.text).toMatch(/-me-2/);
    expect(sources.find((s) => s.file === "components/ui/primitives.tsx")!.text).toMatch(/absolute start-2\.5/);
  });
});

describe("Arabic typography is scoped to :lang(ar)", () => {
  it("has the rules, and every one of them is under :lang(ar)", () => {
    const start = css.indexOf("Arabic typography");
    const block = css.slice(start, css.indexOf("@layer utilities", start)); // the Arabic rules end with the base layer
    for (const rule of [/letter-spacing: normal/, /text-transform: none/, /font-size: 0\.8125rem/, /line-height: 1\.7/, /font-feature-settings: normal/]) expect(block).toMatch(rule);
    const selectors = [...block.matchAll(/^\s*([^{}\n]+)\{/gm)].map((m) => m[1].trim()).filter((s) => !s.startsWith("/*") && !s.startsWith("*"));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector.startsWith(":lang(ar)"), selector).toBe(true);
  });

  // Phase 2 Gate B (ADR-0002): IBM Plex Sans Arabic, weights 400 / 500 / 600, self-hosted from the pinned package, applied under :lang(ar) only.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pkg = JSON.parse(readFileSync(path.resolve(SRC, "../package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

  it("imports exactly the three weight files that carry unicode-range subsets, before everything else", () => {
    const imports = [...code.matchAll(/@import "(@fontsource\/[^"]+)";/g)].map((m) => m[1]);
    expect(imports).toEqual(["@fontsource/ibm-plex-sans-arabic/400.css", "@fontsource/ibm-plex-sans-arabic/500.css", "@fontsource/ibm-plex-sans-arabic/600.css"]);
    expect(code.indexOf("@tailwind")).toBeGreaterThan(code.lastIndexOf("@import")); // @import rules must come first
    expect(code).not.toMatch(/@font-face/); // the faces are declared by the package, not copied into the project
  });

  it("the package is pinned exactly, is the only font package, and its licence is kept", () => {
    expect(pkg.devDependencies["@fontsource/ibm-plex-sans-arabic"]).toBe("5.3.0");
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((n) => n.includes("fontsource"))).toEqual(["@fontsource/ibm-plex-sans-arabic"]);
    expect(readFileSync(path.resolve(SRC, "../../docs/third-party/IBM-Plex-Sans-Arabic-OFL-1.1-LICENSE.txt"), "utf8")).toMatch(/IBM Corp/);
  });

  it("the family is used under :lang(ar) only, and the English font stack is untouched", () => {
    const uses = [...code.matchAll(/([^{}]+)\{[^{}]*IBM Plex Sans Arabic[^{}]*\}/g)].map((m) => m[1].trim());
    expect(uses).toEqual([":lang(ar)"]);
    const tailwind = readFileSync(path.resolve(SRC, "../tailwind.config.ts"), "utf8");
    expect(tailwind).not.toMatch(/Plex|fontsource/);
    expect(tailwind).toMatch(/"ui-sans-serif", "system-ui"/); // the English stack as it was
  });
});
