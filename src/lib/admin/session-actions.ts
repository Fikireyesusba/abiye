"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dbError, fail, ok, type ActionResult } from "./result";

/** Super Admin: sign a user out on every device (their tokens stop working at once). */
export async function signOutUser(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requirePermission("security.manage");
  const parsed = z.guid().safeParse(fd.get("userId"));
  if (!parsed.success) return fail("Invalid request.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_sign_out_user", { p_user_id: parsed.data });
  if (error) return error.message === "cannot_modify_self" ? fail("You cannot sign yourself out here — use the sign-out button.") : dbError(error);
  revalidatePath("/admin/users");
  return ok(Number(data ?? 0) > 0 ? "Signed out. They must sign in again." : "They were not signed in.");
}
