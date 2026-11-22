"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

import {
  COMMISSION_STATUS,
  DEAL_STAGE,
  DOCUMENT_CATEGORIES,
  LEAD_SOURCES,
  LEAD_STATUS,
  MATCH_STATUS,
  OFFER_STATUS,
  PROPERTY_STATUS,
  PROPERTY_TYPES,
  ROLES,
  TASK_TYPES,
  VIEWING_STATUS,
  type OfferStatus,
} from "@/lib/constants";
import type { CommissionStatus, DealStage, DocumentCategory, LeadSource, LeadStatus, MatchStatus, PropertyStatus, PropertyType, Role, TaskType, ViewingStatus } from "@/types";

// The words of every enumerated value (a status, a stage, a type...) come from the catalogue, namespace `enums`: one entry per ENTITY, never shared
// between entities (ADR-0001 2.5: a deal that is "Closed" and a lead that is "Closed" may need different words in another language).

export interface EnumValues {
  leadStatus: LeadStatus;
  leadSource: LeadSource;
  propertyStatus: PropertyStatus;
  propertyType: PropertyType;
  matchStatus: MatchStatus;
  dealStage: DealStage;
  viewingStatus: ViewingStatus;
  commissionStatus: CommissionStatus;
  taskType: TaskType;
  documentCategory: DocumentCategory;
  role: Role;
  offerStatus: OfferStatus;
}
export type EnumKind = keyof EnumValues;

export interface Option<V extends string = string> {
  value: V;
  label: string;
}

/** The values of each kind, in display order. */
const VALUES: { [K in EnumKind]: readonly EnumValues[K][] } = {
  leadStatus: Object.keys(LEAD_STATUS) as LeadStatus[],
  leadSource: LEAD_SOURCES,
  propertyStatus: Object.keys(PROPERTY_STATUS) as PropertyStatus[],
  propertyType: PROPERTY_TYPES,
  matchStatus: Object.keys(MATCH_STATUS) as MatchStatus[],
  dealStage: Object.keys(DEAL_STAGE) as DealStage[],
  viewingStatus: Object.keys(VIEWING_STATUS) as ViewingStatus[],
  commissionStatus: Object.keys(COMMISSION_STATUS) as CommissionStatus[],
  taskType: TASK_TYPES,
  documentCategory: DOCUMENT_CATEGORIES,
  role: ROLES,
  offerStatus: Object.keys(OFFER_STATUS) as OfferStatus[],
};

/** `label(kind, value)` and `options(kind)` for every enumerated value, read from the message catalogue. */
export function useEnums() {
  const t = useTranslations();
  return useMemo(() => {
    // one typed key per kind: the compiler checks every value of the union against the catalogue
    const names: { [K in EnumKind]: (value: EnumValues[K]) => string } = {
      leadStatus: (v) => t(`enums.leadStatus.${v}`),
      leadSource: (v) => t(`enums.leadSource.${v}`),
      propertyStatus: (v) => t(`enums.propertyStatus.${v}`),
      propertyType: (v) => t(`enums.propertyType.${v}`),
      matchStatus: (v) => t(`enums.matchStatus.${v}`),
      dealStage: (v) => t(`enums.dealStage.${v}`),
      viewingStatus: (v) => t(`enums.viewingStatus.${v}`),
      commissionStatus: (v) => t(`enums.commissionStatus.${v}`),
      taskType: (v) => t(`enums.taskType.${v}`),
      documentCategory: (v) => t(`enums.documentCategory.${v}`),
      role: (v) => t(`enums.role.${v}`),
      offerStatus: (v) => t(`enums.offerStatus.${v}`),
    };
    const label = <K extends EnumKind>(kind: K, value: EnumValues[K]): string => (names[kind] as (v: EnumValues[K]) => string)(value);
    const options = <K extends EnumKind>(kind: K): Option<EnumValues[K]>[] => VALUES[kind].map((value) => ({ value, label: label(kind, value) }));
    /** For a value that comes from the server and may be unknown: the raw value is shown when the catalogue has no entry for it. */
    const labelOrRaw = <K extends EnumKind>(kind: K, value: string): string => ((VALUES[kind] as readonly string[]).includes(value) ? label(kind, value as EnumValues[K]) : value);
    return { label, options, labelOrRaw };
  }, [t]);
}
