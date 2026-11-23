import { ShieldAlert, ShieldCheck } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** The virus scan of this exact file (matched by its fingerprint) — shown next to receipts and printing files. */
export async function ScanStatus({ sha256, className }: { sha256: string; className?: string }) {
  const { data } = await (await createSupabaseServerClient()).from("upload_scans")
    .select("result, created_at, findings").eq("sha256", sha256).eq("result", "clean").order("id", { ascending: false }).limit(1).maybeSingle();
  return data ? (
    <span className={`inline-flex items-center gap-1 text-xs text-success ${className ?? ""}`} data-testid="scan-status">
      <ShieldCheck className="size-3.5" aria-hidden /> Virus scan: clean (Cloudmersive, {formatDateTime(data.created_at, "en")})
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className ?? ""}`} data-testid="scan-status">
      <ShieldAlert className="size-3.5" aria-hidden /> No virus-scan record (uploaded before scanning started)
    </span>
  );
}
