"use client";
import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ActionForm } from "@/components/admin/action-form";
import { attachProductImage, deleteProductImage, setPrimaryImage } from "@/lib/admin/catalog-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function ImageManager({ productId, images }: {
  productId: string;
  images: { id: string; url: string; is_primary: boolean }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    for (const file of Array.from(files)) {
      if (!EXT[file.type] || file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name}: use JPG, PNG or WebP up to 5 MB.`);
        continue;
      }
      const path = `products/${productId}/${crypto.randomUUID()}.${EXT[file.type]}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type });
      if (error) {
        toast.error(`${file.name}: upload failed.`);
        continue;
      }
      const res = await attachProductImage({ productId, path });
      if (res.ok) toast.success(`${file.name} added.`);
      else toast.error(`${file.name}: ${res.error}`);
    }
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {images.map((img) => (
          <li key={img.id} className="space-y-2 rounded-lg border p-2">
            <div className="relative aspect-square overflow-hidden rounded-md bg-muted">
              <Image src={img.url} alt="" fill sizes="200px" className="object-cover" />
              {img.is_primary && <span className="absolute top-1 left-1 rounded bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">MAIN</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              {!img.is_primary && (
                <ActionForm action={setPrimaryImage} hidden={{ imageId: img.id, productId }} submitLabel="Make main" variant="outline" size="sm" className="space-y-0" />
              )}
              <ActionForm action={deleteProductImage} hidden={{ imageId: img.id, productId }} submitLabel="Remove" variant="outline" size="sm"
                confirm="Remove this image?" className="space-y-0" />
            </div>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm hover:border-primary hover:bg-primary/5">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        {busy ? "Uploading…" : "Add images (JPG, PNG or WebP, max 5 MB each)"}
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy}
          onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} aria-label="Upload product images" />
      </label>
    </div>
  );
}
