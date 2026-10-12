import clsx from "clsx";

import type { Tone } from "@/lib/constants";
import {
  COMMISSION_STATUS,
  DEAL_STAGE,
  LEAD_STATUS,
  MATCH_STATUS,
  OFFER_STATUS,
  PROPERTY_STATUS,
  VIEWING_STATUS,
} from "@/lib/constants";

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand ring-brand/15",
  strong: "bg-brand-100 text-brand ring-brand/25 font-semibold",
  ok: "bg-ok-bg text-ok-fg ring-ok-fg/15",
  warn: "bg-warn-bg text-warn-fg ring-warn-fg/15",
  bad: "bg-bad-bg text-bad-fg ring-bad-fg/15",
  idle: "bg-idle-bg text-idle-fg ring-idle-fg/10",
  accent: "bg-accent-50 text-accent-700 ring-accent/30",
};

export function Badge({
  tone = "idle",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />}
      {children}
    </span>
  );
}

type MetaMap = Record<string, { label: string; tone: Tone }>;

function fromMap(map: MetaMap, key: string) {
  const meta = map[key] ?? { label: key, tone: "idle" as Tone };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export const LeadStatusBadge = ({ status }: { status: string }) => fromMap(LEAD_STATUS, status);
export const PropertyStatusBadge = ({ status }: { status: string }) => fromMap(PROPERTY_STATUS, status);
export const MatchStatusBadge = ({ status }: { status: string }) => fromMap(MATCH_STATUS, status);
export const DealStageBadge = ({ stage }: { stage: string }) => fromMap(DEAL_STAGE, stage);
export const ViewingStatusBadge = ({ status }: { status: string }) => fromMap(VIEWING_STATUS, status);
export const CommissionStatusBadge = ({ status }: { status: string }) => fromMap(COMMISSION_STATUS, status);
export const OfferStatusBadge = ({ status }: { status: string }) => fromMap(OFFER_STATUS, status);
