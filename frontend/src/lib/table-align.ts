// Table header alignment (Phase 2 Gate A). A <th> is centered by the browser's own stylesheet unless an explicit alignment reaches it, and `text-start`
// on the <table> is the initial value, which does NOT count as explicit. So every header carries its own alignment: the inline start by default, or the
// one its class list already chose (`text-end` for numbers). The decision is made here, from the class list, and never from the order of two utilities
// in the class string (their order in the stylesheet, not in the attribute, decides which one wins).
const ALIGNMENT = /(^|\s)text-(start|end|left|right|center|justify)(\s|$)/;

/** `text-start` unless `className` already contains an alignment utility of its own (a variant such as `md:text-end` does not count: it only applies from a breakpoint). */
export function headerAlignment(className?: string): "text-start" | undefined {
  return className && ALIGNMENT.test(className) ? undefined : "text-start";
}
