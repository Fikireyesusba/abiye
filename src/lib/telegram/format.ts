/**
 * Telegram message builders (parse_mode = HTML). Every value that can come from
 * a customer is escaped: Telegram's HTML mode would otherwise let a crafted
 * name or note inject links/formatting into the staff chat.
 */
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
          p.resubmission || row.event_type === "payment_resubmitted" ? "🔁 <b>PAYMENT RESUBMITTED</b>" : "🛒 <b>NEW CUSTOMER ORDER</b>",
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
    case "test_message":
      return { attachment: null, text: "✅ <b>Test message</b>\n\nTelegram notifications are working." };
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
