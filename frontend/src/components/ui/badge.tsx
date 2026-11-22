import clsx from "clsx";

import type { EnumKind } from "@/lib/enums";
import { useEnums } from "@/lib/enums";
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

type MetaMap = Record<string, { tone: Tone }>;

/** A status badge: the tone comes from the table of the kind, the words from the catalogue; an unknown value from the server is shown as it is. */
function StatusBadge({ kind, map, value }: { kind: EnumKind; map: MetaMap; value: string }) {
  const enums = useEnums();
  const meta = map[value] ?? { tone: "idle" as Tone };
  return <Badge tone={meta.tone}>{enums.labelOrRaw(kind, value)}</Badge>;
}

export const LeadStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="leadStatus" map={LEAD_STATUS} value={status} />;
export const PropertyStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="propertyStatus" map={PROPERTY_STATUS} value={status} />;
export const MatchStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="matchStatus" map={MATCH_STATUS} value={status} />;
export const DealStageBadge = ({ stage }: { stage: string }) => <StatusBadge kind="dealStage" map={DEAL_STAGE} value={stage} />;
export const ViewingStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="viewingStatus" map={VIEWING_STATUS} value={status} />;
export const CommissionStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="commissionStatus" map={COMMISSION_STATUS} value={status} />;
export const OfferStatusBadge = ({ status }: { status: string }) => <StatusBadge kind="offerStatus" map={OFFER_STATUS} value={status} />;
