import "server-only";
import { after } from "next/server";
import { dispatchGroup } from "./dispatch";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Every Excel export is also sent, as the file with an alert, to the receipts Telegram group — a copy outside
 * the website. The file is put in the private excel-exports bucket and queued like a payment receipt, so a
 * failed send is retried (and shows under Notifications); it is removed from storage once Telegram has it.
 * Runs after the download response: never delays or breaks the export.
 * Called only from export routes, after the Super Admin check and the rate limit.
 */
export function sendExportCopy(file: ArrayBuffer | Uint8Array, filename: string, what: string, byUserId: string, rows?: number) {
  const bytes = new Uint8Array(file instanceof Uint8Array ? file : new Uint8Array(file)); // own copy (plain ArrayBuffer)
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  after(async () => {
    const db = getSupabaseAdmin();
    const path = `${crypto.randomUUID()}.xlsx`;
    const { error: upErr } = await db.storage.from("excel-exports").upload(path, new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (upErr) {
      console.error(`[export-copy] could not store ${safeName}: ${upErr.message}`);
      return;
    }
    const { error } = await db.rpc("queue_excel_copy", { p_path: path, p_file_name: safeName, p_title: what.slice(0, 120), p_rows: rows, p_by: byUserId });
    if (error) {
      console.error(`[export-copy] could not queue ${safeName}: ${error.message}`);
      await db.storage.from("excel-exports").remove([path]);
      return;
    }
    await dispatchGroup("receipts", 5).catch((e: Error) => console.error("[export-copy] send failed (will retry):", e.message));
  });
}
