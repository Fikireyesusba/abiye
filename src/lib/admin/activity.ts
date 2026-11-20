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
