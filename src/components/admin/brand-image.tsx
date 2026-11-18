"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ActionForm } from "@/components/admin/action-form";
import { clearBrandImage, setBrandImage } from "@/lib/admin/settings-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function BrandImage({ slot, label, url }: { slot: "logo" | "hero"; label: string; url: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!EXT[file.type] || file.size > 5 * 1024 * 1024) return toast.error("Use a JPG, PNG or WebP image up to 5 MB.");
    setBusy(true);
    const path = `branding/${crypto.randomUUID()}.${EXT[file.type]}`;
    const { error } = await createSupabaseBrowserClient().storage.from("site-assets").upload(path, file, { contentType: file.type });
    const res = error ? { ok: false as const, error: "Upload failed." } : await setBrandImage({ slot, path });
    setBusy(false);
    if (res.ok) toast.success(res.message ?? "Saved");
    else toast.error(res.error);
    router.refresh();
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className={`relative overflow-hidden rounded-lg border bg-muted ${slot === "logo" ? "h-20 w-48" : "aspect-[16/6] w-full max-w-md"}`}>
        {url ? <Image src={url} alt="" fill sizes="400px" className={slot === "logo" ? "object-contain p-2" : "object-cover"} /> : <span className="flex h-full items-center justify-center text-xs text-muted-foreground">None</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-secondary">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {url ? "Replace" : "Upload"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {url && <ActionForm action={clearBrandImage} hidden={{ slot }} submitLabel="Remove" variant="outline" size="sm" className="space-y-0" />}
      </div>
    </div>
  );
}
