/** Human-readable labels for activity/audit entries (admin UI is English-only). */

const ACTION_LABELS: Record<string, string> = {
  // Customer accounts (admin)
  customer_deactivated: "Account deactivated",
  customer_reactivated: "Account reactivated",
  customer_deleted: "Account deleted",
  password_reset_sent: "Password reset email sent",
  invite_sent: "Invitation sent",
  profile_updated: "Profile updated",
  promo_assigned: "Personal promo code given",
  mfa_reset: "Two-step login reset",
  export_orders: "Orders exported to Excel",
  topup_verified: "Wallet top-up verified",
  topup_rejected: "Wallet top-up rejected",
  wallet_adjusted: "Wallet balance corrected",
  ticket_created: "Support ticket opened",
  ticket_updated: "Support ticket updated",
  ticket_rated: "Support ticket rated",
  ticket_auto_closed: "Support ticket closed (no answer in 48 h)",
  tickets_cleared: "Closed support tickets cleared",
  user_signed_out: "Signed out by an admin",
  email_blocked: "Email blocked",
  export_activity: "Activity log exported to Excel",
  export_payments: "Payments exported to Excel",
  export_sales: "Sales report exported to Excel",
  export_all: "Everything exported to Excel",
  data_reset: "Test data reset",
  receipt_archive_set: "Receipt archive address changed",
  review_approved: "Review approved",
  review_rejected: "Review rejected",
  receipt_archive_backfill: "Past receipts sent to the archive",
  audit_cleared: "Old activity entries cleared",
  email_unblocked: "Email unblocked",
  security_reviewed: "Security alert cleared (reviewed)",
  promo_unassigned: "Personal promo code removed",
  promo_revoked: "Promotion revoked",
  account_approved: "Account approved",
  account_rejected: "Account rejected (deleted, email blocked)",
  courier_assigned: "Courier assigned",
  delivery_declined: "Courier declined the delivery",
  courier_on_duty: "Courier went on duty",
  courier_off_duty: "Courier went off duty",
  courier_details_updated: "Courier details updated",
  courier_paid: "Courier paid",
  courier_ringtone_set: "Courier ringtone changed",
  staff_hr_updated: "HR details updated",
  courier_unassigned: "Courier removed",
  delivery_picked_up: "Picked up by the courier",
  delivery_completed: "Delivered (customer's code checked)",
  delivery_failed: "Courier could not deliver",
  delivery_code_locked: "Delivery code locked (5 wrong tries)",
  pin_wrong: "Wrong PIN entered",
  grafana_alerts_set: "Grafana monitoring alerts switched",
  vehicle_added: "Vehicle added",
  vehicle_updated: "Vehicle changed",
  document_added: "Document uploaded",
  document_deleted: "Document deleted",
  delivery_taken: "Courier took an open delivery",
  courier_auto_assign_set: "Automatic courier assignment switched",
  delivery_monitor_set: "Delivery monitor settings changed",
  delivery_at_partner_shop: "Handed over at the partner shop (PINs checked)",
  handoff_courier_confirmed: "Courier entered the shop's PIN",
  handoff_shop_confirmed: "Shop entered the courier's PIN",
  handoff_locked: "Shop hand-over locked (5 wrong PINs)",
  partner_order_collected: "Collected by the customer at the partner shop",
  partner_shop_created: "Partner shop added",
  partner_shop_updated: "Partner shop changed",
  partner_staff_set: "Partner shop staff changed",
  partner_paid: "Partner shop paid",
  // Supabase Auth events
  login: "Signed in",
  logout: "Signed out",
  user_signedup: "Signed up",
  user_confirmation_requested: "Confirmation email requested",
  user_recovery_requested: "Password reset requested",
  user_updated_password: "Password changed",
  user_invited: "Invited",
  user_modified: "Sign-in access updated",
  user_deleted: "Account deleted",
  user_repeated_signup: "Tried to sign up again",
  user_reauthenticate_requested: "Re-authentication requested",
  // Purchases
  order_placed: "Placed order",
  order_status: "Order status changed",
  payment_submitted: "Submitted payment receipt",
  payment_verified: "Payment verified",
  payment_rejected: "Payment rejected",
  printing_submitted: "Submitted printing job",
  // Generic audit log
  order_assign: "Order assigned",
  printing_quote: "Printing job quoted",
  printing_files_deleted: "Printing files deleted (retention)",
  notification_retry: "Notification retried",
  insert: "Created",
  update: "Changed",
  delete: "Deleted",
};

export const ENTITY_LABELS: Record<string, string> = {
  customer_account: "Customer account",
  support_ticket: "Support ticket",
  order: "Order",
  payment_submission: "Payment",
  printing_job: "Printing job",
  products: "Product",
  bank_accounts: "Bank account",
  website_settings: "Website settings",
  delivery_zones: "Delivery zone",
  printing_price_rules: "Printing prices",
  profiles: "Staff member",
  role_permissions: "Role permissions",
  promotions: "Promotion",
  notification: "Notification",
  export: "Export",
  security: "Security",
  audit: "Activity log",
  product_review: "Product review",
  data: "Data reset",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ");
}

export const entityLabel = (type: string) => ENTITY_LABELS[type] ?? type.replaceAll("_", " ");

const HIDDEN_FIELDS = new Set(["updated_at", "created_at", "search_vector", "effective_price_etb"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** "field: old → new" for every field that changed (insert/delete: the values that were set). */
export function describeChanges(before: unknown, after: unknown, limit = 12): string[] {
  const b = obj(before);
  const a = obj(after);
  if (!b && !a) return [];
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].filter((k) => !HIDDEN_FIELDS.has(k));
  const out: string[] = [];
  for (const k of keys) {
    const bv = b?.[k];
    const av = a?.[k];
    if (b && a) {
      if (JSON.stringify(bv) === JSON.stringify(av)) continue;
      out.push(`${k}: ${show(bv)} → ${show(av)}`);
    } else {
      if (bv === null || av === null) continue;
      out.push(`${k}: ${show(a ? av : bv)}`);
    }
  }
  return out.length > limit ? [...out.slice(0, limit), `… ${out.length - limit} more`] : out;
}

/** "3 h ago", "2 d ago" — coarse, for follow-up lists. */
export function waitingFor(since: string | Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(since).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}
