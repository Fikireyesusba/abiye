/**
 * Customer notification emails (English only since 2026-11-23; the Amharic parts below are no longer sent), like the
 * account emails). Pure functions: no I/O, all values HTML-escaped.
 */
import { formatETB, toSantim } from "@/lib/money";
import { APP_TIME_ZONE } from "@/lib/datetime";

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
  return new Intl.DateTimeFormat(locale === "am" ? "am-ET" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIME_ZONE }).format(new Date(iso));
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

const TICKET_STATUS: Record<string, [string, string]> = {
  open: ["Open", "ክፍት"], in_progress: ["In progress", "በሂደት ላይ"], waiting_customer: ["Waiting for your answer", "መልስዎን በመጠበቅ ላይ"],
  resolved: ["Resolved", "ተፈቷል"], closed: ["Closed", "ተዘግቷል"],
};

function spec(row: EmailRow, ctx: EmailContext): Spec | null {
  const p = row.payload;
  const n = esc(p.order_number ?? p.job_number);
  const orderUrl = typeof p.order_id === "string" ? `${ctx.appUrl}/order-success/${p.order_id}` : ctx.appUrl;
  const jobUrl = typeof p.job_id === "string" ? `${ctx.appUrl}/printing/jobs/${p.job_id}` : ctx.appUrl;
  const totalEn = esc(money(p.total_etb, "en"));
  const totalAm = esc(money(p.total_etb, "am"));
  const viewOrder = { href: orderUrl, en: "View your order", am: "ትዕዛዝዎን ይመልከቱ" };
  const partner = p.partner && typeof p.partner === "object" ? (p.partner as Record<string, string | undefined>) : null;
  const partnerAddress = partner
    ? esc([partner.city, partner.address_line, partner.landmark, partner.phone, partner.opening_hours].filter(Boolean).join(" · "))
    : "";
  const pin = typeof p.delivery_code === "string" && /^\d{4}$/.test(p.delivery_code) ? p.delivery_code : null;
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
        subject: `Payment not verified — order ${n} cancelled / ክፍያ አልተረጋገጠም — ትዕዛዝ ተሰርዟል`,
        en: { title: `We could not verify your payment for order ${n}, so the order was cancelled.`, lines: [
          p.note ? `Reason: ${esc(p.note)}` : "",
          "The items were released. If you did pay, contact us with your bank receipt; otherwise you are welcome to place a new order." ].filter(Boolean) },
        am: { title: `ለትዕዛዝ ${n} ክፍያዎን ማረጋገጥ ስላልቻልን ትዕዛዙ ተሰርዟል።`, lines: [
          p.note ? `ምክንያት፦ ${esc(p.note)}` : "",
          "ዕቃዎቹ ተለቀዋል። ከፍለው ከሆነ በባንክ ደረሰኝዎ ያግኙን፤ ካልሆነ አዲስ ትዕዛዝ ማዘዝ ይችላሉ።" ].filter(Boolean) },
        button: viewOrder,
      };
    case "customer_order_ready_for_pickup":
      if (partner) {
        return {
          subject: `Order ${n} is ready at ${esc(partner.name)} / በአጋር ሱቁ ለመውሰድ ዝግጁ ነው`,
          en: { title: `Order ${n} is ready for pickup at ${esc(partner.name)}.`, lines: [
            `Address: ${partnerAddress}`,
            ...(pin ? [`Your pickup PIN: <strong style="font-size:20px;letter-spacing:4px">${pin}</strong> — give it to the shop only when you receive your order.`] : []),
          ] },
          am: { title: `ትዕዛዝ ${n} በ${esc(partner.name)} ለመውሰድ ዝግጁ ነው።`, lines: [
            `አድራሻ፦ ${partnerAddress}`,
            ...(pin ? [`የመውሰጃ ፒንዎ፦ <strong style="font-size:20px;letter-spacing:4px">${pin}</strong> — ትዕዛዝዎን ሲቀበሉ ብቻ ለሱቁ ይስጡ።`] : []),
          ] },
          button: viewOrder,
        };
      }
      return {
        subject: `Order ${n} is ready for pickup / ለመውሰድ ዝግጁ ነው`,
        en: { title: `Order ${n} is ready for pickup.`, lines: [ctx.address.en ? `Collect it at: ${esc(ctx.address.en)}` : "You can collect it at our shop."] },
        am: { title: `ትዕዛዝ ${n} ለመውሰድ ዝግጁ ነው።`, lines: [ctx.address.am || ctx.address.en ? `መውሰጃ ቦታ፦ ${esc(ctx.address.am || ctx.address.en)}` : "ከሱቃችን መውሰድ ይችላሉ።"] },
        button: viewOrder,
      };
    case "customer_order_out_for_delivery":
      if (partner) {
        return {
          subject: `Order ${n} is on its way to ${esc(partner.name)} / ወደ አጋር ሱቁ በመንገድ ላይ ነው`,
          en: { title: `Order ${n} is on its way to ${esc(partner.name)}.`, lines: [`We will email you when it is at the shop, with your pickup PIN.`, `Address: ${partnerAddress}`] },
          am: { title: `ትዕዛዝ ${n} ወደ ${esc(partner.name)} በመንገድ ላይ ነው።`, lines: ["ሱቁ ሲደርስ ከመውሰጃ ፒንዎ ጋር ኢሜል እንልካለን።", `አድራሻ፦ ${partnerAddress}`] },
          button: viewOrder,
        };
      }
      return {
        subject: `Order ${n} is on its way / በመንገድ ላይ ነው`,
        en: { title: `Order ${n} is on its way.`, lines: [
          "Please keep your phone nearby — our delivery person may call you.",
          ...(typeof p.delivery_code === "string" && /^\d{4}$/.test(p.delivery_code)
            ? [`Your delivery code: <strong style="font-size:20px;letter-spacing:4px">${p.delivery_code}</strong> — give it to the courier only when you receive your order.`] : []),
        ] },
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
    case "customer_ticket_update": {
      const st = TICKET_STATUS[String(p.status)] ?? ["Updated", "ተዘምኗል"];
      return {
        subject: `Support ticket ${esc(p.number)}: ${p.message ? "new reply" : esc(st[0].toLowerCase())} / የድጋፍ ጥያቄ`,
        en: { title: p.message ? `We replied to your support ticket ${esc(p.number)} (${esc(p.subject)}).` : `Your support ticket ${esc(p.number)} is now: ${esc(st[0])}.`,
              lines: [p.message ? `<em>${esc(p.message)}</em>` : "", `Status: <strong>${esc(st[0])}</strong>`].filter(Boolean) },
        am: { title: p.message ? `ለድጋፍ ጥያቄዎ ${esc(p.number)} መልስ ሰጥተናል።` : `የድጋፍ ጥያቄዎ ${esc(p.number)} ሁኔታ፦ ${esc(st[1])}።`,
              lines: [`ሁኔታ፦ <strong>${esc(st[1])}</strong>`] },
        button: { href: `${ctx.appUrl}/support/${esc(p.ticket_id)}`, en: "Open the ticket", am: "ጥያቄውን ይክፈቱ" },
      };
    }
    case "customer_account_approved":
      return {
        subject: "Your account is approved / መለያዎ ጸድቋል",
        en: { title: `${p.name ? `${esc(String(p.name).split(" ")[0])}, your` : "Your"} account is approved — welcome to ${esc(ctx.business.en)}!`, lines: ["You can now order, top up your balance and use our printing service."] },
        am: { title: "መለያዎ ጸድቋል — እንኳን ደህና መጡ!", lines: ["አሁን ማዘዝ፣ ቀሪ ሂሳብ መሙላት እና የህትመት አገልግሎታችንን መጠቀም ይችላሉ።"] },
        button: { href: `${ctx.appUrl}/`, en: "Start shopping", am: "ግዢ ይጀምሩ" },
      };
    case "customer_account_rejected":
      return {
        subject: "Your account request / የመለያ ጥያቄዎ",
        en: { title: "Due to security reasons, you cannot create an account with us.", lines: [
          p.reason ? `Reason: ${esc(p.reason)}` : "",
          "Your details have been deleted and this email address cannot be used to sign up again.",
        ].filter(Boolean) },
        am: { title: "በደህንነት ምክንያት ከእኛ ጋር መለያ መክፈት አይችሉም።", lines: ["ያስገቡት መረጃ ተሰርዟል፤ ይህን ኢሜይል ዳግም ለመመዝገብ መጠቀም አይቻልም።"] },
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
    case "customer_promo_gift": {
      const off = p.discount_type === "percent" ? `${Number(p.discount_value)}%` : esc(money(p.discount_value, "en"));
      const offAm = p.discount_type === "percent" ? `${Number(p.discount_value)}%` : esc(money(p.discount_value, "am"));
      const min = Number(p.min_order_etb ?? 0) > 0;
      const until = typeof p.ends_at === "string" ? addis(p.ends_at, "en") : "";
      const untilAm = typeof p.ends_at === "string" ? addis(p.ends_at, "am") : "";
      const code = `<span style="display:inline-block;font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;background:#f1efe8;border:1px dashed #14523f;border-radius:6px;padding:6px 12px">${esc(p.code)}</span>`;
      return {
        subject: `A discount just for you: ${esc(p.code)} / ለእርስዎ ብቻ የተሰጠ ቅናሽ`,
        en: {
          title: `${p.name ? `${esc(String(p.name).split(" ")[0])}, here` : "Here"} is a discount just for you: ${off} off.`,
          lines: [
            code,
            ...(p.note ? [`<em>${esc(p.note)}</em>`] : []),
            `Enter the code at checkout${min ? ` (orders from ${esc(money(p.min_order_etb, "en"))})` : ""}.${until ? ` Valid until ${esc(until)}.` : ""}`,
            "It works only with your account and can be used once. You also find it under My account → My offers.",
          ],
        },
        am: {
          title: `ለእርስዎ ብቻ የተሰጠ ቅናሽ፦ ${offAm} ቅናሽ።`,
          lines: [
            code,
            ...(p.note ? [`<em>${esc(p.note)}</em>`] : []),
            `በክፍያ ጊዜ ኮዱን ያስገቡ${min ? ` (ከ${esc(money(p.min_order_etb, "am"))} በላይ ለሆኑ ትዕዛዞች)` : ""}።${untilAm ? ` እስከ ${esc(untilAm)} ድረስ ያገለግላል።` : ""}`,
            "በእርስዎ መለያ ብቻ የሚሰራ ሲሆን አንድ ጊዜ ብቻ ያገለግላል። በየእኔ መለያ → የእኔ ቅናሾች ስርም ያገኙታል።",
          ],
        },
        button: { href: `${ctx.appUrl}/shop`, en: "Start shopping", am: "መግዛት ይጀምሩ" },
      };
    }
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
/** English only: drop a " / Amharic" ending from a label or subject. */
const englishOnly = (v: string) => v.replace(/\s+\/\s+[^/]*[\u1200-\u137F][\s\S]*$/, "");

export function buildCustomerEmail(row: EmailRow, ctx: EmailContext): BuiltEmail | null {
  const spec0 = spec(row, ctx);
  if (!spec0) return null;
  const s: Spec = { ...spec0, am: undefined, details: spec0.details?.map(([k, v]) => [englishOnly(k), englishOnly(v)] as [string, string]) };
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
    ? `<p style="margin:0 0 28px"><a href="${esc(s.button.href)}" style="display:inline-block;background:#14523f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(s.button.en)}</a></p>`
    : "";
  const contact = ctx.phone ? ` · ${esc(ctx.phone)}` : "";
  const html =
    `<!doctype html><html><body style="margin:0;background:#f6f5f1;font-family:Arial,sans-serif;color:#1a1a1a">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px"><div style="background:#fff;border-radius:12px;padding:28px">` +
    `<p style="margin:0 0 20px;font-weight:700;font-size:20px;color:#14523f">${name}</p>` +
    section(s.en, "en") + details + button +
    `<p style="margin:0;color:#777;font-size:12px;line-height:1.5">${name}${contact} · <a href="${esc(ctx.appUrl)}/contact" style="color:#14523f">${esc(ctx.appUrl.replace(/^https?:\/\//, ""))}/contact</a><br>` +
    (s.staff ? "Staff alert: you receive this because your role manages stock." : "You receive this email because you placed an order or asked us to.") + `</p>` +
    `</div></div></body></html>`;
  const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [
    ctx.business.en, "", plain(s.en.title), ...s.en.lines.map(plain), "",
    ...(s.details ?? []).map(([k, v]) => `${k}: ${plain(v)}`), s.details?.length ? "" : null,
    s.button ? `${s.button.en}: ${s.button.href}` : null,
  ].filter((x) => x !== null).join("\n");
  // English only: drop the " / Amharic" part of the subject.
  const subject = englishOnly(plain(s.subject));
  return { subject: subject.slice(0, 200), html, text };
}
