/**
 * One description of where a delivery / partner-shop order is, used by the admin and the customer pages so they
 * match what the courier and Business apps show. (Statuses themselves change only through the apps' PINs.)
 */
export interface StageInput {
  status: string;
  payment_status?: string | null;
  fulfillment_method: string;
  courier_id?: string | null;
  partner_snapshot?: { name?: string } | null;
}

export function deliveryStage(o: StageInput): { en: string; am: string } | null {
  const shop = o.partner_snapshot?.name;
  if (o.fulfillment_method !== "delivery" && !shop) return null;
  switch (o.status) {
    case "confirmed":
    case "processing":
      return o.courier_id
        ? { en: "Courier assigned — to be picked up", am: "መልእክተኛ ተመድቧል — ሊወሰድ ነው" }
        : { en: "Paid — waiting for a courier", am: "ተከፍሏል — መልእክተኛ በመጠበቅ ላይ" };
    case "out_for_delivery":
      return shop ? { en: `On the way to ${shop}`, am: `ወደ ${shop} በመንገድ ላይ` } : { en: "On the way to the customer", am: "ወደ እርስዎ በመንገድ ላይ" };
    case "ready_for_pickup":
      return shop ? { en: `At ${shop} — waiting for the customer`, am: `${shop} ውስጥ — እርስዎን በመጠበቅ ላይ` } : null;
    case "completed":
      return shop ? { en: `Collected at ${shop}`, am: `ከ${shop} ተወስዷል` } : { en: "Delivered", am: "ደርሷል" };
    default:
      return null;
  }
}

/** Run by the courier / Business apps: the office does not move it to on-the-way / at-the-shop / completed by hand. */
export const appRun = (o: StageInput) => !!o.courier_id || !!o.partner_snapshot;
