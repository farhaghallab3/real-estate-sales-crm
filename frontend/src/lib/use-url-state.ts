"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/** Filters/sort/page live in the URL so views are shareable and survive refresh. */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const state = useMemo(() => {
    const out: Record<string, string> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const v = search.get(key);
      if (v !== null) out[key] = v;
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const set = useCallback(
    (patch: Partial<T>, resetPage = true) => {
      const next = new URLSearchParams(search.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || v === defaults[k]) next.delete(k);
        else next.set(k, String(v));
      }
      if (resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, pathname, router],
  );

  return [state, set] as const;
}
