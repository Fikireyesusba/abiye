"use client";
import { ActionForm } from "@/components/admin/action-form";
import { Field, fieldClass } from "@/components/admin/ui";
import { saveBanner } from "@/lib/admin/promotion-actions";
import type { ActionResult } from "@/lib/admin/result";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface BannerValues {
  id: string;
  title_en: string;
  title_am: string;
  subtitle_en: string;
  subtitle_am: string;
  link_href: string | null;
  sort_order: number;
  is_active: boolean;
  starts: string;
  ends: string;
}

/** Uploads the chosen image straight to Storage (admin policy), then saves; the server verifies the file content. */
async function submitBanner(prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const file = fd.get("image");
  fd.delete("image");
  fd.set("image_path", "");
  if (file instanceof File && file.size > 0) {
    if (!EXT[file.type] || file.size > 5 * 1024 * 1024) return { ok: false, error: "Use a JPG, PNG or WebP image up to 5 MB." };
    const path = `banners/${crypto.randomUUID()}.${EXT[file.type]}`;
    const { error } = await createSupabaseBrowserClient().storage.from("site-assets").upload(path, file, { contentType: file.type });
    if (error) return { ok: false, error: "Image upload failed." };
    fd.set("image_path", path);
  }
  return saveBanner(prev, fd);
}

export function BannerForm({ b }: { b?: BannerValues }) {
  const id = b?.id ?? "new";
  return (
    <ActionForm action={submitBanner} hidden={{ id: b?.id ?? "" }} submitLabel={b ? "Save banner" : "Create banner"} resetOnSuccess={!b}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title (English)" htmlFor={`bt-en-${id}`}><input id={`bt-en-${id}`} name="title_en" required maxLength={120} defaultValue={b?.title_en} className={fieldClass} /></Field>
        <Field label="Title (Amharic)" htmlFor={`bt-am-${id}`}><input id={`bt-am-${id}`} name="title_am" required maxLength={120} defaultValue={b?.title_am} lang="am" className={fieldClass} /></Field>
        <Field label="Subtitle (English)" htmlFor={`bs-en-${id}`}><input id={`bs-en-${id}`} name="subtitle_en" maxLength={240} defaultValue={b?.subtitle_en} className={fieldClass} /></Field>
        <Field label="Subtitle (Amharic)" htmlFor={`bs-am-${id}`}><input id={`bs-am-${id}`} name="subtitle_am" maxLength={240} defaultValue={b?.subtitle_am} lang="am" className={fieldClass} /></Field>
        <Field label="Link (optional)" htmlFor={`bl-${id}`} hint="A page on this website, e.g. /cosmetics or /products/…"><input id={`bl-${id}`} name="link_href" maxLength={200} defaultValue={b?.link_href ?? ""} placeholder="/cosmetics" className={fieldClass} /></Field>
        <Field label="Order" htmlFor={`bo-${id}`} hint="Lower numbers show first"><input id={`bo-${id}`} name="sort_order" type="number" min={0} max={1000} defaultValue={b?.sort_order ?? 0} className={fieldClass} /></Field>
        <Field label="Show from (optional)" htmlFor={`bf-${id}`}><input id={`bf-${id}`} name="starts_at" type="datetime-local" defaultValue={b?.starts} className={fieldClass} /></Field>
        <Field label="Show until (optional)" htmlFor={`bu-${id}`}><input id={`bu-${id}`} name="ends_at" type="datetime-local" defaultValue={b?.ends} className={fieldClass} /></Field>
        <Field label={b ? "Replace image (optional)" : "Image"} htmlFor={`bi-${id}`} hint="JPG, PNG or WebP, max 5 MB. Wide images work best (about 16:7).">
          <input id={`bi-${id}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" required={!b} className="text-sm" />
        </Field>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_active" defaultChecked={b?.is_active ?? true} className="size-4 accent-[var(--primary)]" /> Show on the homepage</label>
      </div>
    </ActionForm>
  );
}
