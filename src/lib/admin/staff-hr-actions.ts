"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, formObject, ok, type ActionResult } from "./result";

const schema = z.object({
  profileId: z.guid(),
  job_title: z.string().trim().max(80),
  start_date: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  fayda_number: z.string().trim().regex(/^(\d{12,16})?$/, "Fayda number: 12 to 16 digits."),
  passport_number: z.string().trim().toUpperCase().regex(/^([A-Z0-9]{6,12})?$/, "Passport number: 6 to 12 letters or digits."),
  address: z.string().trim().max(300),
  city: z.string().trim().max(80),
  emergency_name: z.string().trim().max(120),
  emergency_phone: z.string().trim().regex(/^((\+251|0)?[79]\d{8})?$/, "Emergency phone: an Ethiopian mobile number (e.g. 0911223344)."),
  notes: z.string().trim().max(1000),
});

/** HR details of a staff member (staff.manage; saved through the database function, logged without the values). */
export async function saveStaffHr(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("staff.manage");
  const v = schema.safeParse(formObject(fd));
  if (!v.success) return fail(v.error.issues[0]?.message ?? "Check the details.");
  const { profileId, ...d } = v.data;
  const { error } = await (await createSupabaseServerClient()).rpc("admin_save_staff_hr", {
    p_profile: profileId,
    p: { ...d, emergency_phone: d.emergency_phone ? `+251${d.emergency_phone.replace(/^(\+251|0)/, "")}` : "" },
  });
  if (error) return dbError(error);
  revalidatePath(`/admin/staff/${profileId}`);
  return ok("HR details saved.");
}
