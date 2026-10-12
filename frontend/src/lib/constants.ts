import type {
  CommissionStatus,
  DealStage,
  DocumentCategory,
  LeadSource,
  LeadStatus,
  MatchStatus,
  PropertyStatus,
  PropertyType,
  Role,
  TaskType,
  ViewingStatus,
} from "@/types";

/** Semantic tones shared by every status badge in the product. */
export type Tone = "brand" | "strong" | "ok" | "warn" | "bad" | "idle" | "accent";

interface Meta {
  label: string;
  tone: Tone;
}

export const LEAD_STATUS: Record<LeadStatus, Meta> = {
  new: { label: "New", tone: "brand" },
  contacted: { label: "Contacted", tone: "idle" },
  qualified: { label: "Qualified", tone: "strong" },
  viewing: { label: "Viewing", tone: "accent" },
  offer_made: { label: "Offer Made", tone: "warn" },
  closed: { label: "Closed", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
};

export const LEAD_SOURCE: Record<LeadSource, string> = {
  website: "Website",
  referral: "Referral",
  walk_in: "Walk-in",
  social: "Social media",
  portal: "Listing portal",
  cold_call: "Cold call",
  event: "Event",
  other: "Other",
};

export const PROPERTY_STATUS: Record<PropertyStatus, Meta> = {
  available: { label: "Available", tone: "ok" },
  reserved: { label: "Reserved", tone: "brand" },
  under_offer: { label: "Under Offer", tone: "warn" },
  sold: { label: "Sold", tone: "strong" },
  inactive: { label: "Inactive", tone: "idle" },
};

export const PROPERTY_TYPE: Record<PropertyType, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
  land: "Land",
  commercial: "Commercial",
};

export const MATCH_STATUS: Record<MatchStatus, Meta> = {
  suggested: { label: "Suggested", tone: "idle" },
  interested: { label: "Interested", tone: "brand" },
  viewing_scheduled: { label: "Viewing Scheduled", tone: "accent" },
  rejected: { label: "Rejected", tone: "bad" },
  offer_made: { label: "Offer Made", tone: "warn" },
  purchased: { label: "Purchased", tone: "ok" },
};

export const DEAL_STAGE: Record<DealStage, Meta> = {
  interested: { label: "Interested", tone: "idle" },
  viewing: { label: "Viewing", tone: "accent" },
  offer_made: { label: "Offer Made", tone: "warn" },
  negotiation: { label: "Negotiation", tone: "warn" },
  under_contract: { label: "Under Contract", tone: "strong" },
  closed: { label: "Closed", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
};

export const PIPELINE_STAGES: DealStage[] = [
  "interested",
  "viewing",
  "offer_made",
  "negotiation",
  "under_contract",
  "closed",
  "lost",
];

export const VIEWING_STATUS: Record<ViewingStatus, Meta> = {
  scheduled: { label: "Scheduled", tone: "brand" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const COMMISSION_STATUS: Record<CommissionStatus, Meta> = {
  pending: { label: "Pending", tone: "warn" },
  approved: { label: "Approved", tone: "brand" },
  paid: { label: "Paid", tone: "ok" },
};

export const TASK_TYPE: Record<TaskType, string> = {
  call: "Call",
  email: "Email",
  viewing: "Viewing",
  follow_up: "Follow-up",
  document: "Document",
};

export const DOCUMENT_CATEGORY: Record<DocumentCategory, string> = {
  contract: "Contract",
  offer: "Offer",
  inspection_report: "Inspection report",
  identification: "Identification",
  agreement: "Agreement",
  disclosure: "Property disclosure",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  salesperson: "Salesperson",
};

export const OFFER_STATUS: Record<string, Meta> = {
  submitted: { label: "Submitted", tone: "brand" },
  countered: { label: "Countered", tone: "warn" },
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  withdrawn: { label: "Withdrawn", tone: "idle" },
};

export type Option<V extends string = string> = { value: V; label: string };

export function optionsOf<V extends string>(map: Record<V, string | Meta>): Option<V>[] {
  return (Object.entries(map) as [V, string | Meta][]).map(([value, meta]) => ({
    value,
    label: typeof meta === "string" ? meta : meta.label,
  }));
}
