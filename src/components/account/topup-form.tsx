"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileCheck2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppErrorCode } from "@/lib/errors";
import { formatETB, toSantim } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { prepareTopupUpload, submitTopup } from "@/lib/wallet/actions";

const MAX_FILE = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];
type Phase = "idle" | "uploading" | "verifying" | "done";

/** Top-up request: amount + bank receipt. Credited only after our team verifies the transfer. */
export function TopupForm({ maxAmount }: { maxAmount: number }) {
  const t = useTranslations("wallet");
  const te = useTranslations("errors");
  const locale = useLocale() as "en" | "am";
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<{ code: AppErrorCode; detail?: string } | null>(null);
  const [number, setNumber] = useState<string | null>(null);

  const value = Number(amount);
  const amountOk = Number.isFinite(value) && value >= 10 && Math.round(value * 100) === value * 100;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountOk) return setError({ code: "invalid_amount" });
    if (value > maxAmount) return setError({ code: "wallet_limit", detail: String(maxAmount) });
    if (!file) return setError({ code: "invalid_files" });
    if (!TYPES.includes(file.type)) return setError({ code: "upload_invalid_type" });
    if (file.size > MAX_FILE) return setError({ code: "upload_too_large" });
    setError(null);
    setPhase("uploading");
    try {
      const prep = await prepareTopupUpload({ amount: value, mimeType: file.type, size: file.size });
      if (!prep.ok) throw prep;
      const { error: upErr } = await createSupabaseBrowserClient().storage.from("payment-receipts")
        .uploadToSignedUrl(prep.path, prep.uploadToken, file, { contentType: file.type });
      if (upErr) throw { error: "upload_failed" };
      setPhase("verifying");
      const res = await submitTopup({ amount: value, path: prep.path, transactionReference: reference });
      if (!res.ok) throw res;
      setNumber(res.topupNumber);
      setPhase("done");
      router.refresh();
    } catch (err) {
      setPhase("idle");
      const e2 = err as { error?: AppErrorCode; detail?: string };
      setError({ code: e2?.error ?? "upload_failed", detail: e2?.detail });
    }
  };

  if (phase === "done") {
    return <p role="status" className="flex items-center gap-2 rounded-md bg-success/10 p-4 text-success"><FileCheck2 className="size-5" aria-hidden /> {t("submitted", { number: number ?? "" })}</p>;
  }
  if (maxAmount < 10) return <p className="text-sm text-muted-foreground">{t("atLimit")}</p>;
  const busy = phase !== "idle";
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="topup-amount">{t("amount")}</Label>
        <Input id="topup-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="1000" aria-describedby="topup-amount-hint" />
        <p id="topup-amount-hint" className="text-xs text-muted-foreground">{t("amountHint", { max: formatETB(toSantim(maxAmount), locale) })}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="topup-reference">{t("reference")}</Label>
        <Input id="topup-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} autoComplete="off" placeholder="FT…" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="topup-receipt">{t("receipt")}</Label>
        <label htmlFor="topup-receipt" className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors hover:border-primary hover:bg-primary/5">
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <span className="font-medium break-all">{file ? file.name : t("receipt")}</span>
        </label>
        <input id="topup-receipt" type="file" className="sr-only" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
          {te(error.code)}{error.code === "wallet_limit" && error.detail ? ` ${t("canAdd", { amount: formatETB(toSantim(Number(error.detail)), locale) })}` : ""}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !file || !amountOk}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />} {phase === "uploading" ? t("uploading") : phase === "verifying" ? t("checking") : t("send")}
      </Button>
    </form>
  );
}
