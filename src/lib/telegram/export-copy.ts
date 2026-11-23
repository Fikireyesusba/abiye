import "server-only";
import { after } from "next/server";
import { APP_TIME_LABEL, zoneStamp } from "@/lib/datetime";
import { sendMedia } from "./client";
import { groupConfig } from "./dispatch";
import { esc } from "./format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Every Excel export is also sent, as the file, to the receipts Telegram group — a copy outside the website.
 * Runs after the download response (never delays or breaks the export). Skipped when that group is not set up.
 */
export function sendExportCopy(file: ArrayBuffer | Uint8Array, filename: string, what: string, byUserId: string, rows?: number) {
  const cfg = groupConfig("receipts");
  if (!cfg) return;
  const bytes = new Uint8Array(file instanceof Uint8Array ? file : new Uint8Array(file)); // own copy (plain ArrayBuffer)
  after(async () => {
    // The staff member is named by User ID only.
    const { data } = await getSupabaseAdmin().from("customer_accounts").select("member_id").eq("id", byUserId).maybeSingle();
    const caption = [
      "📊 <b>EXCEL EXPORT</b>",
      `<i>Service: Exports · Type: ${esc(what)}</i>`,
      `Action by User ID: ${esc(data?.member_id ?? "—")}`,
      "",
      `File: ${esc(filename)}`,
      ...(rows !== undefined ? [`Rows: ${rows}`] : []),
      `When: ${zoneStamp(new Date())} (${APP_TIME_LABEL})`,
      "",
      "👉 <b>Suggested action:</b> Keep this file as your copy; nothing else to do.",
    ].join("\n");
    const res = await sendMedia(cfg, "document", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename, caption)
      .catch((e: Error) => ({ ok: false as const, kind: "retry" as const, error: e.message }));
    if (!res.ok) console.error(`[export-copy] could not send ${filename} to Telegram: ${res.error}`);
  });
}
