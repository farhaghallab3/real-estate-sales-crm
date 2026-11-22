import { ApiError } from "./api";

// Phase 6: backend errors shown in the user's language. The backend contract is NOT changed: it sends English prose (`detail`, or `{field: ["message"]}`), and only two
// stable codes exist (`password_change_required`, `scheduling_conflict`; `token_revoked` and `token_not_valid` are in the code of the exception, not always in the body).
// So the translation is a narrow, centralized table of the backend's OWN known messages (every entry below is a string that the backend source contains; a test
// checks that), plus the HTTP status for the generic cases. Nothing else is translated:
//  * a known message becomes a catalogue key (`errors.*`) with its values (file size, seconds, ...);
//  * a status without a known message gets the generic message of that status (401, 403, 404, 429, 5xx, no connection);
//  * an unknown 4xx message is NEVER hidden: English keeps showing it as before, and in another language it follows a localized sentence ("Something went wrong: ...");
//  * a 5xx answer, a body that is not JSON, and any technical failure show a safe generic message only, never the server's text.
// ApiError.message, ApiError.data, statuses and payloads are untouched.
export type ErrorKey = keyof (typeof import("../../messages/en.json"))["errors"];
export type ErrorValues = Record<string, string | number>;
export type ErrorKind = "network" | "server" | "session" | "forbidden" | "notFound" | "rateLimited" | "known" | "unknown";

export interface ErrorDescription {
  kind: ErrorKind;
  /** The catalogue key under `errors`, or null when the message is unknown. */
  key: ErrorKey | null;
  values?: ErrorValues;
  /** For an unknown 4xx message: the server's own text (never set for 5xx). */
  detail?: string;
}

type Exact = [ErrorKey, string];
type Pattern = [ErrorKey, RegExp, (match: RegExpExecArray) => ErrorValues | undefined];

// ---- the backend's own messages (exact text) ---------------------------------------------------------------------------------------------------------
const SOLD = "This property has already been sold in another deal.";
export const EXACT_MESSAGES: Exact[] = [
  // commissions
  ["paidCommissionLocked", "Paid commissions can no longer be changed."],
  ["deductionsTooHigh", "Deductions cannot exceed the agent commission."],
  ["onlyPendingApproved", "Only pending commissions can be approved."],
  ["mustBeApprovedFirst", "Commission must be approved before it can be paid."],
  // company
  ["currencyLocked", "The base currency cannot be changed once the company has financial data."],
  ["fieldEmpty", "This field cannot be empty."],
  // deals and offers
  ["saleRecordProtected", "This record is linked to a completed sale and cannot be deleted."],
  ["recordInUse", "This record is used by other records and cannot be deleted."],
  ["dealChangedConcurrently", "This deal was changed by someone else at the same time. Please try again."],
  ["recordsChangedConcurrently", "These records were changed by someone else at the same time. Please try again."],
  ["offerAmountPositive", "Offer amount must be greater than zero."],
  ["propertySold", SOLD],
  ["propertySoldNoOffers", `${SOLD} No new offers can be recorded on it.`],
  ["propertySoldNoAccept", `${SOLD} An offer on it can no longer be accepted.`],
  ["dealGone", "This deal no longer exists."],
  ["dealClosedPriceLocked", "This deal is already closed; its sale price cannot be changed."],
  ["closedDealNoMove", "A closed deal cannot be moved."],
  ["lostReasonRequired", "A reason is required to mark a deal as lost."],
  ["offerBeforeClosing", "Record an offer amount (or sale price) before closing the deal."],
  ["offersOnlyOpenDeals", "Offers can only be recorded on open deals."],
  ["closedDealOffersLocked", "The deal is closed; its offers can no longer be changed."],
  ["openDealOwnLeads", "You can only open deals for your own leads."],
  ["duplicateOpenDeal", "There is already an open deal for this lead and property."],
  ["closedDealNoEdit", "Closed or lost deals can no longer be edited."],
  ["managersReassignDeals", "Only managers can reassign deals."],
  ["linkDealOwnLeads", "You can only link a deal to your own leads."],
  ["offersOwnDeals", "You can only record offers on your own deals."],
  ["offersOwnLeads", "You can only record offers for your own leads."],
  ["dealHasOffers", "This deal already has offers, so its client and property can no longer be changed. Open a new deal instead."],
  // documents
  ["fileEmpty", "File is empty."],
  ["uploadOwnDeals", "You can only upload documents to your own deals."],
  ["deleteDocumentRestricted", "Only the uploader or a manager can delete this document."],
  // leads
  ["budgetNegative", "Budget cannot be negative."],
  ["propertyAlreadyLinked", "This property is already linked to the lead."],
  ["managersReassignLeads", "Only managers can reassign leads."],
  ["matchOwnLeads", "You can only match properties to your own leads."],
  // properties
  ["priceMustBePositive", "Price must be greater than zero."],
  ["managersReassignProperties", "Only managers can reassign properties."],
  ["soldStatusLocked", "This property was sold in a closed deal; its status can no longer be changed."],
  ["imageOrUrl", "Provide an image file or a url."],
  ["imageFormat", "Images must be PNG, JPG or WEBP."],
  ["imageTooLarge", "Image is too large."],
  // tasks
  ["taskOwnLeads", "You can only create tasks for your own leads."],
  ["taskOwnDeals", "You can only create tasks for your own deals."],
  ["managersReassignTasks", "Only managers can reassign tasks."],
  ["taskLinkOwnLeads", "You can only link a task to your own leads."],
  ["taskLinkOwnDeals", "You can only link a task to your own deals."],
  // users and sign-in
  ["sessionRevoked", "This session is no longer valid. Please sign in again."],
  ["splitRange", "Split must be between 0 and 100."],
  ["emailTaken", "A user with this email already exists."],
  ["passwordRequired", "Password is required."],
  ["lastAdmin", "At least one active Company Admin must remain."],
  ["currentPasswordWrong", "Current password is incorrect."],
  ["passwordMustDiffer", "Choose a password different from the current one."],
  ["passwordChangeRequired", "You must change your temporary password before continuing."],
  ["badCredentials", "No active account found with the given credentials"],
  ["passwordTooCommon", "This password is too common."],
  ["passwordNumeric", "This password is entirely numeric."],
  // viewings
  ["endAfterStart", "End time must be after the start time."],
  ["onlyScheduledCompleted", "Only scheduled viewings can be completed."],
  ["onlyScheduledCancelled", "Only scheduled viewings can be cancelled."],
  ["onlyScheduledRescheduled", "Only scheduled viewings can be rescheduled."],
  ["viewingOwnLeads", "You can only schedule viewings for your own leads."],
  ["managersReassignViewings", "Only managers can reassign viewings."],
  ["viewingLinkOwnLeads", "You can only link a viewing to your own leads."],
  ["schedulingConflict", "This time overlaps with another scheduled viewing."],
  // Django REST framework and SimpleJWT defaults that reach the user
  ["notAuthenticated", "Authentication credentials were not provided."],
  ["forbidden", "You do not have permission to perform this action."],
  ["required", "This field is required."],
  ["blank", "This field may not be blank."],
  ["nullValue", "This field may not be null."],
  ["invalidEmail", "Enter a valid email address."],
  ["invalidUrl", "Enter a valid URL."],
  ["validNumber", "A valid number is required."],
  ["validInteger", "A valid integer is required."],
  ["sessionExpired", "Given token not valid for any token type"],
];

// ---- the backend's messages that carry a value --------------------------------------------------------------------------------------------------------
export const PATTERN_MESSAGES: Pattern[] = [
  ["unknownStage", /^Unknown stage '(.*)'\.$/, (m) => ({ stage: m[1] })],
  ["fileTypeNotAllowed", /^File type '(.*)' is not allowed\. Allowed: (.*)\.$/, (m) => ({ type: m[1], allowed: m[2] })],
  ["fileTooLarge", /^File exceeds the (\d+) MB limit\.$/, (m) => ({ size: Number(m[1]) })],
  ["minValue", /^Ensure this value is greater than or equal to (-?[\d.]+)\.$/, (m) => ({ value: m[1] })],
  ["maxValue", /^Ensure this value is less than or equal to (-?[\d.]+)\.$/, (m) => ({ value: m[1] })],
  ["maxLength", /^Ensure this field has no more than (\d+) characters?\.$/, (m) => ({ count: Number(m[1]) })],
  ["minLength", /^Ensure this field has at least (\d+) characters?\.$/, (m) => ({ count: Number(m[1]) })],
  ["invalidChoice", /^"(.*)" is not a valid choice\.$/, (m) => ({ value: m[1] })],
  ["invalidReference", /^Invalid pk ".*" - object does not exist\.$/, () => undefined],
  ["invalidDatetime", /^Datetime has wrong format\./, () => undefined],
  ["invalidDate", /^Date has wrong format\./, () => undefined],
  ["passwordTooShort", /^This password is too short\. It must contain at least (\d+) characters?\.$/, (m) => ({ count: Number(m[1]) })],
  ["passwordSimilar", /^The password is too similar to the .*\.$/, () => undefined],
  ["notFound", /^(Not found\.|No .* matches the given query\.)$/, () => undefined],
  ["rateLimitedWait", /^Request was throttled\. Expected available in (\d+) seconds?\.$/, (m) => ({ seconds: Number(m[1]) })],
];

const EXACT = new Map<string, ErrorKey>(EXACT_MESSAGES.map(([key, text]) => [text, key]));

/** The known catalogue key (and values) of ONE backend message, or null when the text is not one of the backend's known messages. */
export function describeMessage(text: unknown): { key: ErrorKey; values?: ErrorValues } | null {
  if (typeof text !== "string") return null;
  const message = text.trim();
  const exact = EXACT.get(message);
  if (exact) return { key: exact };
  for (const [key, pattern, values] of PATTERN_MESSAGES) {
    const match = pattern.exec(message);
    if (match) return { key, values: values(match) };
  }
  return null;
}

/** The first message of a DRF body: `detail`, then non_field_errors, then the first message of the first field, then a bare string or list. */
export function primaryMessage(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return primaryMessage(data[0]);
  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;
    if (typeof body.detail === "string") return body.detail;
    for (const key of ["non_field_errors", ...Object.keys(body).filter((k) => k !== "non_field_errors" && k !== "code" && k !== "conflicts")]) {
      const found = primaryMessage(body[key]);
      if (found) return found;
    }
  }
  return null;
}

const bodyCode = (data: unknown): string | null => (data && typeof data === "object" && typeof (data as { code?: unknown }).code === "string" ? (data as { code: string }).code : null);

/** True for a failed fetch (no connection, DNS, CORS, a dropped request): a TypeError from fetch, never an HTTP answer. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message));
}

/** What an error is, without any text: the kind, the catalogue key and its values. Pure. */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof ApiError)) return isNetworkFailure(error) ? { kind: "network", key: "network" } : { kind: "unknown", key: null };
  const { status, data } = error;
  if (status >= 500) return { kind: "server", key: "server" }; // never the server's own text: it may be a stack trace or an HTML page
  const text = primaryMessage(data);
  const known = describeMessage(text);
  const code = bodyCode(data);
  if (status === 429) {
    return known?.key === "rateLimitedWait" ? { kind: "rateLimited", ...known } : { kind: "rateLimited", key: "rateLimited" };
  }
  if (code === "password_change_required") return { kind: "known", key: "passwordChangeRequired" };
  if (code === "scheduling_conflict") return { kind: "known", key: "schedulingConflict" };
  if (code === "token_revoked") return { kind: "session", key: "sessionRevoked" };
  if (status === 401) {
    if (known?.key === "badCredentials" || known?.key === "notAuthenticated" || known?.key === "sessionRevoked") return { kind: known.key === "badCredentials" ? "known" : "session", key: known.key };
    return { kind: "session", key: "sessionExpired" };
  }
  if (known) return { kind: known.key === "notFound" ? "notFound" : known.key === "forbidden" ? "forbidden" : "known", ...known };
  if (status === 403) return { kind: "forbidden", key: "forbidden" };
  if (status === 404) return { kind: "notFound", key: "notFound" };
  return { kind: "unknown", key: null, detail: text ?? undefined };
}

export type ErrorTranslate = (key: `errors.${ErrorKey}`, values?: ErrorValues) => string;

/**
 * The text to show for an error. `fallback` is the already-translated message of the action ("Could not save the lead.") for failures that are not HTTP answers.
 *  - known: the catalogue message (English: the backend's own wording);
 *  - no connection: the network message; 5xx: the generic server message;
 *  - unknown HTTP 4xx message: English shows the server's text as before, another language shows it after a localized sentence;
 *  - anything else: the fallback, or the generic unknown message. Technical details are never shown.
 */
export function errorText(error: unknown, t: ErrorTranslate, language: string, fallback?: string): string {
  const d = describeError(error);
  if (d.key) return t(`errors.${d.key}`, d.values);
  if (d.kind === "unknown" && error instanceof ApiError) {
    const detail = d.detail ?? (error.message.startsWith("Request failed (") ? undefined : error.message);
    if (detail) return language.toLowerCase().startsWith("en") ? error.message : t("errors.unknownWithDetail", { detail });
    return t("errors.unknown");
  }
  return fallback ?? t("errors.unknown");
}

/** The DRF field errors of an error, each message translated when it is a known one and kept as it is otherwise (it stays on its own field). */
export function fieldErrorTexts(error: unknown, t: ErrorTranslate): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [field, message] of Object.entries(error.fieldErrors)) {
    const known = describeMessage(message);
    out[field] = known ? t(`errors.${known.key}`, known.values) : message;
  }
  return out;
}
