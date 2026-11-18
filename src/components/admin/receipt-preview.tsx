import { FileText } from "lucide-react";

/** Receipt from a short-lived (5 min) signed URL. Private bucket — never a public URL. */
export function ReceiptPreview({ url, mime }: { url: string | null; mime: string }) {
  if (!url) return <div className="flex aspect-[3/4] items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">Receipt unavailable</div>;
  if (mime === "application/pdf") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border bg-muted text-sm text-primary hover:underline">
        <FileText className="size-8" aria-hidden /> Open PDF receipt
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border bg-muted" title="Open full size">
      {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL; must not go through the public image optimizer */}
      <img src={url} alt="Payment receipt" className="max-h-80 w-full object-contain" />
    </a>
  );
}
