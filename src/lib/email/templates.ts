/**
 * Customer notification emails (English + Amharic in every message, like the
 * account emails). Pure functions: no I/O, all values HTML-escaped.
 */
import { formatETB, toSantim } from "@/lib/money";

export interface EmailContext {
  appUrl: string;
  business: { en: string; am: string };
  phone: string;
  address: { en: string; am: string };
}

export interface EmailRow {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (v: unknown, locale: "en" | "am") => (v === undefined || v === null || v === "" ? "" : formatETB(toSantim(Number(v)), locale));

function addis(iso: unknown, locale: "en" | "am") {
  if (typeof iso !== "string") return "";
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Addis_Ababa" }).format(new Date(iso));
}

interface Part {
  title: string;
  lines: string[]; // already escaped HTML fragments
}

interface Spec {
  subject: string;
  en: Part;
  am?: Part; // staff alerts are English only
  staff?: boolean;
  button?: { href: string; en: string; am: string };
  details?: [string, string][]; // [label, value] — language-neutral
}

function spec(row: EmailRow, ctx: EmailContext): Spec | null {
  const p = row.payload;
  const n = esc(p.order_number ?? p.job_number);
  const orderUrl = typeof p.order_id === "string" ? `${ctx.appUrl}/order-success/${p.order_id}` : ctx.appUrl;
  const jobUrl = typeof p.job_id === "string" ? `${ctx.appUrl}/printing/jobs/${p.job_id}` : ctx.appUrl;
  const totalEn = esc(money(p.total_etb, "en"));
  const totalAm = esc(money(p.total_etb, "am"));
  const viewOrder = { href: orderUrl, en: "View your order", am: "ትዕዛዝዎን ይመልከቱ" };
  const pickup = p.fulfillment === "pickup";

  switch (row.event_type) {
    case "customer_order_placed": {
      const bank = (p.bank ?? {}) as Record<string, unknown>;
      return {
        subject: `Order ${n} — please pay ${totalEn} / ትዕዛዝ ${n}`,
        en: { title: `Thank you! Order ${n} is placed.`, lines: [
          `Please transfer <strong>${totalEn}</strong> by bank transfer before <strong>${esc(addis(p.payment_due_at, "en"))}</strong>.`,
          `Write your order number <strong>${n}</strong> as the reason/remark, then upload a screenshot or PDF of your receipt on the order page.`,
          "We confirm your order as soon as we see the payment in our bank account." ] },
        am: { title: `እናመሰግናለን! ትዕዛዝ ${n} ገብቷል።`, lines: [
          `እባክዎ <strong>${totalAm}</strong> እስከ <strong>${esc(addis(p.payment_due_at, "am"))}</strong> ድረስ በባንክ ያስተላልፉ።`,
          `የትዕዛዝ ቁጥርዎን <strong>${n}</strong> በምክንያት/ማብራሪያ ላይ ይጻፉ፣ ከዚያ የደረሰኙን ፎቶ ወይም PDF በትዕዛዝ ገጹ ላይ ይጫኑ።`,
          "ክፍያው ወደ ባንክ ሂሳባችን መግባቱን እንዳየን ትዕዛዝዎን እናረጋግጣለን።" ] },
        details: [
          ["Amount / መጠን", totalEn],
          ["Bank / ባንክ", esc(bank.bank_name)],
          ["Account holder / የሂሳብ ባለቤት", esc(bank.account_holder)],
          ["Account number / የሂሳብ ቁጥር", esc(bank.account_number)],
          ["Reason / ምክንያት", n],
        ],
        button: { href: orderUrl, en: "Upload your receipt", am: "ደረሰኝ ይጫኑ" },
      };
    }
    case "customer_order_confirmed":
      return {
        subject: `Payment received — order ${n} confirmed / ክፍያ ተረጋግጧል`,
        en: { title: `Your payment is verified. Order ${n} is confirmed.`, lines: [
          pickup ? "We are preparing your order. We will email you when it is ready for pickup." : "We are preparing your order for delivery. We will email you when it is on its way." ] },
        am: { title: `ክፍያዎ ተረጋግጧል። ትዕዛዝ ${n} ጸድቋል።`, lines: [
          pickup ? "ትዕዛዝዎን እያዘጋጀን ነው። ለመውሰድ ሲዘጋጅ በኢሜይል እናሳውቅዎታለን።" : "ትዕዛዝዎን ለማድረስ እያዘጋጀን ነው። ሲላክ በኢሜይል እናሳውቅዎታለን።" ] },
        button: viewOrder,
      };
    case "customer_order_payment_rejected":
      return {
        subject: `We could not verify your payment for order ${n} / ክፍያ አልተረጋገጠም`,
        en: { title: `We could not verify your payment for order ${n}.`, lines: [
          p.note ? `Reason: ${esc(p.note)}` : "",
          "Please check the transfer and submit a new receipt on the order page." ].filter(Boolean) },
        am: { title: `ለትዕዛዝ ${n} ክፍያዎን ማረጋገጥ አልቻልንም።`, lines: [
          p.note ? `ምክንያት፦ ${esc(p.note)}` : "",
          "እባክዎ ዝውውሩን ያረጋግጡ እና በትዕዛዝ ገጹ ላይ አዲስ ደረሰኝ ያስገቡ።" ].filter(Boolean) },
        button: { href: orderUrl, en: "Submit a new receipt", am: "አዲስ ደረሰኝ ያስገቡ" },
      };
    case "customer_order_ready_for_pickup":
      return {
        subject: `Order ${n} is ready for pickup / ለመውሰድ ዝግጁ ነው`,
        en: { title: `Order ${n} is ready for pickup.`, lines: [ctx.address.en ? `Collect it at: ${esc(ctx.address.en)}` : "You can collect it at our shop."] },
        am: { title: `ትዕዛዝ ${n} ለመውሰድ ዝግጁ ነው።`, lines: [ctx.address.am || ctx.address.en ? `መውሰጃ ቦታ፦ ${esc(ctx.address.am || ctx.address.en)}` : "ከሱቃችን መውሰድ ይችላሉ።"] },
        button: viewOrder,
      };
    case "customer_order_out_for_delivery":
      return {
        subject: `Order ${n} is on its way / በመንገድ ላይ ነው`,
        en: { title: `Order ${n} is on its way.`, lines: ["Please keep your phone nearby — our delivery person may call you."] },
        am: { title: `ትዕዛዝ ${n} በመንገድ ላይ ነው።`, lines: ["እባክዎ ስልክዎን በአቅራቢያ ያቆዩ — አድራሾቻችን ሊደውሉልዎ ይችላሉ።"] },
        button: viewOrder,
      };
    case "customer_order_completed":
      return {
        subject: `Order ${n} completed — thank you! / እናመሰግናለን`,
        en: { title: `Order ${n} is completed. Thank you for shopping with ${esc(ctx.business.en)}!`, lines: ["We hope to see you again soon."] },
        am: { title: `ትዕዛዝ ${n} ተጠናቋል። ከ${esc(ctx.business.am || ctx.business.en)} ስለገዙ እናመሰግናለን!`, lines: ["በቅርቡ እንደገና እንደምናገኝዎ ተስፋ እናደርጋለን።"] },
        button: viewOrder,
      };
    case "customer_order_cancelled":
      return {
        subject: `Order ${n} was cancelled / ተሰርዟል`,
        en: { title: `Order ${n} was cancelled.`, lines: ["If you already paid or did not expect this, please contact us."] },
        am: { title: `ትዕዛዝ ${n} ተሰርዟል።`, lines: ["አስቀድመው ከፍለው ከሆነ ወይም ይህን ካልጠበቁ እባክዎ ያግኙን።"] },
        button: viewOrder,
      };
    case "customer_order_expired":
      return {
        subject: `Order ${n} expired — payment not received / ጊዜው አልፏል`,
        en: { title: `Order ${n} expired because we did not receive the payment in time.`, lines: ["The items were released. You are welcome to order again."] },
        am: { title: `ክፍያው በጊዜው ስላልደረሰን ትዕዛዝ ${n} ጊዜው አልፏል።`, lines: ["ዕቃዎቹ ተለቀዋል። እንደገና ማዘዝ ይችላሉ።"] },
        button: { href: `${ctx.appUrl}/shop`, en: "Shop again", am: "እንደገና ይግዙ" },
      };
    case "customer_printing_quote_ready":
      return {
        subject: `Printing job ${n}: price ready — ${totalEn} / ዋጋ ተዘጋጅቷል`,
        en: { title: `The price for printing job ${n} is ready: ${totalEn}.`, lines: ["Open the job, add it to your basket and pay to start printing."] },
        am: { title: `የህትመት ስራ ${n} ዋጋ ተዘጋጅቷል፦ ${totalAm}።`, lines: ["ህትመቱ እንዲጀመር ስራውን ይክፈቱ፣ ወደ ጋሪ ያስገቡ እና ይክፈሉ።"] },
        button: { href: jobUrl, en: "View the price", am: "ዋጋውን ይመልከቱ" },
      };
    case "customer_printing_ready":
      return {
        subject: `Printing job ${n} is ready / ህትመቱ ዝግጁ ነው`,
        en: { title: `Printing job ${n} is ready.`, lines: [pickup ? (ctx.address.en ? `Collect it at: ${esc(ctx.address.en)}` : "You can collect it at our shop.") : "We will deliver it soon."] },
        am: { title: `የህትመት ስራ ${n} ዝግጁ ነው።`, lines: [pickup ? "ከሱቃችን መውሰድ ይችላሉ።" : "በቅርቡ እናደርሳለን።"] },
        button: { href: jobUrl, en: "View job", am: "ስራውን ይመልከቱ" },
      };
    case "customer_topup_verified":
      return {
        subject: `Balance topped up: +${totalEn || esc(money(p.amount_etb, "en"))} / ቀሪ ሂሳብ ተሞልቷል`,
        en: { title: `We added ${esc(money(p.amount_etb, "en"))} to your balance.`, lines: [`Top-up ${n || esc(p.topup_number)} is verified. Your balance is now <strong>${esc(money(p.balance_etb, "en"))}</strong>.`, "Use it at checkout with “Pay with my balance”."] },
        am: { title: `${esc(money(p.amount_etb, "am"))} ወደ ቀሪ ሂሳብዎ ጨምረናል።`, lines: [`የመሙላት ጥያቄ ${esc(p.topup_number)} ተረጋግጧል። ቀሪ ሂሳብዎ አሁን <strong>${esc(money(p.balance_etb, "am"))}</strong> ነው።`, "በክፍያ ጊዜ «በቀሪ ሂሳቤ ክፈል»ን ይጠቀሙ።"] },
        button: { href: `${ctx.appUrl}/account/wallet`, en: "My balance", am: "የእኔ ቀሪ ሂሳብ" },
      };
    case "customer_topup_rejected":
      return {
        subject: `Top-up ${esc(p.topup_number)} could not be verified / አልተረጋገጠም`,
        en: { title: `We could not verify top-up ${esc(p.topup_number)} (${esc(money(p.amount_etb, "en"))}).`, lines: [p.note ? `Reason: ${esc(p.note)}` : "", "Nothing was added to your balance. Check the transfer and send a new request with the right receipt."].filter(Boolean) },
        am: { title: `የመሙላት ጥያቄ ${esc(p.topup_number)} (${esc(money(p.amount_etb, "am"))}) ማረጋገጥ አልቻልንም።`, lines: [p.note ? `ምክንያት፦ ${esc(p.note)}` : "", "ወደ ቀሪ ሂሳብዎ ምንም አልተጨመረም። ዝውውሩን አረጋግጠው በትክክለኛው ደረሰኝ አዲስ ጥያቄ ይላኩ።"].filter(Boolean) },
        button: { href: `${ctx.appUrl}/account/wallet`, en: "My balance", am: "የእኔ ቀሪ ሂሳብ" },
      };
    case "customer_back_in_stock": {
      const url = typeof p.slug === "string" ? `${ctx.appUrl}/products/${encodeURIComponent(p.slug)}` : ctx.appUrl;
      return {
        subject: `Back in stock: ${esc(p.name)} / እንደገና ተገኝቷል`,
        en: { title: `${esc(p.name)} is back in stock.`, lines: ["You asked us to tell you. Order soon — quantities are limited."] },
        am: { title: `${esc(p.name_am || p.name)} እንደገና ተገኝቷል።`, lines: ["እንድናሳውቅዎ ጠይቀው ነበር። ብዛቱ የተወሰነ ስለሆነ በቶሎ ይዘዙ።"] },
        button: { href: url, en: "View product", am: "ምርቱን ይመልከቱ" },
      };
    }
    case "staff_low_stock":
    case "staff_out_of_stock": {
      const out = row.event_type === "staff_out_of_stock";
      return {
        staff: true,
        subject: `${out ? "Sold out" : "Low stock"}: ${esc(p.name)} (${esc(p.stock)} left)`,
        en: {
          title: out ? `${esc(p.name)} is sold out.` : `${esc(p.name)} is running low: ${esc(p.stock)} left.`,
          lines: [`SKU ${esc(p.sku)}${out ? "" : ` · alert level ${esc(p.threshold)}`}.`, out ? "Customers can ask to be told when it is back; they are notified automatically when you add stock." : "Reorder soon."],
        },
        button: { href: typeof p.product_id === "string" ? `${ctx.appUrl}/admin/products/${p.product_id}` : `${ctx.appUrl}/admin/inventory`, en: "Open in admin", am: "" },
      };
    }
    default:
      return null;
  }
}

/** null for unknown event types (the worker drops them). */
export function buildCustomerEmail(row: EmailRow, ctx: EmailContext): BuiltEmail | null {
  const s = spec(row, ctx);
  if (!s) return null;
  const name = esc(ctx.business.en);
  const section = (part: Part, lang: "en" | "am") =>
    `<div lang="${lang}" style="margin:0 0 24px"><h2 style="font-size:18px;margin:0 0 12px;color:#14523f">${part.title}</h2>` +
    part.lines.map((l) => `<p style="margin:0 0 10px;line-height:1.55">${l}</p>`).join("") + `</div>`;
  const details = s.details?.length
    ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 24px;width:100%">` +
      s.details.map(([k, v]) => `<tr><td style="padding:6px 8px;border:1px solid #e5e5e5;color:#666;font-size:13px">${k}</td><td style="padding:6px 8px;border:1px solid #e5e5e5;font-weight:600">${v}</td></tr>`).join("") +
      `</table>`
    : "";
  const button = s.button
    ? `<p style="margin:0 0 28px"><a href="${esc(s.button.href)}" style="display:inline-block;background:#14523f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(s.button.en)}${s.button.am ? ` · ${esc(s.button.am)}` : ""}</a></p>`
    : "";
  const contact = ctx.phone ? ` · ${esc(ctx.phone)}` : "";
  const html =
    `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:Arial,'Noto Sans Ethiopic',sans-serif;color:#1a1a1a">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px">` +
    `<p style="margin:0 0 20px;font-weight:700;font-size:20px;color:#14523f">${name}</p>` +
    section(s.en, "en") + details + (s.am ? section(s.am, "am") : "") + button +
    `<p style="margin:0;color:#777;font-size:12px;line-height:1.5">${name}${contact} · <a href="${esc(ctx.appUrl)}/contact" style="color:#14523f">${esc(ctx.appUrl.replace(/^https?:\/\//, ""))}/contact</a><br>` +
    (s.staff ? "Staff alert: you receive this because your role manages stock." : `You receive this email because you placed an order or asked us to. · ይህን ኢሜይል የተቀበሉት ትዕዛዝ ስላስገቡ ወይም ስለጠየቁ ነው።`) + `</p>` +
    `</div></div></body></html>`;
  const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [
    ctx.business.en, "", plain(s.en.title), ...s.en.lines.map(plain), "",
    ...(s.details ?? []).map(([k, v]) => `${k}: ${plain(v)}`), s.details?.length ? "" : null,
    ...(s.am ? [plain(s.am.title), ...s.am.lines.map(plain), ""] : []),
    s.button ? `${s.button.en}: ${s.button.href}` : null,
  ].filter((x) => x !== null).join("\n");
  return { subject: plain(s.subject).slice(0, 200), html, text };
}
