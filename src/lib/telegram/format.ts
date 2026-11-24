/**
 * Telegram message builders (parse_mode = HTML). Every value that can come from
 * a customer is escaped: Telegram's HTML mode would otherwise let a crafted
 * name or note inject links/formatting into the staff chat.
 */
import { actionLabel, entityLabel } from "@/lib/admin/activity";
import { APP_TIME_LABEL, zoneStamp } from "@/lib/datetime";
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const etb = (n: unknown) => `${Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ETB`;
const phone = (p: unknown) => {
  const s = String(p ?? "");
  return /^\+251\d{9}$/.test(s) ? `+251 ${s.slice(4, 6)} ${s.slice(6, 9)} ${s.slice(9)}` : s;
};
const line = (label: string, value: unknown) => `${label}: ${esc(value)}`;

export interface OutboxRow {
  id: number;
  event_type: string;
  payload: Record<string, unknown>;
  attachment_bucket: string | null;
  attachment_path: string | null;
}

export interface BuiltMessage {
  text: string;
  /** Private receipt to attach (bucket/path), if any. */
  attachment: { bucket: string; path: string } | null;
}

/** Build the staff message for an outbox row. `appUrl` is used for admin deep links. */
export function buildMessage(row: OutboxRow, appUrl: string): BuiltMessage {
  const msg = buildBody(row, appUrl);
  const [service, event] = describe(row);
  const p = row.payload ?? {};
  // People are named by User ID only: drop name / phone / email lines (security alerts keep the email
  // that was tried when it is not one of our accounts — it is what can be blocked).
  const known = typeof p.user_id === "string" && /^[1-9][0-9]{5}$/.test(p.user_id);
  let text = msg.text
    .split("\n")
    .filter((l) => !/^(Customer|Phone|To|Account|Name|Customer name)( [^:]*)?: /.test(l) && !(known && /^Email: /.test(l))
      && !(p.by_user_id && /^(By|Approved by|Rejected by|Decided by|Handled by|Verified by): /.test(l)))
    .join("\n");
  // Every message: title, then service · type, who it is about (User ID) and who acted.
  const head = [
    `<i>Service: ${esc(service)} · Type: ${esc(event)}</i>`,
    ...(known ? [line("User ID", p.user_id)] : []),
    ...(typeof p.by_user_id === "string" && p.by_user_id ? [line("Action by User ID", p.by_user_id)] : []),
  ].join("\n");
  const nl = text.indexOf("\n");
  text = nl < 0 ? `${text}\n${head}` : `${text.slice(0, nl)}\n${head}${text.slice(nl)}`;
  // …and what to do next, before the admin link.
  const tip = suggestedAction(row);
  if (tip) {
    const link = text.lastIndexOf("\n\n<a href=");
    const add = `\n\n👉 <b>Suggested action:</b> ${esc(tip)}`;
    text = link < 0 ? text + add : `${text.slice(0, link)}${add}${text.slice(link)}`;
  }
  return { ...msg, text };
}

/** The next step for staff, per alert type. */
export function suggestedAction(row: OutboxRow): string | null {
  const p = row.payload ?? {};
  switch (row.event_type) {
    case "new_order":
    case "payment_resubmitted":
      return "Find this amount and reference in the bank statement, then Verify or Reject the payment under Payments.";
    case "payment_verified":
    case "wallet_order_paid":
      return "Prepare the order (pack or print it), then mark it Ready for pickup / Out for delivery.";
    case "wallet_topup":
      return "Find this amount and reference in the bank statement, then Approve or Reject the top-up under Wallet.";
    case "topup_verified":
      return "Nothing to do — the balance was credited and the customer was told.";
    case "topup_rejected":
      return "Nothing to do — the customer was told the reason. If the money arrives later, ask them to send a new top-up.";
    case "receipt_record":
      return "Keep this receipt for your accounting.";
    case "printing_document":
      return "Print with the options shown, then mark the job Ready in Printing.";
    case "low_stock":
      return "Reorder this product, then add the new stock under Inventory.";
    case "out_of_stock":
      return "Restock as soon as possible — customers cannot buy it now (they can ask to be told when it is back).";
    case "security_event":
      if (p.kind === "admin_login_success") return "If this was not one of your staff, reset their password and two-step login under Staff right away.";
      if (p.kind === "rate_limited") return "Watch for repeats; block the email under Security if it continues.";
      if (p.kind === "login_blocked" || p.kind === "signup_blocked") return "Nothing to do — the email is already blocked.";
      if (p.kind === "upload_blocked") return "The file was deleted. Check this customer under Security; block the email if it happens again or looks deliberate.";
      if (p.kind === "scan_unavailable") return "Customers cannot upload files right now. Check CLOUDMERSIVE_API_KEY in Vercel and your Cloudmersive plan (monthly limit).";
      return "If you do not recognise this, block the email under Security; otherwise no action is needed.";
    case "security_alert":
      return "Open Security → Active alerts: block the email if it looks malicious, or mark it reviewed.";
    case "admin_action":
      return "Nothing to do if this change was expected; otherwise check it in the Activity log.";
    case "promotion_alert":
      if (p.change === "used") return "Nothing to do — keep this for any complaint (the Promotions Excel lists every use).";
      if (p.change === "revoked" || p.change === "deleted" || p.change === "removed") return "Nothing to do if this was expected; otherwise ask the staff member why (Activity log).";
      return "If you did not expect this promotion change, revoke the promotion under Promotions and check the Activity log.";
    case "account_pending":
      return "Check the details under Account approvals, then approve or reject (with a reason).";
    case "delivery_update":
      if (p.step === "failed") return "Call the customer, then re-assign the courier (or arrange pickup) on the order.";
      if (p.step === "code_locked") return "Call the customer and the courier; re-assign the courier on the order to unlock the code.";
      return "Nothing to do — the customer sees the progress on their order page.";
    case "excel_export":
      return "Keep this file as your copy. If nobody on your team downloaded it, check who did (Action by User ID).";
    case "notification_copy":
      return p.status === "dead" ? "The message could not be delivered — contact the customer another way (Support or phone)." : null;
    case "support_ticket":
      return "Assign the ticket and answer the customer under Support tickets.";
    case "support_reply":
      return "Answer the customer under Support tickets.";
    case "support_rating":
      return Number(p.rating) <= 2 ? "Low rating — read the ticket and follow up with the customer." : "Nothing to do — thank the team.";
    case "security_test": case "stock_test": case "receipts_test": case "printing_test": case "support_test": case "test_message":
      return "Nothing to do — this group is connected.";
    default:
      return null;
  }
}

const SECURITY_KIND: Record<string, [string, string]> = {
  admin_login_failed: ["Admin sign-in", "Wrong password"],
  admin_login_not_staff: ["Admin sign-in", "Non-staff account tried the admin panel"],
  admin_mfa_failed: ["Admin sign-in", "Wrong two-step code"],
  admin_login_success: ["Admin sign-in", "Signed in (password + two-step code)"],
  customer_login_failed: ["Customer sign-in", "Wrong password"],
  staff_customer_login: ["Customer sign-in", "Staff account tried the customer side"],
  login_blocked: ["Customer sign-in", "Blocked email tried to sign in"],
  signup_blocked: ["Customer sign-up", "Blocked email tried to sign up"],
  rate_limited: ["Rate limiter", "Too many attempts"],
  upload_blocked: ["File scan", "Upload blocked (virus / unsafe content)"],
  scan_unavailable: ["File scan", "Scanner unavailable — upload refused"],
};
const CHANNEL: Record<string, string> = { email: "Customer email", push: "Phone notification", archive: "Receipt archive (email)" };
const CUSTOMER_EVENT: Record<string, string> = {
  customer_order_placed: "Order placed (how to pay)", customer_order_confirmed: "Payment confirmed", customer_order_payment_rejected: "Payment rejected",
  customer_order_ready_for_pickup: "Ready for pickup", customer_order_out_for_delivery: "Out for delivery", customer_order_completed: "Order completed",
  customer_order_cancelled: "Order cancelled", customer_order_expired: "Order expired", customer_printing_quote_ready: "Printing price ready",
  customer_printing_ready: "Printing ready", customer_topup_verified: "Top-up verified", customer_topup_rejected: "Top-up rejected",
  customer_back_in_stock: "Back in stock", customer_promo_gift: "Personal discount code sent", staff_low_stock: "Low stock (staff email)", staff_out_of_stock: "Sold out (staff email)",
  receipt_archive: "Receipt archived",
};
const ORDER_STEP: Record<string, string> = {
  processing: "Being prepared", ready_for_pickup: "Ready for pickup", out_for_delivery: "Out for delivery",
  completed: "Collected / delivered (completed)", expired: "Expired (not paid in time)",
};
const PRINT_STEP: Record<string, string> = {
  awaiting_payment: "Price quoted (awaiting payment)", printing: "Paid — printing", ready: "Ready for pickup",
  completed: "Collected / delivered (completed)", cancelled: "Cancelled",
};
const SUPPORT_TOPIC: Record<string, string> = {
  order: "An order", payment: "A payment", delivery: "Delivery or pickup", printing: "Printing service", wallet: "My balance",
  account: "My account", product: "A product", app: "Website or app problem", other: "Other",
};
const titleCase = (s: string) => s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

const DELIVERY_STEP: Record<string, string> = {
  assigned: "Assigned to a courier", picked_up: "Picked up — on the way", delivered: "Delivered (code checked)",
  failed: "Could not deliver", code_locked: "Delivery code locked (5 wrong tries)",
};
const PROMO_CHANGE: Record<string, string> = {
  created: "Created", changed: "Changed", switched_on: "Switched on", switched_off: "Switched off", revoked: "Revoked",
  restored: "Brought back", deleted: "Deleted", given: "Code given to a customer", removed: "Code removed from a customer", used: "Code used",
};

/** [service, event name] for any outbox row. */
export function describe(row: OutboxRow): [string, string] {
  const p = row.payload ?? {};
  switch (row.event_type) {
    case "new_order": return [p.printing ? "Printing payments" : "Payments", "Receipt uploaded — verify payment"];
    case "order_placed": return ["Orders", "Order placed (awaiting payment)"];
    case "order_status": return ["Orders", ORDER_STEP[String(p.to)] ?? titleCase(String(p.to ?? ""))];
    case "printing_status": return ["Printing", PRINT_STEP[String(p.to)] ?? titleCase(String(p.to ?? ""))];
    case "security_test": return ["Security group", "Test message"];
    case "stock_test": return ["Stock group", "Test message"];
    case "receipts_test": return ["Receipts group", "Test message"];
    case "promotion_alert": return ["Promotions", PROMO_CHANGE[String(p.change)] ?? titleCase(String(p.change ?? "change"))];
    case "excel_export": return ["Exports", `Excel: ${String(p.title ?? "file")}`];
    case "account_pending": return ["Customer accounts", "New account waiting for approval"];
    case "delivery_update": return ["Deliveries", DELIVERY_STEP[String(p.step)] ?? titleCase(String(p.step ?? ""))];
    case "printing_test": return ["Printing group", "Test message"];
    case "support_test": return ["Support group", "Test message"];
    case "support_ticket": return ["Support", "New ticket"];
    case "support_reply": return ["Support", "Customer replied"];
    case "support_rating": return ["Support", "Ticket rated"];
    case "printing_document": return ["Printing", p.stage === "payment_submitted" ? "Document (payment submitted)" : "Document to print (paid)"];
    case "receipt_record": return [p.kind === "wallet_topup" ? "Wallet top-up receipt" : "Payment receipt", p.result === "rejected" ? "Rejected" : "Verified"];
    case "payment_resubmitted": return ["Payments", "Receipt resubmitted"];
    case "printing_request": return ["Printing", "New printing request"];
    case "payment_verified": return ["Payments", "Payment verified"];
    case "topup_verified": return ["Wallet", "Top-up approved"];
    case "topup_rejected": return ["Wallet", "Top-up rejected"];
    case "payment_rejected": return ["Payments", "Payment rejected"];
    case "order_cancelled": return ["Orders", "Order cancelled"];
    case "wallet_topup": return ["Wallet", "Top-up to verify"];
    case "wallet_order_paid": return ["Wallet", "Order paid with balance"];
    case "low_stock": return ["Inventory", "Low stock"];
    case "out_of_stock": return ["Inventory", "Sold out"];
    case "test_message": return ["Telegram", "Test message"];
    case "security_event": return SECURITY_KIND[String(p.kind)] ?? ["Security", titleCase(String(p.kind ?? "event"))];
    case "security_alert": return ["Security monitor", "High-risk email"];
    case "admin_action": return [entityLabel(String(p.entity_type ?? "admin")), actionLabel(String(p.action ?? "action"))];
    case "notification_copy": return [CHANNEL[String(p.channel)] ?? titleCase(String(p.channel ?? "notification")), CUSTOMER_EVENT[String(p.event)] ?? titleCase(String(p.event ?? ""))];
    default: return ["Shop", titleCase(row.event_type)];
  }
}

const addisTime = (iso: unknown) =>
  typeof iso === "string" ? `${zoneStamp(iso)} (${APP_TIME_LABEL})` : "";
const short = (v: unknown, n = 300) => {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function buildBody(row: OutboxRow, appUrl: string): BuiltMessage {
  const p = row.payload ?? {};
  const admin = (path: string) => (appUrl ? `\n\n<a href="${esc(`${appUrl}${path}`)}">Open in admin</a>` : "");
  const orderLink = p.order_id ? admin(`/admin/orders/${p.order_id}`) : p.order_number ? admin(`/admin/orders?q=${encodeURIComponent(String(p.order_number))}`) : "";
  const attachment = row.attachment_bucket && row.attachment_path ? { bucket: row.attachment_bucket, path: row.attachment_path } : null;

  switch (row.event_type) {
    case "new_order":
    case "payment_resubmitted": {
      const items = Array.isArray(p.items) ? (p.items as { name?: unknown; quantity?: unknown }[]) : [];
      const address = p.fulfillment_method === "pickup" ? "Pickup at shop" : [p.city, p.address_line].filter(Boolean).join(" — ");
      const ref = p.transaction_reference ? esc(p.transaction_reference) : "—";
      const reused = p.reference_seen_before ? " ⚠️ <b>also used on another order</b>" : "";
      return {
        attachment,
        text: [
          p.printing ? `🖨 <b>PRINTING ORDER — ${p.resubmission || row.event_type === "payment_resubmitted" ? "PAYMENT RESUBMITTED" : "PAYMENT TO VERIFY"}</b>`
            : p.resubmission || row.event_type === "payment_resubmitted" ? "🔁 <b>PAYMENT RESUBMITTED</b>" : "🛒 <b>NEW CUSTOMER ORDER</b>",
          "",
          line("Order ID", p.order_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          "Products:",
          ...items.slice(0, 30).map((i) => `• ${esc(i.name)} × ${esc(i.quantity)}`),
          ...(items.length > 30 ? [`• … and ${items.length - 30} more`] : []),
          "",
          `Total: <b>${esc(etb(p.total_etb))}</b>`,
          "Payment Method: Bank Transfer",
          `Transaction Reference: ${ref}${reused}`,
          "Payment Status: Pending Verification",
          line("Delivery Address", address),
        ].join("\n") + orderLink,
      };
    }
    case "printing_request": {
      const opts = `${p.color_mode === "color" ? "Colour" : "B/W"} · ${esc(p.paper_size)} · ${esc(p.sides)}-sided · ${esc(p.copies)} cop${p.copies === 1 ? "y" : "ies"}`;
      return {
        attachment: null,
        text: [
          "🖨 <b>NEW PRINTING REQUEST</b>",
          "",
          line("Job", p.job_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          `Options: ${opts}`,
          line("Files", p.file_count),
          p.page_count ? line("Pages", p.page_count) : "Pages: not counted (Word file)",
          p.total_etb ? `Price: <b>${esc(etb(p.total_etb))}</b> (waiting for payment)` : "⚠️ <b>Needs a quote</b> before the customer can pay",
        ].join("\n") + (p.job_id ? admin(`/admin/printing/${p.job_id}`) : ""),
      };
    }
    case "payment_verified":
      return { attachment: null, text: `✅ <b>PAYMENT VERIFIED</b>\n\n${line("Order", p.order_number)}\nAmount: ${esc(etb(p.total_etb))}${orderLink}` };
    case "topup_rejected":
      return {
        attachment: null,
        text: [
          "❌ <b>TOP-UP REJECTED</b>",
          "",
          line("Top-up", p.number),
          `Amount: <b>${esc(etb(p.amount_etb))}</b>`,
          line("Reference", p.reference ?? "—"),
          line("User ID", p.user_id ?? "—"),
          line("Reason", p.reason ?? "—"),
          line("Rejected by", p.decided_by ?? "—"),
        ].join("\n") + (p.topup_id ? admin(`/admin/wallet/${p.topup_id}`) : ""),
      };
    case "topup_verified":
      return {
        attachment: null,
        text: [
          "✅ <b>TOP-UP APPROVED</b>",
          "",
          line("Top-up", p.number),
          `Amount: <b>${esc(etb(p.amount_etb))}</b>`,
          line("Reference", p.reference ?? "—"),
          line("User ID", p.user_id ?? "—"),
          line("New balance", etb(p.balance_etb)),
          line("Approved by", p.decided_by ?? "—"),
        ].join("\n") + (p.topup_id ? admin(`/admin/wallet/${p.topup_id}`) : ""),
      };
    case "payment_rejected":
      return {
        attachment: null,
        text: `❌ <b>PAYMENT REJECTED</b>\n\n${line("Order", p.order_number)}\nAmount: ${esc(etb(p.total_etb))}\n${line("Reason", p.note)}${orderLink}`,
      };
    case "order_cancelled":
      return {
        attachment: null,
        text: `🚫 <b>ORDER CANCELLED</b>\n\n${line("Order", p.order_number)}\n${line("Reason", p.note)}${p.refund_required ? "\n⚠️ <b>Payment was verified — a refund is required.</b>" : ""}${orderLink}`,
      };
    case "wallet_topup":
      return {
        attachment,
        text: [
          "💰 <b>WALLET TOP-UP TO VERIFY</b>",
          "",
          line("Request", p.topup_number),
          line("Customer", p.customer),
          line("Amount", `${esc(p.amount_etb)} ETB`),
          line("Reference", p.transaction_reference ?? "—") + (p.reference_seen_before ? " ⚠️ <b>reference/receipt seen before</b>" : ""),
          "",
          "Check your bank account before verifying.",
        ].join("\n") + admin("/admin/wallet"),
      };
    case "wallet_order_paid": {
      const items = Array.isArray(p.items) ? (p.items as { name?: unknown; quantity?: unknown }[]) : [];
      return {
        attachment: null,
        text: [
          "💳 <b>NEW ORDER — PAID WITH BALANCE</b>",
          "",
          line("Order ID", p.order_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          "Products:",
          ...items.slice(0, 30).map((i) => `• ${esc(i.name)} × ${esc(i.quantity)}`),
          "",
          line("Total", `${esc(p.total_etb)} ETB`),
          line("Delivery", p.fulfillment_method === "pickup" ? "Pickup at shop" : [p.city, p.address_line].filter(Boolean).join(" — ")),
        ].join("\n") + orderLink,
      };
    }
    case "low_stock":
    case "out_of_stock":
      return {
        attachment: null,
        text: [
          row.event_type === "out_of_stock" ? "⛔ <b>SOLD OUT</b>" : "📉 <b>LOW STOCK</b>",
          "",
          line("Product", p.name),
          line("SKU", p.sku),
          line("In stock", p.stock) + (row.event_type === "low_stock" ? ` (alert level ${esc(p.threshold)})` : ""),
          "",
          row.event_type === "out_of_stock" ? "Customers can ask to be told when it is back." : "Reorder soon.",
        ].join("\n") + admin(p.product_id ? `/admin/products/${p.product_id}` : "/admin/inventory?filter=low"),
      };
    case "security_event": {
      const [service, what] = SECURITY_KIND[String(p.kind)] ?? ["Security", String(p.kind)];
      const details = p.details && typeof p.details === "object" ? Object.entries(p.details as Record<string, unknown>).filter(([, v]) => v !== null && v !== "") : [];
      const icon = p.kind === "admin_login_success" ? "✅" : String(p.kind).startsWith("admin_") ? "🔐" : p.kind === "rate_limited" ? "⏱" : "🔒";
      return {
        attachment: null,
        text: [
          `${icon} <b>SECURITY: ${esc(what.toUpperCase())}</b>`,
          "",
          line("What happened", `${what} (${service})`),
          line("Email used", p.email ?? "—") + (p.is_staff ? " · <b>staff account</b>" : ""),
          ...(p.account ? [line("Account", p.account)] : []),
          line("Network", p.network ?? "—"),
          ...(p.device ? [line("Device", short(p.device, 160))] : []),
          ...details.map(([k, v]) => line(titleCase(k), short(v, 120))),
          ...(Number(p.repeats) > 1 ? [`Repeated: <b>× ${esc(p.repeats)}</b> within 5 minutes`] : []),
          line("When", addisTime(p.at)),
        ].join("\n") + admin(`/admin/security?tab=events${p.email ? `&email=${encodeURIComponent(String(p.email))}` : ""}`),
      };
    }
    case "security_alert":
      return {
        attachment: null,
        text: [
          "🚨 <b>SECURITY ALERT: HIGH-RISK EMAIL</b>",
          "",
          line("Email", p.email) + (p.is_staff ? " · <b>this is a STAFF account</b>" : p.has_account ? " · has a customer account" : " · no account"),
          line("Risk score (24 h)", p.score),
          line("Latest", SECURITY_KIND[String(p.last_kind)]?.[1] ?? p.last_kind),
          line("Network", p.network ?? "—"),
          line("When", addisTime(p.at)),
          "",
          p.is_staff ? "Check with this staff member; reset their two-step login under Staff if needed." : "Open Security → block the email, or mark it as reviewed if it is fine.",
        ].join("\n") + admin("/admin/security?tab=emails"),
      };
    case "promotion_alert": {
      const when = (v: unknown) => (typeof v === "string" ? addisTime(v) : "—");
      const used = p.change === "used";
      return {
        attachment: null,
        text: [
          `${used ? "🏷" : "🛡"} <b>PROMOTION: ${esc((PROMO_CHANGE[String(p.change)] ?? String(p.change ?? "changed")).toUpperCase())}</b>`,
          "",
          line("Promotion", p.title),
          ...(p.code ? [line("Code", p.code)] : []),
          line("Discount", p.discount),
          line("For", p.audience),
          line("Applies to", p.applies_to),
          ...(used ? [
            line("Order", p.order_number),
            line("Original price", etb(p.original_etb)),
            line("Discount given", etb(p.discount_etb)),
            `Price paid: <b>${esc(etb(p.total_etb))}</b>`,
            line("Paid with", p.payment_method === "wallet" ? "Balance" : "Bank transfer"),
          ] : [
            ...(p.min_order_etb ? [line("Minimum order", etb(p.min_order_etb))] : []),
            ...(p.usage_limit ? [line("Usage limit", `${p.usage_limit} order(s)`)] : []),
            ...(p.starts_at || p.ends_at ? [line("Valid", `${when(p.starts_at)} → ${p.ends_at ? when(p.ends_at) : "no end"}`)] : []),
            line("Status", p.active ? "Active" : "Off"),
            ...(p.homepage ? ["Shown on the homepage"] : []),
          ]),
          ...(p.changed ? [line("Changed", p.changed)] : []),
          ...(p.reason ? [line("Reason", p.reason)] : []),
          line("When", addisTime(p.at)),
        ].join("\n") + (used && p.order_id ? admin(`/admin/orders/${p.order_id}`) : admin("/admin/promotions")),
      };
    }
    case "account_pending":
      return {
        attachment: null,
        text: ["🆕 <b>NEW CUSTOMER ACCOUNT — WAITING FOR APPROVAL</b>", "", line("When", addisTime(p.at))].join("\n") + admin("/admin/approvals"),
      };
    case "delivery_update":
      return {
        attachment: null,
        text: [
          `🚚 <b>DELIVERY: ${esc((DELIVERY_STEP[String(p.step)] ?? String(p.step ?? "")).toUpperCase())}</b>`,
          "",
          line("Order", p.order_number),
          ...(p.courier_user_id ? [line("Courier User ID", p.courier_user_id)] : []),
          ...(p.city ? [line("City", p.city)] : []),
          ...(p.reason ? [line("Reason", p.reason)] : []),
          line("When", addisTime(p.at)),
        ].join("\n") + orderLink,
      };
    case "excel_export":
      return {
        attachment,
        text: [
          "📊 <b>EXCEL EXPORT</b>",
          "",
          line("Export", p.title),
          line("File", p.file_name),
          ...(p.rows !== undefined && p.rows !== null ? [line("Rows", p.rows)] : []),
          line("When", addisTime(p.at)),
        ].join("\n"),
      };
    case "admin_action": {
      const meta = p.metadata && typeof p.metadata === "object" ? Object.entries(p.metadata as Record<string, unknown>).filter(([, v]) => v !== null && v !== "") : [];
      return {
        attachment: null,
        text: [
          `🛡 <b>ADMIN ACTION: ${esc(actionLabel(String(p.action)).toUpperCase())}</b>`,
          "",
          line("By", `${p.actor ?? "System"}${p.role ? ` (${String(p.role).replaceAll("_", " ")})` : ""}`),
          line("Area", entityLabel(String(p.entity_type ?? ""))),
          ...(p.entity_id ? [line("Item", p.entity_id)] : []),
          ...meta.slice(0, 10).map(([k, v]) => line(titleCase(k), short(v, 200))),
          ...(p.before ? [line("Before", short(p.before, 400))] : []),
          ...(p.after ? [line("After", short(p.after, 400))] : []),
          line("When", addisTime(p.at)),
        ].join("\n") + admin("/admin/activity"),
      };
    }
    case "notification_copy": {
      const ok = p.status === "sent";
      const ref = p.order_number ?? p.job_number ?? p.number ?? p.product;
      return {
        attachment: null,
        text: [
          `${ok ? "📣" : "⚠️"} <b>${ok ? "SENT" : "FAILED"}: ${esc((CUSTOMER_EVENT[String(p.event)] ?? titleCase(String(p.event))).toUpperCase())}</b>`,
          "",
          line("Channel", CHANNEL[String(p.channel)] ?? p.channel),
          line("To", p.to ?? "—"),
          ...(ref ? [line("About", ref)] : []),
          ...(p.amount_etb ? [line("Amount", etb(p.amount_etb))] : []),
          ...(p.note ? [line("Note", p.note)] : []),
          line("Result", ok ? `Delivered after ${p.attempts} attempt(s)` : `Failed after ${p.attempts} attempt(s)`),
          ...(!ok && p.error ? [line("Error", p.error)] : []),
          line("When", addisTime(p.at)),
        ].join("\n") + (ok ? "" : admin("/admin/notifications")),
      };
    }
    case "order_placed": {
      const items = Array.isArray(p.items) ? (p.items as { name?: unknown; quantity?: unknown }[]) : [];
      return {
        attachment: null,
        text: [
          "🧾 <b>ORDER PLACED — AWAITING PAYMENT</b>",
          "",
          line("Order ID", p.order_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          "Products:",
          ...items.slice(0, 30).map((i) => `• ${esc(i.name)} × ${esc(i.quantity)}`),
          "",
          `Total: <b>${esc(etb(p.total_etb))}</b>`,
          line("Delivery", p.fulfillment_method === "pickup" ? "Pickup at shop" : [p.city, p.address_line].filter(Boolean).join(" — ")),
          line("Pay by", addisTime(p.payment_due_at)),
          "",
          "The customer still has to transfer the money and upload the receipt.",
        ].join("\n") + orderLink,
      };
    }
    case "order_status": {
      const icon = ({ processing: "📦", ready_for_pickup: "🛍", out_for_delivery: "🚚", completed: "✅", expired: "⌛" } as Record<string, string>)[String(p.to)] ?? "ℹ️";
      return {
        attachment: null,
        text: [
          `${icon} <b>ORDER ${esc((ORDER_STEP[String(p.to)] ?? String(p.to)).toUpperCase())}</b>`,
          "",
          line("Order ID", p.order_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          line("Total", etb(p.total_etb)),
          line("Delivery", p.fulfillment_method === "pickup" ? "Pickup at shop" : [p.city, p.address_line].filter(Boolean).join(" — ")),
          line("Status", `${titleCase(String(p.from ?? ""))} → ${titleCase(String(p.to ?? ""))}`),
          ...(p.by ? [line("By", p.by)] : [line("By", "System")]),
          ...(p.note ? [line("Note", p.note)] : []),
        ].join("\n") + orderLink,
      };
    }
    case "printing_status": {
      return {
        attachment: null,
        text: [
          `🖨 <b>PRINTING ${esc((PRINT_STEP[String(p.to)] ?? String(p.to)).toUpperCase())}</b>`,
          "",
          line("Job", p.job_number),
          line("Customer", p.customer_name),
          line("Phone", phone(p.customer_phone)),
          ...(p.total_etb ? [line("Price", etb(p.total_etb))] : []),
          ...(p.page_count ? [line("Pages × copies", `${p.page_count} × ${p.copies}`)] : []),
          line("Status", `${titleCase(String(p.from ?? ""))} → ${titleCase(String(p.to ?? ""))}`),
          line("By", p.by ?? "System"),
          ...(p.note ? [line("Note", p.note)] : []),
        ].join("\n") + (p.job_id ? admin(`/admin/printing/${p.job_id}`) : ""),
      };
    }
    case "receipt_record": {
      const ok = p.result === "verified";
      return {
        attachment,
        text: [
          `${ok ? "✅" : "❌"} <b>${p.kind === "wallet_topup" ? "TOP-UP" : "PAYMENT"} ${ok ? "VERIFIED" : "REJECTED"}</b>`,
          "",
          line(p.kind === "wallet_topup" ? "Top-up" : "Order", p.number),
          line("Amount", etb(p.amount_etb)),
          line("Reference", p.reference ?? "—"),
          line("Paid into", [p.bank_name, p.account_number].filter(Boolean).join(" · ") || "—"),
          line("Customer", [p.customer_name, phone(p.customer_phone)].filter(Boolean).join(" · ") || "—"),
          line("Decided by", p.decided_by ?? "—"),
          ...(p.reason ? [line("Reason", p.reason)] : []),
          line("When", addisTime(p.decided_at)),
        ].join("\n") + (p.order_id ? admin(`/admin/orders/${p.order_id}`) : ""),
      };
    }
    case "printing_document":
      return {
        attachment,
        text: [
          p.stage === "payment_submitted"
            ? `🖨️ <b>PRINT — PAYMENT SUBMITTED</b> (print once the payment is verified) · ${esc(p.job_number)} · file ${esc(p.n)} of ${esc(p.of)}`
            : `🖨️ <b>PRINT — PAID</b> · ${esc(p.job_number)} · file ${esc(p.n)} of ${esc(p.of)}`,
          "",
          line("File", p.file_name),
          ...(p.pages ? [line("Pages in this file", p.pages)] : []),
          line("Print", `${p.color_mode === "color" ? "Colour" : "Black & white"} · ${p.paper_size} · ${p.sides === "double" ? "double-sided" : "single-sided"} · ${p.copies} cop${Number(p.copies) === 1 ? "y" : "ies"}`),
          ...(p.page_count ? [line("Pages in the job", p.page_count)] : []),
          line("Customer", [p.customer, phone(p.phone)].filter(Boolean).join(" · ")),
          line("Hand-over", p.fulfillment === "delivery" ? "Delivery" : "Pickup at the shop"),
          ...(p.notes ? [line("Customer note", p.notes)] : []),
        ].join("\n") + (p.job_id ? admin(`/admin/printing/${p.job_id}`) : ""),
      };
    case "support_ticket":
    case "support_reply": {
      const isNew = row.event_type === "support_ticket";
      return {
        attachment: null,
        text: [
          isNew ? "🆘 <b>NEW SUPPORT TICKET</b>" : "💬 <b>CUSTOMER REPLIED</b>",
          "",
          line("Ticket", p.number),
          ...(isNew ? [line("Topic", SUPPORT_TOPIC[String(p.category)] ?? p.category)] : []),
          line("Subject", p.subject),
          ...(p.order_number ? [line("Order", p.order_number)] : []),
          line("Customer", [p.customer, p.email].filter(Boolean).join(" · ") || "—"),
          line("User ID", p.user_id ?? "—"),
          "",
          esc(short(isNew ? p.details : p.message, 1500)),
        ].join("\n") + (p.ticket_id ? admin(`/admin/support/${p.ticket_id}`) : ""),
      };
    }
    case "support_rating": {
      const n = Math.max(1, Math.min(5, Number(p.rating) || 0));
      return {
        attachment: null,
        text: [
          `⭐ <b>TICKET RATED ${n}/5</b> ${"★".repeat(n)}${"☆".repeat(5 - n)}`,
          "",
          line("Ticket", p.number),
          line("Subject", p.subject),
          line("User ID", p.user_id ?? "—"),
          ...(p.assigned ? [line("Handled by", p.assigned)] : []),
          line("Feedback", p.feedback ?? "—"),
        ].join("\n") + (p.ticket_id ? admin(`/admin/support/${p.ticket_id}`) : ""),
      };
    }
    case "support_test":
      return { attachment: null, text: `✅ <b>Test message — support group</b>\n\nNew support tickets and customer replies will arrive here.\n${line("Requested by", p.requested_by)}` };
    case "printing_test":
      return { attachment: null, text: `✅ <b>Test message — printing group</b>\n\nThe documents of each printing job will arrive here as soon as the customer submits the payment.\n${line("Requested by", p.requested_by)}` };
    case "stock_test":
      return { attachment: null, text: `✅ <b>Test message — stock group</b>\n\nLow-stock and sold-out alerts will arrive here.\n${line("Requested by", p.requested_by)}` };
    case "receipts_test":
      return { attachment: null, text: `✅ <b>Test message — receipts group</b>\n\nEvery verified or rejected payment receipt (with the file) will arrive here.\n${line("Requested by", p.requested_by)}` };
    case "security_test":
      return { attachment: null, text: `✅ <b>Test message — security group</b>\n\nSecurity alerts, sign-ins and admin actions will arrive here.\n${line("Requested by", p.requested_by)}` };
    case "test_message":
      return { attachment: null, text: "✅ <b>Test message — orders & payments group</b>\n\nOrders, payments, printing, top-ups and stock alerts will arrive here." };
    default:
      return { attachment: null, text: `ℹ️ ${esc(row.event_type)}${p.order_number ? `\n${line("Order", p.order_number)}` : ""}` };
  }
}

/** Telegram limits: 4096 chars for messages, 1024 for media captions. */
export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

export function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  // Cut on a line boundary so no HTML tag is left open.
  const cut = text.slice(0, limit - 2).lastIndexOf("\n");
  return `${text.slice(0, cut > 0 ? cut : limit - 2)}\n…`;
}
