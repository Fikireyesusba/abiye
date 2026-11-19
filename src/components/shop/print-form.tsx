"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Loader2, Printer, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AppErrorCode } from "@/lib/errors";
import { formatETB, toSantim } from "@/lib/money";
import { quotePrinting, type PrintPriceRule } from "@/lib/pricing/printing";
import { preparePrintUpload, submitPrintJob } from "@/lib/printing/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTED = ["application/pdf", DOCX, "image/jpeg", "image/png"];
const selectClass = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface Picked {
  file: File;
  pages: number | null; // browser estimate; the server recounts
}

/** Browser-side page estimate (pdf-lib loaded on demand). The server's count is authoritative. */
async function estimatePages(file: File): Promise<number | null> {
  if (file.type === "image/jpeg" || file.type === "image/png") return 1;
  if (file.type !== "application/pdf") return null;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

export function PrintForm({
  rules, serviceCharge, maxMb, maxCopies, pickupEnabled, deliveryEnabled, defaults,
}: {
  defaults: { fullName: string; phone: string };
  rules: { color_mode: "bw" | "color"; paper_size: string; sides: "single" | "double"; price_per_page_etb: number }[];
  serviceCharge: number; maxMb: number; maxCopies: number; pickupEnabled: boolean; deliveryEnabled: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "am";
  const router = useRouter();
  const sizes = [...new Set(rules.map((r) => r.paper_size))];
  const [files, setFiles] = useState<Picked[]>([]);
  const [opts, setOpts] = useState({
    colorMode: rules[0]?.color_mode ?? "bw", paperSize: sizes[0] ?? "A4", sides: rules[0]?.sides ?? "single",
    copies: 1, fulfillment: pickupEnabled ? "pickup" : "delivery",
  });
  const [contact, setContact] = useState({ fullName: defaults.fullName, phone: defaults.phone, notes: "" });
  const [phase, setPhase] = useState<"idle" | "uploading" | "checking">("idle");
  const [error, setError] = useState<{ code: AppErrorCode; detail?: string } | null>(null);

  const priceRules: PrintPriceRule[] = useMemo(
    () => rules.map((r) => ({ colorMode: r.color_mode, paperSize: r.paper_size, sides: r.sides, pricePerPage: toSantim(r.price_per_page_etb), isActive: true })),
    [rules],
  );
  const rule = priceRules.find((r) => r.colorMode === opts.colorMode && r.paperSize === opts.paperSize && r.sides === opts.sides);
  const knownPages = files.every((f) => f.pages !== null) && files.length > 0 ? files.reduce((n, f) => n + f.pages!, 0) : null;
  const quote = quotePrinting(priceRules, toSantim(serviceCharge), { ...opts, pageCount: knownPages, copies: opts.copies });

  const addFiles = async (list: FileList | null) => {
    setError(null);
    const incoming = Array.from(list ?? []);
    const next: Picked[] = [];
    for (const file of incoming) {
      if (!ACCEPTED.includes(file.type)) return setError({ code: "upload_invalid_type", detail: file.name });
      if (file.size > maxMb * 1024 * 1024) return setError({ code: "upload_too_large", detail: file.name });
      next.push({ file, pages: await estimatePages(file) });
    }
    setFiles((f) => [...f, ...next].slice(0, 10));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return setError({ code: "invalid_files" });
    setError(null);
    setPhase("uploading");
    try {
      const prep = await preparePrintUpload({ files: files.map((f) => ({ mime: f.file.type, size: f.file.size })) });
      if (!prep.ok && prep.error === "login_required") return router.push("/account/login?next=/printing");
      if (!prep.ok) throw { code: prep.error };
      const supabase = createSupabaseBrowserClient();
      for (let i = 0; i < files.length; i++) {
        const { error: upErr } = await supabase.storage.from("printing-files")
          .uploadToSignedUrl(prep.uploads[i].path, prep.uploads[i].token, files[i].file, { contentType: files[i].file.type });
        if (upErr) throw { code: "upload_failed", detail: files[i].file.name };
      }
      setPhase("checking");
      const res = await submitPrintJob({
        jobId: prep.jobId, ...contact, ...opts,
        files: files.map((f, i) => ({ path: prep.uploads[i].path, name: f.file.name })),
      });
      if (!res.ok && res.error === "login_required") return router.push("/account/login?next=/printing");
      if (!res.ok) throw { code: res.error, detail: res.detail };
      router.push(`/printing/jobs/${res.jobId}`);
    } catch (err) {
      setPhase("idle");
      const e2 = err as { code?: AppErrorCode; detail?: string };
      setError({ code: e2?.code ?? "unexpected", detail: e2?.detail });
    }
  };

  const busy = phase !== "idle";
  const opt = (k: keyof typeof opts) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setOpts((o) => ({ ...o, [k]: k === "copies" ? Math.max(1, Math.min(maxCopies, Number(e.target.value) || 1)) : e.target.value }));

  return (
    <form onSubmit={submit} className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]" noValidate>
      <div className="min-w-0 space-y-6">
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <Label htmlFor="print-files">{t("printing.filesLabel", { mb: maxMb })}</Label>
          {files.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {files.map((f, i) => (
                <li key={`${f.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{f.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{f.pages ? t("printJob.pagesN", { count: f.pages }) : "?"}</span>
                  <button type="button" className="rounded p-1 hover:bg-secondary" disabled={busy}
                    onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} aria-label={`${t("printing.remove")} ${f.file.name}`}>
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label htmlFor="print-files" className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors hover:border-primary hover:bg-primary/5", busy && "pointer-events-none opacity-60")}>
            <Upload className="size-6 text-muted-foreground" aria-hidden />
            <span className="font-medium">{t("printing.chooseFiles")}</span>
          </label>
          <input id="print-files" type="file" multiple className="sr-only" disabled={busy}
            accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("printing.options")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="colorMode">{t("printing.colorMode")}</Label>
              <select id="colorMode" className={selectClass} value={opts.colorMode} onChange={opt("colorMode")}>
                <option value="bw">{t("printing.bw")}</option><option value="color">{t("printing.color")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="paperSize">{t("printing.paperSize")}</Label>
              <select id="paperSize" className={selectClass} value={opts.paperSize} onChange={opt("paperSize")}>
                {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sides">{t("printing.sides")}</Label>
              <select id="sides" className={selectClass} value={opts.sides} onChange={opt("sides")}>
                <option value="single">{t("printing.single")}</option><option value="double">{t("printing.double")}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="copies">{t("printing.copies")}</Label>
              <Input id="copies" type="number" min={1} max={maxCopies} value={opts.copies} onChange={opt("copies")} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="fulfillment">{t("printing.fulfillment")}</Label>
              <select id="fulfillment" className={selectClass} value={opts.fulfillment} onChange={opt("fulfillment")}>
                {pickupEnabled && <option value="pickup">{t("checkout.pickup")}</option>}
                {deliveryEnabled && <option value="delivery">{t("checkout.delivery")}</option>}
              </select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {rule ? t("printing.liveEstimate", { price: formatETB(rule.pricePerPage, locale) }) : t("printing.noRule")}
          </p>
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">{t("printing.yourDetails")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pfullName">{t("checkout.fullName")}</Label>
              <Input id="pfullName" autoComplete="name" required maxLength={120} value={contact.fullName} onChange={(e) => setContact((c) => ({ ...c, fullName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pphone">{t("checkout.phone")}</Label>
              <Input id="pphone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={20} placeholder={t("checkout.phoneHint")}
                value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="pnotes">{t("printing.notes")}</Label>
              <Textarea id="pnotes" rows={2} maxLength={1000} placeholder={t("printing.notesHint")} value={contact.notes} onChange={(e) => setContact((c) => ({ ...c, notes: e.target.value }))} />
            </div>
          </div>
        </section>
      </div>

      <aside className="space-y-4 rounded-xl border bg-card p-5 lg:sticky lg:top-24">
        <h2 className="flex items-center gap-2 font-semibold"><Printer className="size-5 text-printing" aria-hidden /> {t("printing.estimate")}</h2>
        {quote ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{t("printJob.breakdown", { pages: knownPages!, copies: opts.copies, price: formatETB(quote.pricePerPage, locale) })}</dt></div>
            {quote.serviceCharge > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("printJob.serviceCharge")}</dt><dd>{formatETB(quote.serviceCharge, locale)}</dd></div>}
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><dt>{t("printJob.total")}</dt><dd className="tabular-nums">{formatETB(quote.total, locale)}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{files.length ? t("printing.needsQuote") : "—"}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("printing.estimateHint")}</p>
        {error && (
          <p role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive">
            {t(`errors.${error.code}`)}{error.detail ? ` (${error.detail})` : ""}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full" disabled={busy || files.length === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />}
          {phase === "uploading" ? t("printing.uploading") : phase === "checking" ? t("printing.checking") : t("printing.submit")}
        </Button>
      </aside>
    </form>
  );
}
