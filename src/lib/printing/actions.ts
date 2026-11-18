"use server";
import { z } from "zod";
import { getSiteSettings } from "@/lib/catalog/settings";
import { toAppError, type AppErrorCode } from "@/lib/errors";
import { clientIpKey, rateLimitAll } from "@/lib/security/rate-limit";
import { generateAccessToken, sha256Hex } from "@/lib/security/tokens";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ethiopianPhoneSchema } from "@/lib/validation/checkout";
import { PRINT_TYPES, validateUpload, type DetectedType } from "@/lib/validation/upload";
import { rememberJobAccess } from "./access";
import { countPages } from "./page-count";

const BUCKET = "printing-files";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const EXT: Record<string, string> = { "application/pdf": "pdf", [DOCX]: "docx", "image/jpeg": "jpg", "image/png": "png" };
const MIME: Record<string, DetectedType> = { pdf: "application/pdf", docx: DOCX, jpg: "image/jpeg", png: "image/png" };
const HARD_MAX_MB = 25; // bucket limit

type Fail = { ok: false; error: AppErrorCode; detail?: string };

async function maxBytes() {
  const s = await getSiteSettings();
  return Math.min(HARD_MAX_MB, s.printing.max_file_mb) * 1024 * 1024;
}

/** Step 1: signed upload URLs for a NEW job folder (jobs/<jobId>/<uuid>.<ext>). */
export async function preparePrintUpload(input: { files: unknown }): Promise<{ ok: true; jobId: string; uploads: { path: string; token: string }[] } | Fail> {
  const files = z
    .array(z.object({ mime: z.string(), size: z.number().int().positive() }))
    .min(1)
    .max(10)
    .safeParse(input.files);
  if (!files.success) return { ok: false, error: "invalid_files" };
  const limit = await maxBytes();
  for (const f of files.data) {
    if (!(f.mime in EXT)) return { ok: false, error: "upload_invalid_type" };
    if (f.size > limit) return { ok: false, error: "upload_too_large" };
  }
  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`print-upload:ip:${ip}`, 10, 3600]]))) return { ok: false, error: "rate_limited" };

  const jobId = crypto.randomUUID();
  const storage = getSupabaseAdmin().storage.from(BUCKET);
  const uploads: { path: string; token: string }[] = [];
  for (const f of files.data) {
    const { data, error } = await storage.createSignedUploadUrl(`jobs/${jobId}/${crypto.randomUUID()}.${EXT[f.mime]}`);
    if (error || !data) return { ok: false, error: "upload_failed" };
    uploads.push({ path: data.path, token: data.token });
  }
  return { ok: true, jobId, uploads };
}

const jobSchema = z.object({
  jobId: z.guid(),
  fullName: z.string().trim().min(2).max(120),
  phone: ethiopianPhoneSchema,
  colorMode: z.enum(["bw", "color"]),
  paperSize: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  sides: z.enum(["single", "double"]),
  copies: z.coerce.number().int().min(1).max(1000),
  fulfillment: z.enum(["delivery", "pickup"]),
  notes: z.string().trim().max(1000).optional(),
  files: z.array(z.object({ path: z.string(), name: z.string().max(255) })).min(1).max(10),
});

export type SubmitPrintResult = { ok: true; jobId: string } | (Fail & { field?: string });

/** Step 2: verify every uploaded file by content, count pages, create the job (priced or awaiting quote). */
export async function submitPrintJob(input: unknown): Promise<SubmitPrintResult> {
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const map: Record<string, AppErrorCode> = { fullName: "invalid_name", phone: "invalid_phone", copies: "too_many_copies", files: "invalid_files" };
    return { ok: false, error: map[field] ?? "invalid_request", field };
  }
  const v = parsed.data;
  const settings = await getSiteSettings();
  if (v.copies > settings.printing.max_copies) return { ok: false, error: "too_many_copies", field: "copies" };

  const ip = await clientIpKey();
  if (!(await rateLimitAll([[`print-submit:ip:${ip}`, 10, 3600], [`print-submit:phone:${sha256Hex(v.phone).slice(0, 32)}`, 10, 3600]]))) {
    return { ok: false, error: "rate_limited" };
  }

  const db = getSupabaseAdmin();
  const storage = db.storage.from(BUCKET);
  const paths = v.files.map((f) => f.path);
  const discardAll = async () => {
    const { data } = await storage.list(`jobs/${v.jobId}`, { limit: 100 });
    const all = new Set([...paths.filter((p) => p.startsWith(`jobs/${v.jobId}/`)), ...(data ?? []).map((o) => `jobs/${v.jobId}/${o.name}`)]);
    if (all.size) await storage.remove([...all]);
  };
  const re = new RegExp(`^jobs/${v.jobId}/[0-9a-f-]{36}\\.(pdf|docx|jpg|png)$`);
  if (new Set(paths).size !== paths.length || !paths.every((p) => re.test(p))) {
    await discardAll();
    return { ok: false, error: "invalid_files" };
  }

  const limit = await maxBytes();
  const files = [];
  for (const f of v.files) {
    const { data: blob, error } = await storage.download(f.path);
    if (error || !blob) {
      await discardAll();
      return { ok: false, error: "upload_failed" };
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ext = f.path.split(".").pop()!;
    const check = validateUpload(bytes, { allowed: PRINT_TYPES, maxBytes: limit, originalName: `x.${ext}` });
    if (!check.ok || check.type !== MIME[ext]) {
      await discardAll();
      return { ok: false, error: check.ok || check.reason === "unsupported_type" ? "upload_invalid_type" : check.reason === "too_large" ? "upload_too_large" : "upload_failed", detail: f.name };
    }
    files.push({
      path: f.path, original_name: f.name.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 255) || "document",
      mime: check.type, size: bytes.length, sha256: sha256Hex(bytes), page_count: await countPages(bytes, check.type),
    });
  }

  const token = generateAccessToken();
  const { error } = await db.rpc("create_printing_job", {
    p_input: {
      id: v.jobId, access_token_hash: sha256Hex(token), customer: { full_name: v.fullName, phone: v.phone },
      color_mode: v.colorMode, paper_size: v.paperSize, sides: v.sides, copies: v.copies,
      fulfillment_method: v.fulfillment, customer_notes: v.notes || null, files,
    },
  });
  if (error) {
    await discardAll();
    const appError = toAppError(error);
    if (appError.code === "unexpected") console.error("[printing] create_printing_job failed:", error.code, error.message);
    return { ok: false, error: appError.code };
  }
  await rememberJobAccess(v.jobId, token);
  return { ok: true, jobId: v.jobId };
}
