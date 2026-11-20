/** Short phone-notification texts for customer events, per device language. Plain text (no HTML). */
import { formatETB, toSantim } from "@/lib/money";

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

type Locale = "en" | "am";
const money = (v: unknown, l: Locale) => (v === undefined || v === null ? "" : formatETB(toSantim(Number(v)), l));

export function buildPush(event: string, p: Record<string, unknown>, locale: Locale, business: string): PushMessage | null {
  const n = String(p.order_number ?? p.job_number ?? "");
  const order = typeof p.order_id === "string" ? `/order-success/${p.order_id}` : null;
  const job = typeof p.job_id === "string" ? `/printing/jobs/${p.job_id}` : null;
  const am = locale === "am";
  const total = money(p.total_etb, locale);
  const m = (en: [string, string], amh: [string, string], url: string | null): PushMessage | null =>
    url ? { title: am ? amh[0] : en[0], body: am ? amh[1] : en[1], url, tag: `${event}:${n}` } : null;

  switch (event) {
    case "customer_order_placed":
      return m([`Order ${n} placed`, `Please pay ${total} by bank transfer and upload your receipt.`],
        [`ትዕዛዝ ${n} ገብቷል`, `እባክዎ ${total} በባንክ ያስተላልፉ እና ደረሰኝ ይጫኑ።`], order);
    case "customer_order_confirmed":
      return m([`Payment received ✓`, `Order ${n} is confirmed. We are preparing it.`],
        [`ክፍያ ተረጋግጧል ✓`, `ትዕዛዝ ${n} ጸድቋል። እያዘጋጀን ነው።`], order);
    case "customer_order_payment_rejected":
      return m([`Payment not verified`, `Order ${n}: ${p.note ? String(p.note).slice(0, 80) : "please upload a new receipt."}`],
        [`ክፍያ አልተረጋገጠም`, `ትዕዛዝ ${n}፦ ${p.note ? String(p.note).slice(0, 80) : "እባክዎ አዲስ ደረሰኝ ይጫኑ።"}`], order);
    case "customer_order_ready_for_pickup":
      return m([`Ready for pickup`, `Order ${n} is ready at our shop.`], [`ለመውሰድ ዝግጁ ነው`, `ትዕዛዝ ${n} በሱቃችን ዝግጁ ነው።`], order);
    case "customer_order_out_for_delivery":
      return m([`On its way 🚚`, `Order ${n} is out for delivery. Keep your phone nearby.`], [`በመንገድ ላይ ነው 🚚`, `ትዕዛዝ ${n} እየደረሰ ነው። ስልክዎን በአቅራቢያ ያቆዩ።`], order);
    case "customer_order_completed":
      return m([`Order ${n} completed`, `Thank you for shopping with ${business}!`], [`ትዕዛዝ ${n} ተጠናቋል`, `ከ${business} ስለገዙ እናመሰግናለን!`], order);
    case "customer_order_cancelled":
      return m([`Order ${n} cancelled`, `Contact us if you already paid.`], [`ትዕዛዝ ${n} ተሰርዟል`, `አስቀድመው ከፍለው ከሆነ ያግኙን።`], order);
    case "customer_order_expired":
      return m([`Order ${n} expired`, `We did not receive the payment in time. You can order again.`], [`ትዕዛዝ ${n} ጊዜው አልፏል`, `ክፍያው በጊዜው አልደረሰም። እንደገና ማዘዝ ይችላሉ።`], order);
    case "customer_printing_quote_ready":
      return m([`Printing price ready`, `Job ${n}: ${total}. Tap to add it to your basket.`], [`የህትመት ዋጋ ተዘጋጅቷል`, `ስራ ${n}፦ ${total}። ወደ ጋሪ ለማስገባት ይንኩ።`], job);
    case "customer_printing_ready":
      return m([`Printing ready`, `Job ${n} is ready.`], [`ህትመቱ ዝግጁ ነው`, `ስራ ${n} ዝግጁ ነው።`], job);
    case "customer_topup_verified":
      return { title: am ? "ቀሪ ሂሳብ ተሞልቷል ✓" : "Balance topped up ✓", body: am ? `+${money(p.amount_etb, locale)} — ቀሪ ሂሳብ ${money(p.balance_etb, locale)}` : `+${money(p.amount_etb, locale)} — balance ${money(p.balance_etb, locale)}`, url: "/account/wallet", tag: `${event}:${p.topup_number}` };
    case "customer_topup_rejected":
      return { title: am ? "የመሙላት ጥያቄ አልተረጋገጠም" : "Top-up not verified", body: String(p.note ?? (am ? "እባክዎ ደረሰኙን ያረጋግጡ።" : "Please check the receipt.")).slice(0, 100), url: "/account/wallet", tag: `${event}:${p.topup_number}` };
    case "customer_promo_gift": {
      const off = p.discount_type === "percent" ? `${Number(p.discount_value)}%` : money(p.discount_value, locale);
      return {
        title: am ? `ለእርስዎ ብቻ፦ ${off} ቅናሽ 🎁` : `A discount just for you: ${off} off 🎁`,
        body: am ? `ኮድ ${String(p.code)} — በክፍያ ጊዜ ያስገቡ።` : `Code ${String(p.code)} — enter it at checkout.`,
        url: "/account#offers",
        tag: `${event}:${p.code}`,
      };
    }
    case "customer_back_in_stock":
      return typeof p.slug === "string"
        ? { title: am ? "እንደገና ተገኝቷል" : "Back in stock", body: am ? `${String(p.name_am || p.name)} አሁን ይገኛል።` : `${String(p.name)} is available again.`, url: `/products/${encodeURIComponent(p.slug)}`, tag: `${event}:${p.slug}` }
        : null;
    default:
      return null;
  }
}
