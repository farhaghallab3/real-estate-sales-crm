export type Role = "admin" | "manager" | "salesperson";

export interface UserMini {
  id: number;
  full_name: string;
  role: Role;
}

export interface User extends UserMini {
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  job_title: string;
  commission_split?: string;
  is_active?: boolean;
  date_joined?: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ---- Leads
export type LeadStatus = "new" | "contacted" | "qualified" | "viewing" | "offer_made" | "closed" | "lost";
export type LeadSource =
  | "website" | "referral" | "walk_in" | "social" | "portal" | "cold_call" | "event" | "other";

export interface LeadMini {
  id: number;
  name: string;
  phone: string;
  email: string;
  status: LeadStatus;
}

export interface Lead extends LeadMini {
  first_name: string;
  last_name: string;
  source: LeadSource;
  budget: string | null;
  preferred_location: string;
  lost_reason: string;
  assigned_to: UserMini | null;
  last_activity_at: string | null;
  next_follow_up: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadInput {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  source: LeadSource;
  budget: string | number | null;
  preferred_location: string;
  assigned_to_id?: number | null;
}

export interface LeadNote {
  id: number;
  body: string;
  author: UserMini | null;
  created_at: string;
}

export interface Activity {
  id: number;
  kind: string;
  message: string;
  actor: UserMini | null;
  lead: number | null;
  lead_name: string | null;
  property: number | null;
  deal: number | null;
  created_at: string;
}

// ---- Properties
export type PropertyStatus = "available" | "reserved" | "under_offer" | "sold" | "inactive";
export type PropertyType = "apartment" | "villa" | "townhouse" | "penthouse" | "land" | "commercial";

export interface PropertyMini {
  id: number;
  reference: string;
  title: string;
  address: string;
  city: string;
  price: string;
  status: PropertyStatus;
  property_type: PropertyType;
}

export interface Property extends PropertyMini {
  bedrooms: number;
  bathrooms: number;
  area_sqm: string | null;
  description: string;
  assigned_to: UserMini | null;
  cover_image: string | null;
  image_count: number;
  created_at: string;
  updated_at: string;
}

export interface PropertyImage {
  id: number;
  src: string;
  caption: string;
}

export interface PropertyDetail extends Property {
  images: PropertyImage[];
  interested_leads: LeadProperty[];
  viewings: Viewing[];
  offers: Offer[];
  open_deals: Deal[];
}

export interface PropertyInput {
  title: string;
  address: string;
  city: string;
  price: string | number;
  property_type: PropertyType;
  bedrooms: number | string;
  bathrooms: number | string;
  area_sqm: string | number | null;
  status: PropertyStatus;
  description: string;
  assigned_to_id?: number | null;
}

// ---- Lead ↔ Property
export type MatchStatus =
  | "suggested" | "interested" | "viewing_scheduled" | "rejected" | "offer_made" | "purchased";

export interface LeadProperty {
  id: number;
  lead: LeadMini;
  property: PropertyMini;
  status: MatchStatus;
  note: string;
  added_by: UserMini | null;
  assigned_to: UserMini | null;
  created_at: string;
  updated_at: string;
}

// ---- Tasks
export type TaskType = "call" | "email" | "viewing" | "follow_up" | "document";
export type TaskScope = "all" | "today" | "upcoming" | "overdue" | "completed";

export interface Task {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  status: "pending" | "completed";
  due_at: string;
  completed_at: string | null;
  is_overdue: boolean;
  assigned_to: UserMini | null;
  lead: LeadMini | null;
  property: PropertyMini | null;
  deal_id: number | null;
  created_at: string;
}

export interface TaskInput {
  title: string;
  description?: string;
  type: TaskType;
  due_at: string;
  lead_id?: number | null;
  property_id?: number | null;
  deal_id?: number | null;
  assigned_to_id?: number | null;
}

// ---- Viewings
export type ViewingStatus = "scheduled" | "completed" | "cancelled";

export interface Viewing {
  id: number;
  lead: LeadMini;
  property: PropertyMini;
  assigned_to: UserMini | null;
  start_at: string;
  end_at: string;
  status: ViewingStatus;
  feedback: string;
  rating: number | null;
  created_at: string;
}

export interface ViewingConflict {
  id: number;
  start_at: string;
  end_at: string;
  lead: string;
  property: string;
  assigned_to: string | null;
  reasons: ("salesperson" | "property")[];
}

// ---- Deals
export type DealStage =
  | "interested" | "viewing" | "offer_made" | "negotiation" | "under_contract" | "closed" | "lost";

export interface Deal {
  id: number;
  lead: LeadMini;
  property: PropertyMini;
  assigned_to: UserMini | null;
  stage: DealStage;
  stage_label: string;
  offer_amount: string | null;
  sale_price: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  lost_reason: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Offer {
  id: number;
  deal: number;
  lead: LeadMini;
  property: PropertyMini;
  amount: string;
  status: "submitted" | "countered" | "accepted" | "rejected" | "withdrawn";
  conditions: string;
  notes: string;
  submitted_by: UserMini | null;
  created_at: string;
}

export interface DealDetail extends Deal {
  offers: Offer[];
  commission: Commission | null;
}

export interface PipelineColumn {
  stage: DealStage;
  label: string;
  count: number;
  value: string;
  deals: Deal[];
}

// ---- Commissions
export type CommissionStatus = "pending" | "approved" | "paid";

export interface Commission {
  id: number;
  deal: number;
  property: PropertyMini;
  client: string;
  lead_id: number;
  salesperson: UserMini | null;
  sale_price: string;
  commission_rate: string;
  gross_commission: string;
  agent_split: string;
  agent_commission: string;
  deductions: string;
  net_commission: string;
  status: CommissionStatus;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
}

// ---- Documents
export type DocumentCategory =
  | "contract" | "offer" | "inspection_report" | "identification" | "agreement" | "disclosure";

export interface DocumentItem {
  id: number;
  deal: number;
  deal_label: string;
  category: DocumentCategory;
  category_label: string;
  name: string;
  size: number;
  content_type: string;
  uploaded_by: UserMini | null;
  created_at: string;
}

export interface ChecklistItem {
  category: DocumentCategory;
  label: string;
  required: boolean;
  count: number;
  complete: boolean;
}

// ---- Notifications
export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  is_read: boolean;
  created_at: string;
}

// ---- Dashboard / analytics
export interface Metrics {
  total_leads: number;
  new_leads: number;
  qualified_leads: number;
  active_deals: number;
  viewings: number;
  offers: number;
  closed_deals: number;
  sales_value: number | string;
  commission: number | string;
  conversion_rate: number;
}

export interface PipelineSummary {
  stage: DealStage;
  label: string;
  count: number;
  value: number | string;
}

export interface TeamRow {
  user_id: number;
  name: string;
  leads: number;
  viewings: number;
  offers: number;
  closed_deals: number;
  sales_value: number | string;
  commission: number | string;
}

export interface Dashboard {
  scope: "team" | "personal";
  period_days: number;
  metrics: Metrics;
  todays_tasks: Task[];
  upcoming_viewings: Viewing[];
  recent_leads: Lead[];
  pipeline: PipelineSummary[];
  recent_activity: Activity[];
  team: TeamRow[];
}

export interface AnalyticsSummary {
  metrics: Metrics;
  pipeline: PipelineSummary[];
  team: TeamRow[];
  funnel: Record<LeadStatus, number>;
  sources: { source: LeadSource; label: string; leads: number; closed: number }[];
  monthly: { month: string; leads: number; closed_deals: number; sales_value: number | string }[];
}
