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

// The words people read for these values live in the message catalogue (messages/en.json, namespace `enums`) and are read with useEnums() (lib/enums.ts).
// What stays here is what is not language: the order of the values and the tone of a status badge.

/** Semantic tones shared by every status badge in the product. */
export type Tone = "brand" | "strong" | "ok" | "warn" | "bad" | "idle" | "accent";

export type OfferStatus = "submitted" | "countered" | "accepted" | "rejected" | "withdrawn";

interface Meta {
  tone: Tone;
}

export const LEAD_STATUS: Record<LeadStatus, Meta> = {
  new: { tone: "brand" },
  contacted: { tone: "idle" },
  qualified: { tone: "strong" },
  viewing: { tone: "accent" },
  offer_made: { tone: "warn" },
  closed: { tone: "ok" },
  lost: { tone: "bad" },
};

export const LEAD_SOURCES: readonly LeadSource[] = ["website", "referral", "walk_in", "social", "portal", "cold_call", "event", "other"];

export const PROPERTY_STATUS: Record<PropertyStatus, Meta> = {
  available: { tone: "ok" },
  reserved: { tone: "brand" },
  under_offer: { tone: "warn" },
  sold: { tone: "strong" },
  inactive: { tone: "idle" },
};

export const PROPERTY_TYPES: readonly PropertyType[] = ["apartment", "villa", "townhouse", "penthouse", "land", "commercial"];

export const MATCH_STATUS: Record<MatchStatus, Meta> = {
  suggested: { tone: "idle" },
  interested: { tone: "brand" },
  viewing_scheduled: { tone: "accent" },
  rejected: { tone: "bad" },
  offer_made: { tone: "warn" },
  purchased: { tone: "ok" },
};

export const DEAL_STAGE: Record<DealStage, Meta> = {
  interested: { tone: "idle" },
  viewing: { tone: "accent" },
  offer_made: { tone: "warn" },
  negotiation: { tone: "warn" },
  under_contract: { tone: "strong" },
  closed: { tone: "ok" },
  lost: { tone: "bad" },
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
  scheduled: { tone: "brand" },
  completed: { tone: "ok" },
  cancelled: { tone: "bad" },
};

export const COMMISSION_STATUS: Record<CommissionStatus, Meta> = {
  pending: { tone: "warn" },
  approved: { tone: "brand" },
  paid: { tone: "ok" },
};

export const TASK_TYPES: readonly TaskType[] = ["call", "email", "viewing", "follow_up", "document"];

export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = ["contract", "offer", "inspection_report", "identification", "agreement", "disclosure"];

export const ROLES: readonly Role[] = ["admin", "manager", "salesperson"];

export const OFFER_STATUS: Record<OfferStatus, Meta> = {
  submitted: { tone: "brand" },
  countered: { tone: "warn" },
  accepted: { tone: "ok" },
  rejected: { tone: "bad" },
  withdrawn: { tone: "idle" },
};
