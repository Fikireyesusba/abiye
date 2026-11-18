"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileCheck2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AppErrorCode } from "@/lib/errors";
import { prepareReceiptUpload, submitPaymentProof } from "@/lib/orders/payment-actions";

const MAX = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "application/pdf"];

type Phase = "idle" | "uploading" | "verifying" | "done";

export function PaymentForm({ orderId, accessToken }: { orderId: string; accessToken: string }) {
  const t = useTranslations();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<AppErrorCode | null>(null);

  const pick = (f: File | null) => {
    setError(null);
    if (f && !TYPES.includes(f.type)) return setError("upload_invalid_type");
    if (f && f.size > MAX) return setError("upload_too_large");
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("invalid_files");
    setError(null);
    setPhase("uploading");
    try {
      const prep = await prepareReceiptUpload({ orderId, accessToken, mimeType: file.type, size: file.size });
      if (!prep.ok) throw prep.error;
      const { error: upErr } = await createSupabaseBrowserClient()
        .storage.from("payment-receipts")
        .uploadToSignedUrl(prep.path, prep.uploadToken, file, { contentType: file.type });
      if (upErr) throw "upload_failed";
      setPhase("verifying");
      const res = await submitPaymentProof({ orderId, accessToken, path: prep.path, transactionReference: reference, originalName: file.name });
      if (!res.ok) throw res.error;
      setPhase("done");
      router.refresh();
    } catch (err) {
      setPhase("idle");
      setError(typeof err === "string" ? (err as AppErrorCode) : "upload_failed");
    }
  };

  if (phase === "done") {
    return (
      <p className="flex items-center gap-2 rounded-md bg-success/10 p-4 text-success" role="status">
        <FileCheck2 className="size-5" aria-hidden /> {t("order.submitted")}
      </p>
    );
  }

  const busy = phase !== "idle";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="reference">{t("checkout.reference")}</Label>
        <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60}
          autoComplete="off" placeholder="FT…" aria-describedby="reference-hint" />
        <p id="reference-hint" className="text-xs text-muted-foreground">{t("order.referenceHint")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="receipt">{t("order.receiptFile")}</Label>
        <label
          htmlFor="receipt"
          className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors hover:border-primary hover:bg-primary/5"
        >
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <span className="font-medium break-all">{file ? file.name : t("order.receiptFile")}</span>
        </label>
        <input ref={fileRef} id="receipt" type="file" className="sr-only" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
          onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">{t(`errors.${error}`)}</p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !file}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {phase === "uploading" ? t("order.uploading") : phase === "verifying" ? t("order.verifying") : t("order.submit")}
      </Button>
    </form>
  );
}
