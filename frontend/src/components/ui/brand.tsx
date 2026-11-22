"use client";

import clsx from "clsx";
import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useCompany } from "@/lib/company";

/** The company logo, or the neutral building icon when there is none (or it fails to load). */
export function BrandMark({ className, iconClassName }: { className: string; iconClassName: string }) {
  const { logoSrc, company_name } = useCompany();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoSrc]);

  if (logoSrc && !failed) {
    return (
      <span className={clsx("flex shrink-0 items-center justify-center overflow-hidden bg-white", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt={`${company_name} logo`} className="h-full w-full object-contain p-0.5" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className={clsx("flex shrink-0 items-center justify-center", className)}>
      <Building2 className={iconClassName} aria-hidden />
    </span>
  );
}
