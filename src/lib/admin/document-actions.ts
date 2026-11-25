"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { rateLimitAll } from "@/lib/security/rate-limit";
import { scanCustomerUpload } from "@/lib/security/upload-scan";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { detectFileType } from "@/lib/validation/upload";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const DOC_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const MAX = 10 * 1024 * 1024;
const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
const KINDS = ["fayda", "passport", "contract", "driving_licence", "cv", "certificate", "guarantee", "medical", "photo",
  "libre", "insurance", "inspection", "purchase", "other"] as const;

/**
 * Upload an employee or vehicle document (documents.manage). Checked by content (PDF / JPG / PNG / WEBP, max 10 MB),
 * virus-scanned, stored in the private bucket under a server-made name, then recorded in the database.
 */
export async function uploadDocument(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requirePermission("documents.manage");
  const v = z.object({
    profileId: z.union([z.literal(""), z.guid()]).default(""),
    vehicleId: z.union([z.literal(""), z.guid()]).default(""),
    kind: z.enum(KINDS, { message: "Choose the document type." }),
    title: z.string().trim().min(1, "Give the document a name.").max(120),
    issued_on: day, expires_on: day,
    notes: z.string().trim().max(500).default(""),
  }).safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const d = v.data;
  if (!d.profileId === !d.vehicleId) return fail("Invalid request.");
  if (!(await rateLimitAll([[`doc-upload:${ctx.userId}`, 60, 3600]]))) return fail("Too many uploads. Please wait a while.");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file.");
  if (file.size > MAX) return fail("The file is too large (maximum 10 MB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type || !(type in DOC_TYPES)) return fail("Only PDF, JPG, PNG or WEBP files.");
  const scan = await scanCustomerUpload(bytes, { where: "staff_document", userId: ctx.userId, mime: type, ref: d.title.slice(0, 60) });
  if (scan === "upload_rejected") return fail("This file was blocked by the virus scan and was not stored.");
  if (scan === "scan_too_large") return fail("The file is too large for the virus scan. Please upload a smaller file.");
  if (scan === "scan_unavailable") return fail("The virus scan is not available right now. Please try again later.");
  const folder = d.profileId ? `staff/${d.profileId}` : `vehicle/${d.vehicleId}`;
  const path = `${folder}/${crypto.randomUUID()}.${DOC_TYPES[type as keyof typeof DOC_TYPES]}`;
  // Stored with the secret key only after the permission, rate-limit, content and virus checks above.
  const store = getSupabaseAdmin().storage.from("staff-documents");
  const { error: upErr } = await store.upload(path, new Blob([bytes], { type }), { contentType: type });
  if (upErr) return fail("Could not store the file. Please try again.");
  const { error } = await (await createSupabaseServerClient()).rpc("admin_add_document", {
    p: { profile_id: d.profileId || null, vehicle_id: d.vehicleId || null, kind: d.kind, title: d.title, file_path: path, mime: type,
         size_bytes: bytes.length, issued_on: d.issued_on, expires_on: d.expires_on, notes: d.notes },
  });
  if (error) {
    await store.remove([path]);
    return dbError(error);
  }
  revalidatePath("/admin/documents", "layout");
  return ok("Document saved.");
}

export async function deleteDocument(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("documents.manage");
  const v = z.object({ documentId: z.guid() }).safeParse(formObject(fd));
  if (!v.success) return fail("Invalid request.");
  const { data: path, error } = await (await createSupabaseServerClient()).rpc("admin_delete_document", { p_id: v.data.documentId });
  if (error) return dbError(error);
  if (path) await getSupabaseAdmin().storage.from("staff-documents").remove([String(path)]);
  revalidatePath("/admin/documents", "layout");
  return ok("Document deleted.");
}

const vehicleSchema = z.object({
  vehicleId: z.union([z.literal(""), z.guid()]).default(""),
  kind: z.enum(["motorcycle", "car", "bicycle", "three_wheeler"], { message: "Choose the vehicle type." }),
  owner: z.enum(["company", "courier"]).default("company"),
  plate_number: z.string().trim().max(20).regex(/^[A-Za-z0-9 -]*$/, "Plate number: letters, digits, spaces or -"),
  make: z.string().trim().max(40), model: z.string().trim().max(40),
  year: z.union([z.literal(""), z.coerce.number().int().min(1950).max(2100)]),
  colour: z.string().trim().max(30),
  chassis_number: z.string().trim().max(40), engine_number: z.string().trim().max(40), libre_number: z.string().trim().max(40),
  insurance_company: z.string().trim().max(80), insurance_policy: z.string().trim().max(40),
  insurance_expiry: day, inspection_expiry: day,
  assigned_to: z.union([z.literal(""), z.guid()]),
  status: z.enum(["active", "in_repair", "retired"]).default("active"),
  notes: z.string().trim().max(1000),
});

export async function saveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("documents.manage");
  const v = vehicleSchema.safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const { vehicleId, ...p } = v.data;
  if (p.kind !== "bicycle" && !p.plate_number) return fail("Enter the plate number.");
  const { data, error } = await (await createSupabaseServerClient()).rpc("admin_save_vehicle", {
    p_id: (vehicleId || null) as unknown as string, p: { ...p, year: p.year === "" ? "" : String(p.year) },
  });
  if (error) return error.message === "invalid_request" ? fail("Check the details (the plate number may already be registered).") : dbError(error);
  revalidatePath("/admin/documents", "layout");
  if (!vehicleId) redirect(`/admin/documents/vehicles/${data}?created=1`);
  return ok("Vehicle saved.");
}
